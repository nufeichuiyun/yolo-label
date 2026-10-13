"""跨进程取消检查，不依赖 solo worker 能否处理 Celery 控制消息。"""
from app.database import SessionLocal
from app.models import TrainingTask


def cancelled(task):
    return bool(task and task.status == 'failed' and (task.error_message or '').startswith('用户中断'))


def check_cancelled(task_id):
    with SessionLocal() as db:
        task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
        if cancelled(task):
            raise RuntimeError('用户中断：训练已在检查点停止')
