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
    include=[
        "app.tasks.preannotation",
        "app.tasks.models",
        "app.tasks.training",
        "app.tasks.rknn_conversion",
    ]
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
    # Redis broker 默认 visibility_timeout=3600s：训练任务常超过 1 小时，
    # 超时后 Redis 会把"未确认"消息重新投递，导致同一训练任务被无限重复执行
    # （GPU 永不释放、进度反复重置）。这里提到大于最长任务时长（≥ task_time_limit 24h）。
    broker_transport_options={"visibility_timeout": 86400 * 2},  # 48 小时
    result_backend_transport_options={"visibility_timeout": 86400 * 2},
    # 默认队列 celery 由主 worker 消费；RKNN 转换路由到独立 rknn 队列，由专用 worker 消费
    task_default_queue="celery",
    task_routes={
        "app.tasks.rknn_conversion.convert_to_rknn_task": {"queue": "rknn"},
    },
)
