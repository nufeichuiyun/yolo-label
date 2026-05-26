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
    后端启动时清扫"孤儿"任务：把所有 status='running'/'pending' 的 Celery 关联任务
    标记为 failed。原因：worker 用 solo pool + concurrency=1，后端启动那一刻不可能
    真有任务正在运行；任何遗留的 running/pending 都是上次异常关机的残留，必须清理，
    否则会触发"该项目已有训练任务正在运行"等校验导致死锁。
    """
    try:
        from sqlalchemy import or_
        from app.database import SessionLocal
        from app.models import TrainingTask, PreAnnotationTask
    except Exception as e:
        logging.warning("启动清扫孤儿任务跳过（导入失败）: %s", e)
        return

    db = SessionLocal()
    try:
        msg = "后端启动时清扫（上次未正常结束）"
        n_train = (
            db.query(TrainingTask)
            .filter(TrainingTask.status.in_(["running", "pending"]))
            .update(
                {TrainingTask.status: "failed", TrainingTask.error_message: msg},
                synchronize_session=False,
            )
        )
        # 训练任务里 rknn 在独立 worker 上，但 worker 同样单并发；启动时也不可能在跑
        n_rknn = (
            db.query(TrainingTask)
            .filter(TrainingTask.rknn_status.in_(["pending", "converting"]))
            .update(
                {TrainingTask.rknn_status: "failed", TrainingTask.rknn_error: msg},
                synchronize_session=False,
            )
        )
        n_pre = (
            db.query(PreAnnotationTask)
            .filter(PreAnnotationTask.status.in_(["running", "pending"]))
            .update(
                {PreAnnotationTask.status: "failed", PreAnnotationTask.error_message: msg},
                synchronize_session=False,
            )
        )
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
