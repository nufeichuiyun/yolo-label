"""
YOLO 模型训练任务
"""
import json
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
TRAINING_METRICS_KEY_PREFIX = "training_metrics:"
TRAINING_METRICS_TTL = 86400  # 24 小时


def _resolve_workers() -> int:
    """根据 CPU 核心数自动设置 DataLoader workers，可通过 TRAINING_WORKERS 覆盖"""
    env_val = os.getenv("TRAINING_WORKERS", "").strip()
    if env_val.isdigit():
        return int(env_val)
    n = os.cpu_count() or 4
    return min(8, max(0, n - 1))  # 留 1 核给主进程


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

            # 2. 训练模型
            from ultralytics import YOLO

            model = YOLO(base_model)
            project_name = f"project_{project_id}"
            output_project = os.path.join(TRAINING_OUTPUT_DIR, project_name)
            os.makedirs(output_project, exist_ok=True)

            # 进度回调：使用独立 session 避免与主任务 session 冲突导致阻塞/死锁
            def _update_progress(current_epoch: int, progress_pct: int):
                try:
                    _db = SessionLocal()
                    try:
                        _t = _db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
                        if _t:
                            _t.current_epoch = current_epoch
                            _t.progress = min(progress_pct, 95)
                            _db.commit()
                    finally:
                        _db.close()
                    self.update_state(
                        state="PROGRESS",
                        meta={"progress": min(progress_pct, 95), "current_epoch": current_epoch, "total_epochs": epochs, "stage": "training"}
                    )
                except Exception as e:
                    print(f"[training] 进度更新异常: {e}")

            def _save_metrics_to_redis(metrics_dict: dict):
                """将训练指标写入 Redis 供前端实时展示"""
                try:
                    import redis
                    r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
                    key = f"{TRAINING_METRICS_KEY_PREFIX}{task_id}"
                    r.setex(key, TRAINING_METRICS_TTL, json.dumps(metrics_dict))
                except Exception as e:
                    print(f"[training] Redis 写入指标异常: {e}")

            # 每个完整 epoch 结束（含验证）后更新
            def on_fit_epoch_end(trainer):
                try:
                    current = getattr(trainer, "epoch", 0) + 1
                    total = getattr(trainer, "epochs", epochs)
                    progress = int(5 + 90 * current / total)
                    _update_progress(current, progress)

                    # 采集 loss、mAP 等指标写入 Redis
                    metrics_dict = {"epoch": current, "progress": progress}
                    tloss = getattr(trainer, "tloss", None)
                    if tloss is not None:
                        try:
                            v = float(tloss.mean() if hasattr(tloss, "mean") else float(tloss))
                            metrics_dict["loss"] = round(v, 4)
                        except (TypeError, ValueError):
                            pass
                    m = getattr(trainer, "metrics", None)
                    if m is not None and isinstance(m, dict):
                        for key in ("metrics/mAP50(B)", "metrics/mAP50(S)", "map50"):
                            if key in m and m[key] is not None:
                                try:
                                    metrics_dict["map50"] = round(float(m[key]), 4)
                                    break
                                except (TypeError, ValueError):
                                    pass
                        for key in ("metrics/mAP50-95(B)", "metrics/mAP50-95(S)", "map50-95"):
                            if key in m and m[key] is not None:
                                try:
                                    metrics_dict["map50_95"] = round(float(m[key]), 4)
                                    break
                                except (TypeError, ValueError):
                                    pass
                    lr_dict = getattr(trainer, "lr", None) or {}
                    if lr_dict:
                        lr_vals = [v for v in lr_dict.values() if v is not None]
                        if lr_vals:
                            try:
                                metrics_dict["lr"] = round(float(lr_vals[0]), 6)
                            except (TypeError, ValueError):
                                pass
                    _save_metrics_to_redis(metrics_dict)
                except Exception as e:
                    print(f"[training] 回调异常: {e}")

            # 每个 batch 结束轻量更新，让用户看到训练在进行（每 50 batch 更新一次 DB，避免过于频繁）
            _last_batch_progress = [0]

            def on_train_batch_end(trainer):
                try:
                    epoch = getattr(trainer, "epoch", 0)
                    batch_i = getattr(trainer, "batch_i", 0)
                    nb = max(getattr(trainer, "nb", 1), 1)
                    # 每 50 个 batch 或 epoch 末更新
                    if batch_i % 50 == 0 or batch_i >= nb - 1:
                        batch_progress = (epoch * nb + batch_i + 1) / (epochs * nb) if epochs * nb > 0 else 0
                        progress = int(5 + 90 * batch_progress)
                        if progress > _last_batch_progress[0]:
                            _last_batch_progress[0] = progress
                            _update_progress(epoch + 1, progress)
                except Exception:
                    pass

            model.add_callback("on_fit_epoch_end", on_fit_epoch_end)
            model.add_callback("on_train_batch_end", on_train_batch_end)

            has_gpu = bool(torch and torch.cuda.is_available())
            device = "cuda:0" if has_gpu else "cpu"
            workers = _resolve_workers()
            batch_resolved = _resolve_batch(batch, has_gpu)
            print(f"[training] device={device}, workers={workers}, batch={batch_resolved} (auto={batch_resolved == -1})")

            results = model.train(
                data=data_yaml_path,
                epochs=epochs,
                imgsz=imgsz,
                batch=batch_resolved,
                workers=workers,
                project=output_project,
                name="train",
                exist_ok=True,
                verbose=True,
                device=device
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
