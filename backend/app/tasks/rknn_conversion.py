"""
RKNN 转换任务：把训练得到的 .pt 转换为 RK3588 用 .rknn（INT8 量化）。

仅由专用的 rknn-worker（Python 3.10 + RKNN Toolkit2 镜像）消费，路由到 `rknn` 队列。
本模块依赖极轻（stdlib + celery + SQLAlchemy），不导入 torch/ultralytics，
以便同时被主后端镜像（注册用）与 rknn-worker 镜像安全导入。

实际转换通过子进程调用 vendored 转换器 CLI 完成，环境隔离。
"""
import os
import shutil
import subprocess

from app.celery_app import celery_app
from app.models import TrainingTask
from app.task_heartbeat import mark_alive
from app.tasks._db_task import DatabaseTask

MODEL_DIR = os.getenv("MODEL_DIR", "./models")
# rknn-worker 镜像中转换器的安装路径（见 rknn_converter/Dockerfile）
CONVERTER_SCRIPT = os.getenv(
    "RKNN_CONVERTER_SCRIPT",
    "/app/yolo11_pt_to_rknn/pt_to_rknn_converter.py",
)


def _tail(text: str, n: int = 30) -> str:
    if not text:
        return ""
    lines = text.strip().split("\n")
    return "\n".join(lines[-n:])


@celery_app.task(bind=True, base=DatabaseTask)
def convert_to_rknn_task(self, training_task_id: int):
    """
    将训练任务产出的 .pt 转换为 .rknn。

    Args:
        training_task_id: TrainingTask 的整数主键 id
    """
    db = self.db
    task = db.query(TrainingTask).filter(TrainingTask.id == training_task_id).first()
    if not task:
        print(f"[rknn] 训练任务不存在: id={training_task_id}", flush=True)
        return {"status": "failed", "reason": "task_not_found"}

    task.rknn_status = "converting"
    task.rknn_error = None
    db.commit()
    # 转换是单次阻塞调用、无进度循环，故一次性写较长 TTL 的心跳覆盖整个转换过程，
    # 供后端启动清扫识别"正在转换"（键名加 rknn: 前缀，与训练/预标注的 task_id 区分）
    mark_alive(f"rknn:{training_task_id}", ttl=3600)

    try:
        if not task.output_model_path:
            raise RuntimeError("训练任务无输出模型，无法转换")

        pt_path = os.path.join(MODEL_DIR, task.output_model_path)
        if not os.path.exists(pt_path):
            raise RuntimeError(f".pt 模型文件不存在: {pt_path}")

        calib_dir = os.path.join(MODEL_DIR, "calib", str(task.id))
        if not os.path.isdir(calib_dir) or not os.listdir(calib_dir):
            raise RuntimeError(f"量化校准图片目录为空或不存在: {calib_dir}")

        out_dir = MODEL_DIR
        pt_stem = os.path.splitext(os.path.basename(pt_path))[0]
        expected_rknn = os.path.join(out_dir, f"{pt_stem}.rknn")

        print(f"[rknn] 开始转换 {pt_path} (校准目录 {calib_dir})", flush=True)
        proc = subprocess.run(
            [
                "python3",
                CONVERTER_SCRIPT,
                pt_path,
                calib_dir,
                "--output-dir",
                out_dir,
                "--skip-deps-check",
            ],
            capture_output=True,
            text=True,
        )

        if proc.returncode != 0 or not os.path.exists(expected_rknn):
            detail = f"转换子进程退出码: {proc.returncode}"
            if proc.stderr and proc.stderr.strip():
                detail += "\n\n错误输出:\n" + _tail(proc.stderr)
            if proc.stdout and proc.stdout.strip():
                detail += "\n\n标准输出(最后):\n" + _tail(proc.stdout)
            raise RuntimeError(detail)

        task.output_rknn_path = f"{pt_stem}.rknn"
        task.rknn_status = "completed"
        db.commit()
        print(f"[rknn] 转换成功 -> {expected_rknn}", flush=True)

        # 清理中间 .onnx/.onnx.data 及校准图片，回收空间
        for suffix in (".onnx", ".onnx.data"):
            p = os.path.join(out_dir, f"{pt_stem}{suffix}")
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
        try:
            shutil.rmtree(calib_dir, ignore_errors=True)
        except OSError:
            pass

        return {"status": "completed", "output_rknn_path": task.output_rknn_path}

    except Exception as e:
        error_msg = str(e)
        print(f"[rknn] 转换失败: {error_msg}", flush=True)
        task = db.query(TrainingTask).filter(TrainingTask.id == training_task_id).first()
        if task:
            task.rknn_status = "failed"
            task.rknn_error = error_msg
            db.commit()
        return {"status": "failed", "reason": error_msg}
