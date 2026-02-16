"""
YOLO 模型训练任务
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from celery import Task
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TrainingTask, Project
from app.services.training_service import prepare_dataset
from app.services.training_archive_service import create_training_archive
from sqlalchemy.orm import Session

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


class DatabaseTask(Task):
    """带数据库会话的任务基类"""
    _db: Session = None

    @property
    def db(self):
        if self._db is None:
            self._db = SessionLocal()
        return self._db

    def after_return(self, *args, **kwargs):
        """任务完成后关闭数据库会话"""
        if self._db:
            self._db.close()
            self._db = None


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

            # 通过子进程运行训练，子进程退出时所有内存被 OS  reclaim
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
            )

            if proc.returncode != 0:
                raise RuntimeError(f"训练子进程退出码: {proc.returncode}")

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

        task.status = "completed"
        task.progress = 100
        task.current_epoch = epochs
        db.commit()

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
