"""
统计相关路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import User, Project, Image, Annotation, Category, Task, TaskImage, UserRole
from app.schemas import ProjectStats, TaskStats
from app.auth import get_current_user
from app.routers.projects import check_project_permission

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/project/{project_id}", response_model=ProjectStats)
async def get_project_stats(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目统计信息"""
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    # 统计图片数量
    total_images = db.query(Image).filter(Image.project_id == project_id).count()
    annotated_images = db.query(Image).filter(
        Image.project_id == project_id,
        Image.is_annotated == True
    ).count()
    
    # 统计标注数量
    total_annotations = db.query(Annotation).join(Image).filter(
        Image.project_id == project_id
    ).count()
    
    # 统计类别数量
    categories_count = db.query(Category).filter(Category.project_id == project_id).count()
    
    return ProjectStats(
        project_id=project_id,
        total_images=total_images,
        annotated_images=annotated_images,
        total_annotations=total_annotations,
        categories_count=categories_count
    )


@router.get("/task/{task_id}", response_model=TaskStats)
async def get_task_stats(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取任务包统计信息"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务包不存在")
    
    # 检查项目权限
    check_project_permission(task.project_id, current_user, db)
    
    # 标注者只能查看分配给自己的任务包
    if current_user.role == UserRole.ANNOTATOR and task.annotator_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务包")
    
    # 获取任务包中的图片ID列表
    task_image_ids = db.query(TaskImage.image_id).filter(
        TaskImage.task_id == task_id
    ).all()
    task_image_ids = [tid[0] for tid in task_image_ids]
    
    if not task_image_ids:
        return TaskStats(
            task_id=task_id,
            total_images=0,
            annotated_images=0
        )
    
    # 统计任务包中的图片数量
    total_images = len(task_image_ids)
    
    # 统计已标注的图片数量
    annotated_images = db.query(Image).filter(
        Image.id.in_(task_image_ids),
        Image.is_annotated == True
    ).count()
    
    return TaskStats(
        task_id=task_id,
        total_images=total_images,
        annotated_images=annotated_images
    )
