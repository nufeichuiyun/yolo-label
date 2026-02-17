"""
任务包管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import User, Project, Task, TaskImage, Image, UserRole
from app.schemas import TaskCreate, TaskResponse, TaskListResponse, TaskAssignRequest, TaskReassignRequest
from app.auth import get_current_user, require_project_admin_or_super_admin
from app.routers.projects import check_project_permission

router = APIRouter(prefix="/api/tasks", tags=["任务包"])


@router.post("", response_model=TaskResponse)
async def create_task(
    task_data: TaskCreate,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """创建任务包（项目管理员或超级管理员）"""
    # 检查项目权限
    project = check_project_permission(task_data.project_id, current_user, db)
    
    # 验证图片是否属于该项目
    images = db.query(Image).filter(
        Image.id.in_(task_data.image_ids),
        Image.project_id == task_data.project_id
    ).all()
    
    if len(images) != len(task_data.image_ids):
        raise HTTPException(status_code=400, detail="部分图片不属于该项目")
    
    # 检查图片是否已被分配到其他任务包
    existing_tasks = db.query(TaskImage).filter(
        TaskImage.image_id.in_(task_data.image_ids)
    ).all()
    
    if existing_tasks:
        raise HTTPException(status_code=400, detail="部分图片已被分配到其他任务包")
    
    # 创建任务包
    db_task = Task(
        project_id=task_data.project_id,
        name=task_data.name,
        annotator_id=task_data.annotator_id,
        status="pending"
    )
    db.add(db_task)
    db.flush()  # 获取task.id
    
    # 创建任务包图片关联
    for image_id in task_data.image_ids:
        task_image = TaskImage(
            task_id=db_task.id,
            image_id=image_id
        )
        db.add(task_image)
    
    db.commit()
    db.refresh(db_task)
    
    # 获取图片数量
    image_count = len(task_data.image_ids)
    
    return {
        "id": db_task.id,
        "project_id": db_task.project_id,
        "name": db_task.name,
        "annotator_id": db_task.annotator_id,
        "status": db_task.status,
        "image_count": image_count,
        "created_at": db_task.created_at,
        "updated_at": db_task.updated_at
    }


@router.get("/project/{project_id}", response_model=TaskListResponse)
async def list_project_tasks(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的任务包列表"""
    # 检查项目权限
    project = check_project_permission(project_id, current_user, db)
    
    # 根据角色过滤任务包
    if current_user.role == UserRole.SUPER_ADMIN:
        # 超级管理员可以看到所有任务包
        tasks = db.query(Task).filter(Task.project_id == project_id).order_by(Task.id.asc()).all()
    elif current_user.role == UserRole.PROJECT_ADMIN:
        # 项目管理员可以看到所有任务包
        tasks = db.query(Task).filter(Task.project_id == project_id).order_by(Task.id.asc()).all()
    else:
        # 标注者只能看到分配给自己的任务包
        tasks = db.query(Task).filter(
            Task.project_id == project_id,
            Task.annotator_id == current_user.id
        ).order_by(Task.id.asc()).all()
    
    # 获取每个任务包的图片数量
    task_list = []
    for task in tasks:
        image_count = db.query(TaskImage).filter(TaskImage.task_id == task.id).count()
        task_list.append({
            "id": task.id,
            "project_id": task.project_id,
            "name": task.name,
            "annotator_id": task.annotator_id,
            "status": task.status,
            "image_count": image_count,
            "created_at": task.created_at,
            "updated_at": task.updated_at
        })
    
    return {"items": task_list, "total": len(task_list)}


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取任务包详情"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务包不存在")
    
    # 检查项目权限
    project = check_project_permission(task.project_id, current_user, db)
    
    # 标注者只能查看分配给自己的任务包
    if current_user.role == UserRole.ANNOTATOR and task.annotator_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务包")
    
    # 获取图片数量
    image_count = db.query(TaskImage).filter(TaskImage.task_id == task_id).count()
    
    return {
        "id": task.id,
        "project_id": task.project_id,
        "name": task.name,
        "annotator_id": task.annotator_id,
        "status": task.status,
        "image_count": image_count,
        "created_at": task.created_at,
        "updated_at": task.updated_at
    }


@router.put("/{task_id}/assign", response_model=TaskResponse)
async def assign_task(
    task_id: int,
    assign_data: TaskAssignRequest,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """分配任务包给标注者（项目管理员或超级管理员）"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务包不存在")
    
    # 检查项目权限
    project = check_project_permission(task.project_id, current_user, db)
    
    # 验证标注者是否存在且角色为标注者
    annotator = db.query(User).filter(
        User.id == assign_data.annotator_id,
        User.role == UserRole.ANNOTATOR
    ).first()
    
    if not annotator:
        raise HTTPException(status_code=400, detail="指定的用户不存在或不是标注者")
    
    # 分配任务包
    task.annotator_id = assign_data.annotator_id
    task.status = "assigned"
    db.commit()
    db.refresh(task)
    
    # 获取图片数量
    image_count = db.query(TaskImage).filter(TaskImage.task_id == task_id).count()
    
    return {
        "id": task.id,
        "project_id": task.project_id,
        "name": task.name,
        "annotator_id": task.annotator_id,
        "status": task.status,
        "image_count": image_count,
        "created_at": task.created_at,
        "updated_at": task.updated_at
    }


@router.put("/{task_id}/unassign", response_model=TaskResponse)
async def unassign_task(
    task_id: int,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """取消分配任务包（将标注者设为None）"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务包不存在")
    
    # 检查项目权限
    project = check_project_permission(task.project_id, current_user, db)
    
    # 取消分配
    task.annotator_id = None
    task.status = "pending"
    db.commit()
    db.refresh(task)
    
    # 获取图片数量
    image_count = db.query(TaskImage).filter(TaskImage.task_id == task_id).count()
    
    return {
        "id": task.id,
        "project_id": task.project_id,
        "name": task.name,
        "annotator_id": task.annotator_id,
        "status": task.status,
        "image_count": image_count,
        "created_at": task.created_at,
        "updated_at": task.updated_at
    }


@router.put("/project/{project_id}/reassign", response_model=TaskListResponse)
async def reassign_project_tasks(
    project_id: int,
    reassign_data: TaskReassignRequest,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """重新分配项目中的所有任务包图片（需要所有任务包都未分配）"""
    # 检查项目权限
    project = check_project_permission(project_id, current_user, db)
    
    # 检查所有任务包是否都未分配
    assigned_tasks = db.query(Task).filter(
        Task.project_id == project_id,
        Task.annotator_id.isnot(None)
    ).all()
    
    if assigned_tasks:
        raise HTTPException(
            status_code=400,
            detail="无法重新分配：项目中存在已分配的任务包，请先取消所有任务包的分配"
        )
    
    # 获取项目中所有图片，按文件名排序
    all_images = db.query(Image).filter(
        Image.project_id == project_id
    ).order_by(Image.filename.asc()).all()
    
    all_sorted_image_ids = [img.id for img in all_images]
    
    if not all_sorted_image_ids:
        raise HTTPException(status_code=400, detail="项目中没有图片")
    
    # 获取所有任务包ID
    all_task_ids = db.query(Task.id).filter(Task.project_id == project_id).all()
    all_task_ids = [tid[0] for tid in all_task_ids]
    
    # 删除所有现有的任务包图片关联
    if all_task_ids:
        db.query(TaskImage).filter(TaskImage.task_id.in_(all_task_ids)).delete(synchronize_session=False)
    
    # 删除所有任务包
    db.query(Task).filter(Task.project_id == project_id).delete(synchronize_session=False)
    db.flush()
    
    # 按新的images_per_task重新创建任务包
    images_per_task = reassign_data.images_per_task
    total_images = len(all_sorted_image_ids)
    task_count = (total_images + images_per_task - 1) // images_per_task
    
    created_tasks = []
    for i in range(task_count):
        start_idx = i * images_per_task
        end_idx = min(start_idx + images_per_task, total_images)
        batch_image_ids = all_sorted_image_ids[start_idx:end_idx]
        
        task_name = f"任务包 {i + 1}"
        
        # 创建任务包
        db_task = Task(
            project_id=project_id,
            name=task_name,
            annotator_id=None,
            status="pending"
        )
        db.add(db_task)
        db.flush()
        
        # 创建任务包图片关联
        for image_id in batch_image_ids:
            task_image = TaskImage(
                task_id=db_task.id,
                image_id=image_id
            )
            db.add(task_image)
        
        created_tasks.append(db_task)
    
    db.commit()
    
    # 刷新所有任务包
    for task in created_tasks:
        db.refresh(task)
    
    # 返回任务包列表
    task_list = []
    for task in created_tasks:
        # 重新查询图片数量
        image_count = db.query(TaskImage).filter(TaskImage.task_id == task.id).count()
        task_list.append({
            "id": task.id,
            "project_id": task.project_id,
            "name": task.name,
            "annotator_id": task.annotator_id,
            "status": task.status,
            "image_count": image_count,
            "created_at": task.created_at,
            "updated_at": task.updated_at
        })
    
    return {"items": task_list, "total": len(task_list)}


@router.get("/{task_id}/images", response_model=List[int])
async def get_task_images(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取任务包中的图片ID列表"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务包不存在")
    
    # 检查项目权限
    project = check_project_permission(task.project_id, current_user, db)
    
    # 标注者只能查看分配给自己的任务包
    if current_user.role == UserRole.ANNOTATOR and task.annotator_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务包")
    
    # 获取图片ID列表，按文件名排序
    task_images = db.query(TaskImage).join(Image).filter(
        TaskImage.task_id == task_id
    ).order_by(Image.filename.asc()).all()
    image_ids = [ti.image_id for ti in task_images]
    
    return image_ids


@router.get("/user/my-tasks", response_model=TaskListResponse)
async def list_my_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前用户的所有任务包（跨项目）"""
    # 标注者只能看到分配给自己的任务包
    if current_user.role == UserRole.ANNOTATOR:
        tasks = db.query(Task).filter(
            Task.annotator_id == current_user.id
        ).order_by(Task.project_id.asc(), Task.id.asc()).all()
    elif current_user.role == UserRole.PROJECT_ADMIN:
        # 项目管理员可以看到自己参与的项目中的所有任务包
        from app.models import ProjectUser
        project_ids = db.query(ProjectUser.project_id).filter(
            ProjectUser.user_id == current_user.id
        ).all()
        project_ids = [pid[0] for pid in project_ids]
        # 加上自己创建的项目
        created_project_ids = db.query(Project.id).filter(
            Project.creator_id == current_user.id
        ).all()
        project_ids.extend([pid[0] for pid in created_project_ids])
        project_ids = list(set(project_ids))
        
        if project_ids:
            tasks = db.query(Task).filter(
                Task.project_id.in_(project_ids)
            ).order_by(Task.project_id.asc(), Task.id.asc()).all()
        else:
            tasks = []
    else:
        # 超级管理员可以看到所有任务包
        tasks = db.query(Task).order_by(Task.project_id.asc(), Task.id.asc()).all()
    
    # 获取每个任务包的图片数量和项目信息
    task_list = []
    for task in tasks:
        image_count = db.query(TaskImage).filter(TaskImage.task_id == task.id).count()
        task_list.append({
            "id": task.id,
            "project_id": task.project_id,
            "name": task.name,
            "annotator_id": task.annotator_id,
            "status": task.status,
            "image_count": image_count,
            "created_at": task.created_at,
            "updated_at": task.updated_at
        })
    
    return {"items": task_list, "total": len(task_list)}


@router.get("/image/{image_id}/task")
async def get_image_task(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """根据图片ID获取所属的任务包"""
    # 检查图片是否存在
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限
    check_project_permission(image.project_id, current_user, db)
    
    # 查找图片所属的任务包
    task_image = db.query(TaskImage).filter(TaskImage.image_id == image_id).first()
    if not task_image:
        return None
    
    task = db.query(Task).filter(Task.id == task_image.task_id).first()
    if not task:
        return None
    
    # 标注者只能查看分配给自己的任务包
    if current_user.role == UserRole.ANNOTATOR and task.annotator_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务包")
    
    # 获取图片数量
    image_count = db.query(TaskImage).filter(TaskImage.task_id == task.id).count()
    
    return {
        "id": task.id,
        "project_id": task.project_id,
        "name": task.name,
        "annotator_id": task.annotator_id,
        "status": task.status,
        "image_count": image_count,
        "created_at": task.created_at,
        "updated_at": task.updated_at
    }
