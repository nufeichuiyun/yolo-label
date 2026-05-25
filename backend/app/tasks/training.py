"""
YOLO 模型训练任务
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from app.celery_app import celery_app
from app.models import TrainingTask, Project
from app.services.training_service import prepare_dataset, collect_calibration_images
from app.services.training_archive_service import create_training_archive
from app.tasks._db_task import DatabaseTask

try:
    import torch
except ImportError:
    torch = None

TRAINING_OUTPUT_DIR = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
TRAINING_METRICS_KEY_PREFIX = "training_metrics:"
TRAINING_METRICS_TTL = 86400  # 24 小时


def _resolve_workers() -> int:
    """
    根据 CPU 核心数设置 DataLoader workers，可通过 TRAINING_WORKERS 覆盖。
    默认上限 4，减少多进程内存占用（PyTorch DataLoader workers 有已知内存不释放问题）。
    """
    env_val = os.getenv("TRAINING_WORKERS", "").strip()
    if env_val.isdigit():
        return int(env_val)
    n = os.cpu_count() or 4
    return min(4, max(0, n - 1))  # 上限 4，降低 worker 内存占用


def _resolve_batch(batch: int, has_gpu: bool) -> int:
    """解析 batch：<=0 时根据是否有 GPU 使用自动 batch 或默认 16"""
    if batch is not None and batch > 0:
        return batch
    return -1 if has_gpu else 16  # -1 = ultralytics 自动检测最优 batch


@celery_app.task(bind=True, base=DatabaseTask)
def train_model_task(
    self,
    task_id: str,
    project_id: int,
    base_model: str,
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 16,
    train_split: float = 0.8
):
    """
    YOLO 模型训练任务

    Args:
        task_id: 数据库中的任务 ID（用于更新状态）
        project_id: 项目 ID
        base_model: 基础模型（yolo11n.pt / yolo11n-seg.pt 等）
        epochs: 训练轮数
        imgsz: 输入图片尺寸
        batch: 批次大小
        train_split: 训练集比例
    """
    db = self.db

    try:
        task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
        if not task:
            raise ValueError(f"训练任务不存在: {task_id}")

        task.status = "running"
        task.progress = 0
        db.commit()

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"项目不存在: {project_id}")

        # 1. 准备数据集
        task.progress = 5
        db.commit()
        self.update_state(state="PROGRESS", meta={"progress": 5, "stage": "preparing_dataset"})

        with tempfile.TemporaryDirectory(prefix="yolo_train_") as tmpdir:
            data_yaml_path, train_count, val_count = prepare_dataset(
                db, project_id, tmpdir,
                train_split=train_split,
                random_seed=42
            )

            task.train_images = train_count
            task.val_images = val_count
            task.epochs = epochs
            db.commit()

            # 2. 训练模型（子进程隔离：训练在独立进程中运行，进程退出时 OS 自动回收全部内存）
            project_name = f"project_{project_id}"
            output_project = os.path.join(TRAINING_OUTPUT_DIR, project_name)
            os.makedirs(output_project, exist_ok=True)

            has_gpu = bool(torch and torch.cuda.is_available())
            device = "cuda:0" if has_gpu else "cpu"
            workers = _resolve_workers()
            batch_resolved = _resolve_batch(batch, has_gpu)
            print(f"[training] 使用子进程隔离训练，device={device}, workers={workers}, batch={batch_resolved}", flush=True)

            # 通过子进程运行训练，子进程退出时所有内存被 OS  reclaim；捕获输出以便失败时展示具体错误
            proc = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "app.tasks.training_runner",
                    "--task-id",
                    task_id,
                    "--data-yaml",
                    data_yaml_path,
                    "--output-project",
                    output_project,
                    "--base-model",
                    base_model,
                    "--epochs",
                    str(epochs),
                    "--imgsz",
                    str(imgsz),
                    "--batch",
                    str(batch_resolved),
                    "--workers",
                    str(workers),
                    "--device",
                    device,
                ],
                env={**os.environ},
                cwd=os.getcwd(),
                capture_output=True,
                text=True,
            )

            if proc.returncode != 0:
                err_detail = f"训练子进程退出码: {proc.returncode}"
                if proc.stderr and proc.stderr.strip():
                    err_detail += "\n\n子进程错误输出:\n" + proc.stderr.strip()
                if proc.stdout and proc.stdout.strip():
                    # 取最后几行 stdout 作为补充（常有 traceback 在 stdout）
                    lines = proc.stdout.strip().split("\n")
                    tail = "\n".join(lines[-30:]) if len(lines) > 30 else proc.stdout.strip()
                    err_detail += "\n\n子进程标准输出(最后):\n" + tail
                raise RuntimeError(err_detail)

            # 3. 复制输出模型到 models 目录
            task.progress = 98
            db.commit()

            runs_dir = os.path.join(output_project, "train")
            weights_dir = os.path.join(runs_dir, "weights")
            best_pt = os.path.join(weights_dir, "best.pt")
            last_pt = os.path.join(weights_dir, "last.pt")

            os.makedirs(MODEL_DIR, exist_ok=True)
            if os.path.exists(best_pt):
                final_model_name = f"trained_{project_id}_{task.id}_best.pt"
                final_model_path = os.path.join(MODEL_DIR, final_model_name)
                shutil.copy2(best_pt, final_model_path)
                task.output_model_path = final_model_name
            elif os.path.exists(last_pt):
                final_model_name = f"trained_{project_id}_{task.id}_last.pt"
                final_model_path = os.path.join(MODEL_DIR, final_model_name)
                shutil.copy2(last_pt, final_model_path)
                task.output_model_path = final_model_name

            # 3.5 若需 RKNN 转换：在临时目录销毁前，把 val(不足则补 train)图片复制为量化校准集
            if task.convert_to_rknn and task.output_model_path:
                try:
                    calib_dir = os.path.join(MODEL_DIR, "calib", str(task.id))
                    n_calib = collect_calibration_images(tmpdir, calib_dir)
                    print(f"[training] 已准备 {n_calib} 张量化校准图片 -> {calib_dir}", flush=True)
                except Exception as e:
                    print(f"[training] 准备量化校准图片失败（将跳过 RKNN 转换）: {e}", flush=True)

            # 4. 创建训练完整包 zip（数据集+模型+训练曲线）
            try:
                archive_path = create_training_archive(
                    project_name=project.name,
                    project_id=project_id,
                    task_id=task.id,
                    created_at=task.created_at,
                    dataset_dir=tmpdir,
                    runs_dir=runs_dir,
                    model_path=task.output_model_path or "",
                )
                task.output_archive_path = archive_path
            except Exception as e:
                print(f"[training] 创建训练归档失败（不影响训练结果）: {e}", flush=True)

            print("[training] 训练子进程已退出，内存已由 OS 回收", flush=True)

        # 是否进行 RKNN 转换：需勾选、有产出模型、且校准图片已就绪
        calib_dir = os.path.join(MODEL_DIR, "calib", str(task.id))
        will_convert = bool(task.convert_to_rknn and task.output_model_path and os.path.isdir(calib_dir))

        task.status = "completed"
        task.progress = 100
        task.current_epoch = epochs
        if will_convert:
            # 与 completed 同一次提交置为 pending，避免前端看到 completed 但 rknn_status 为空的间隙
            task.rknn_status = "pending"
        db.commit()

        # 5. 训练完成后异步派发 RKNN 转换（独立 rknn 队列，由专用 worker 处理）
        if will_convert:
            try:
                from app.tasks.rknn_conversion import convert_to_rknn_task
                convert_to_rknn_task.delay(training_task_id=task.id)
                print(f"[training] 已派发 RKNN 转换任务 training_task_id={task.id}", flush=True)
            except Exception as e:
                task.rknn_status = "failed"
                task.rknn_error = f"派发 RKNN 转换任务失败: {e}"
                db.commit()
                print(f"[training] 派发 RKNN 转换任务失败（不影响训练结果）: {e}", flush=True)

        return {
            "message": "训练完成",
            "train_images": train_count,
            "val_images": val_count,
            "output_model_path": task.output_model_path
        }

    except Exception as e:
        error_msg = str(e)
        print(f"训练任务失败: {error_msg}")
        import traceback
        traceback.print_exc()

        task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
        if task:
            task.status = "failed"
            task.error_message = error_msg
            db.commit()

        raise
