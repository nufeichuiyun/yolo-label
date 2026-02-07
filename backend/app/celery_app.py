"""
Celery配置
"""
from celery import Celery
import os

# Redis配置
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# 创建Celery应用
celery_app = Celery(
    "afa_label",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.preannotation", "app.tasks.models"]
)

# Celery配置
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600 * 24,  # 24小时超时
    task_soft_time_limit=3600 * 23,  # 23小时软超时
    worker_prefetch_multiplier=1,  # 一次只处理一个任务
    worker_max_tasks_per_child=50,  # 防止内存泄漏
)
