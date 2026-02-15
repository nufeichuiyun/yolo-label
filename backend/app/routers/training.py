"""
训练路由
"""
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import User, TrainingTask, Project, Category, UserRole
from app.schemas import TrainingTaskCreate, TrainingTaskResponse
from app.auth import get_current_user
from app.routers.projects import check_project_permission
from app.services.training_service import (
    get_annotated_images_for_project,
    get_default_base_model,
    get_available_base_models,
)
from app.tasks.training import train_model_task

router = APIRouter(prefix="/api/training", tags=["训练"])
MODEL_DIR = os.getenv("MODEL_DIR", "./models")


@router.post("", response_model=TrainingTaskResponse)
async def create_training_task(
    task_data: TrainingTaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建训练任务（仅项目管理员或超级管理员可操作）"""
    project = check_project_permission(
        task_data.project_id, current_user, db,
        required_role=UserRole.PROJECT_ADMIN
    )

    # 校验：至少 2 个类别
    categories = db.query(Category).filter(Category.project_id == task_data.project_id).all()
    if len(categories) < 2:
        raise HTTPException(status_code=400, detail="项目至少需要 2 个类别")

    # 校验：至少 10 张已标注图片
    images = get_annotated_images_for_project(db, task_data.project_id)
    if len(images) < 10:
        raise HTTPException(status_code=400, detail="项目至少需要 10 张已标注图片")

    # 校验：同一项目不能有运行中的训练任务
    running = db.query(TrainingTask).filter(
        TrainingTask.project_id == task_data.project_id,
        TrainingTask.status == "running"
    ).first()
    if running:
        raise HTTPException(status_code=400, detail="该项目已有训练任务正在运行，请等待完成")

    # 确定基础模型
    base_model = task_data.base_model or get_default_base_model(project.annotation_type.value)
    epochs = task_data.epochs or 100
    imgsz = task_data.imgsz or 640
    batch = task_data.batch or 16
    train_split = task_data.train_split or 0.8

    task_id = str(uuid.uuid4())
    db_task = TrainingTask(
        project_id=task_data.project_id,
        base_model=base_model,
        task_id=task_id,
        status="pending",
        progress=0,
        epochs=epochs,
        current_epoch=0,
        train_images=0,
        val_images=0,
        created_by=current_user.id
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    train_model_task.delay(
        task_id=task_id,
        project_id=task_data.project_id,
        base_model=base_model,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        train_split=train_split
    )

    return db_task


@router.get("/task/{task_id}", response_model=TrainingTaskResponse)
async def get_training_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取训练任务状态"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db)
    return task


@router.get("/project/{project_id}", response_model=List[TrainingTaskResponse])
async def list_project_training_tasks(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的所有训练任务"""
    check_project_permission(project_id, current_user, db)
    tasks = db.query(TrainingTask).filter(
        TrainingTask.project_id == project_id
    ).order_by(TrainingTask.created_at.desc()).all()
    return tasks


@router.get("/project/{project_id}/base-models")
async def get_base_models(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目可用的基础模型列表（根据标注类型）"""
    project = check_project_permission(project_id, current_user, db)
    models = get_available_base_models(project.annotation_type.value)
    default = get_default_base_model(project.annotation_type.value)
    return {"models": models, "default": default}


@router.get("/download/{task_id}")
async def download_trained_model(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """下载训练完成的模型"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db)

    if task.status != "completed":
        raise HTTPException(status_code=400, detail="任务未完成，无法下载模型")

    if not task.output_model_path:
        raise HTTPException(status_code=404, detail="未找到输出模型")

    file_path = os.path.join(MODEL_DIR, task.output_model_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")

    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=task.output_model_path
    )
