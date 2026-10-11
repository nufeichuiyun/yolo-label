"""
预标注路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import uuid
from celery.result import AsyncResult
from app.database import get_db
from app.models import User, PreAnnotationTask, Project, Model, UserRole
from app.schemas import PreAnnotationTaskCreate, PreAnnotationTaskResponse
from app.auth import get_current_user, require_project_admin_or_super_admin
from app.routers.projects import check_project_permission
from app.celery_app import celery_app
from app.tasks.preannotation import preannotate_project_task

router = APIRouter(prefix="/api/preannotation", tags=["预标注"])


@router.post("", response_model=PreAnnotationTaskResponse)
async def create_preannotation_task(
    task_data: PreAnnotationTaskCreate,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """创建预标注任务"""
    # 检查项目权限
    project = check_project_permission(task_data.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    # 检查模型是否存在
    # 整项目推理只使用该项目的模型；旧全局模型不能绕过项目隔离。
    model = db.query(Model).filter(
        Model.id == task_data.model_id,
        Model.project_id == task_data.project_id,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    
    # 检查项目是否有图片
    from app.models import Image
    images = db.query(Image).filter(Image.project_id == task_data.project_id).all()
    if len(images) == 0:
        raise HTTPException(status_code=400, detail="项目中没有图片")
    
    # 生成任务ID
    task_id = str(uuid.uuid4())
    
    # 创建任务记录
    db_task = PreAnnotationTask(
        project_id=task_data.project_id,
        model_id=task_data.model_id,
        task_id=task_id,
        status="pending",
        progress=0,
        total_images=len(images),
        processed_images=0,
        selected_classes=str(task_data.selected_classes),  # 存储为JSON字符串
        created_by=current_user.id
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    
    # 启动Celery任务（异步执行）
    preannotate_project_task.delay(
        task_id=task_id,
        project_id=task_data.project_id,
        model_id=task_data.model_id,
        selected_classes=task_data.selected_classes,
        conf_threshold=0.25  # 默认置信度阈值
    )
    
    return db_task


@router.get("/task/{task_id}", response_model=PreAnnotationTaskResponse)
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取任务状态"""
    task = db.query(PreAnnotationTask).filter(PreAnnotationTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 检查权限（只有创建者或项目成员可以查看）
    check_project_permission(task.project_id, current_user, db)
    
    # 如果任务正在运行，尝试从Celery获取最新状态
    if task.status == "running":
        try:
            celery_result = AsyncResult(task_id, app=celery_app)
            if celery_result.state == "PROGRESS":
                # 更新进度
                meta = celery_result.info
                if isinstance(meta, dict):
                    task.progress = meta.get("progress", task.progress)
                    task.processed_images = meta.get("current", task.processed_images)
                    db.commit()
            elif celery_result.state == "SUCCESS":
                task.status = "completed"
                task.progress = 100
                db.commit()
            elif celery_result.state == "FAILURE":
                task.status = "failed"
                task.error_message = str(celery_result.info)
                db.commit()
        except Exception as e:
            print(f"获取Celery任务状态失败: {e}")
    
    return task


@router.get("/project/{project_id}", response_model=List[PreAnnotationTaskResponse])
async def list_project_tasks(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的所有预标注任务"""
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    tasks = db.query(PreAnnotationTask).filter(
        PreAnnotationTask.project_id == project_id
    ).order_by(PreAnnotationTask.created_at.desc()).all()
    
    return tasks


@router.delete("/task/{task_id}")
async def cancel_task(
    task_id: str,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """取消任务（仅限pending状态）"""
    task = db.query(PreAnnotationTask).filter(PreAnnotationTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 取消整项目任务与启动任务使用相同的管理权限。
    check_project_permission(task.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    if task.status == "running":
        raise HTTPException(status_code=400, detail="无法取消正在运行的任务")
    
    if task.status == "completed":
        raise HTTPException(status_code=400, detail="任务已完成，无法取消")
    
    # 取消Celery任务
    try:
        celery_app.control.revoke(task_id, terminate=True)
    except Exception as e:
        print(f"取消Celery任务失败: {e}")
    
    # 删除任务记录
    db.delete(task)
    db.commit()
    
    return {"message": "任务已取消"}
