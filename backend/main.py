"""
yolo-label 后端主入口
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os


def _cleanup_orphan_tasks() -> None:
    """
    后端启动时清扫"孤儿"任务：把上次异常关机残留的 running/pending 任务标记为 failed，
    否则会触发"该项目已有训练任务正在运行"等校验导致死锁。

    注意（关键）：不能假设"后端启动时不可能有任务在跑"。后端与 worker 是独立容器、
    可各自重启；worker 用 solo pool，长任务（训练/转换）期间主进程被完全阻塞，连
    Celery 心跳/inspect 都无法应答，因此判断"是否在跑"不能依赖 inspect。改为依据由
    未被阻塞的组件主动写入的 Redis 短 TTL 心跳（见 app.task_heartbeat）：
    有心跳=真在跑，跳过；无心跳=孤儿，清扫。这样后端重启不会误杀正在运行的任务。
    （仍在队列等待、尚未启动的 pending 无心跳会被标 failed，但 worker 真正执行它时会
    重新置为 running，可自愈，无害。）
    """
    try:
        from app.database import SessionLocal
        from app.models import TrainingTask, PreAnnotationTask
        from app.task_heartbeat import alive_keys
    except Exception as e:
        logging.warning("启动清扫孤儿任务跳过（导入失败）: %s", e)
        return

    db = SessionLocal()
    try:
        msg = "后端启动时清扫（上次未正常结束）"

        # 训练：按 task_id(UUID) 匹配心跳
        train_rows = (
            db.query(TrainingTask)
            .filter(TrainingTask.status.in_(["running", "pending"]))
            .all()
        )
        train_alive = alive_keys(t.task_id for t in train_rows)
        n_train = 0
        for t in train_rows:
            if t.task_id not in train_alive:
                t.status = "failed"
                t.error_message = msg
                n_train += 1

        # RKNN：在独立 rknn-worker 上转换，心跳键加 rknn: 前缀、按整数主键 id 匹配
        rknn_rows = (
            db.query(TrainingTask)
            .filter(TrainingTask.rknn_status.in_(["pending", "converting"]))
            .all()
        )
        rknn_alive = alive_keys(f"rknn:{t.id}" for t in rknn_rows)
        n_rknn = 0
        for t in rknn_rows:
            if f"rknn:{t.id}" not in rknn_alive:
                t.rknn_status = "failed"
                t.rknn_error = msg
                n_rknn += 1

        # 预标注：同样按 task_id(UUID) 匹配心跳
        pre_rows = (
            db.query(PreAnnotationTask)
            .filter(PreAnnotationTask.status.in_(["running", "pending"]))
            .all()
        )
        pre_alive = alive_keys(p.task_id for p in pre_rows)
        n_pre = 0
        for p in pre_rows:
            if p.task_id not in pre_alive:
                p.status = "failed"
                p.error_message = msg
                n_pre += 1

        db.commit()
        if n_train or n_rknn or n_pre:
            logging.info(
                "启动清扫孤儿任务完成 training=%d rknn=%d preannotation=%d",
                n_train, n_rknn, n_pre,
            )
    except Exception as e:
        db.rollback()
        logging.warning("启动清扫孤儿任务失败: %s", e)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _cleanup_orphan_tasks()
    yield


app = FastAPI(
    title="yolo-label API",
    description="YOLO图像标注工具后端API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS配置 - 允许所有来源（开发环境）
# 生产环境应该限制为特定域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源，支持局域网访问
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件服务（用于图片访问）
# 使用环境变量指定的目录，如果没有则使用默认目录
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 模型目录
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(os.path.dirname(__file__), "models"))
os.makedirs(MODEL_DIR, exist_ok=True)

# 自定义静态文件处理器，支持URL编码的文件名
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from urllib.parse import unquote
import os

class CustomStaticFiles(StaticFiles):
    async def __call__(self, scope, receive, send):
        # 解码URL路径，处理URL编码的文件名
        if scope["type"] == "http":
            path = scope.get("path", "")
            # 解码URL编码的路径（多次解码以处理双重编码的情况）
            decoded_path = unquote(unquote(path))
            scope["path"] = decoded_path
            print(f"静态文件请求 - 原始路径: {path}, 解码后路径: {decoded_path}")
        return await super().__call__(scope, receive, send)

app.mount("/uploads", CustomStaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.get("/")
async def root():
    return {"message": "yolo-label API", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}

# 导入路由
from app.routers import auth, projects, images, categories, annotations, stats, export, models, preannotation, tasks, users, training

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(images.router)
app.include_router(categories.router)
app.include_router(annotations.router)
app.include_router(stats.router)
app.include_router(export.router)
app.include_router(models.router)
app.include_router(preannotation.router)
app.include_router(tasks.router)
app.include_router(users.router)
app.include_router(training.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
