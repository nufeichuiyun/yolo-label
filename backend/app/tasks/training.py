"""
YOLO 模型训练任务
"""
import os
import shutil
import tempfile
from celery import Task
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import TrainingTask, Project
from app.services.training_service import prepare_dataset
from sqlalchemy.orm import Session

try:
    import torch
except ImportError:
    torch = None

TRAINING_OUTPUT_DIR = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")
MODEL_DIR = os.getenv("MODEL_DIR", "./models")


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

            # 2. 训练模型
            from ultralytics import YOLO

            model = YOLO(base_model)
            project_name = f"project_{project_id}"
            output_project = os.path.join(TRAINING_OUTPUT_DIR, project_name)
            os.makedirs(output_project, exist_ok=True)

            # 创建 epoch 回调以更新进度
            def on_train_epoch_end(trainer):
                current = getattr(trainer, "epoch", 0) + 1
                total = getattr(trainer, "epochs", epochs)
                progress = int(5 + 90 * current / total)  # 5-95% 用于训练
                task.current_epoch = current
                task.progress = min(progress, 95)
                db.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "progress": task.progress,
                        "current_epoch": current,
                        "total_epochs": total,
                        "stage": "training"
                    }
                )

            model.add_callback("on_train_epoch_end", on_train_epoch_end)

            results = model.train(
                data=data_yaml_path,
                epochs=epochs,
                imgsz=imgsz,
                batch=batch,
                project=output_project,
                name="train",
                exist_ok=True,
                verbose=True,
                device="cuda:0" if torch and torch.cuda.is_available() else "cpu"
            )

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
