"""
Celery 任务公共基类：提供带数据库会话的任务基类。

单独成文件以便依赖极轻（仅 celery + app.database），可被 torch-free 的 rknn worker
镜像安全导入，不牵连 torch/ultralytics。
"""
from celery import Task
from sqlalchemy.orm import Session

from app.database import SessionLocal


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
