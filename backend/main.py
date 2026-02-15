"""
yolo-label 后端主入口
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

app = FastAPI(
    title="yolo-label API",
    description="YOLO图像标注工具后端API",
    version="1.0.0"
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
