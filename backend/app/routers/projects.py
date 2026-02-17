"""
项目管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import User, Project, ProjectUser, UserRole, Image
from app.schemas import ProjectCreate, ProjectResponse, ProjectListResponse
from app.auth import get_current_user, require_project_admin_or_super_admin

router = APIRouter(prefix="/api/projects", tags=["项目"])


def check_project_permission(
    project_id: int,
    user: User,
    db: Session,
    required_role: UserRole = None
) -> Project:
    """检查项目权限"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    # 超级管理员有所有权限
    if user.role == UserRole.SUPER_ADMIN:
        return project
    
    # 检查是否是项目创建者
    if project.creator_id == user.id:
        return project
    
    # 检查项目用户关联
    project_user = db.query(ProjectUser).filter(
        ProjectUser.project_id == project_id,
        ProjectUser.user_id == user.id
    ).first()
    
    # 如果用户是标注者且没有在ProjectUser表中，检查是否有分配给他们的任务包
    if not project_user and user.role == UserRole.ANNOTATOR:
        from app.models import Task
        assigned_task = db.query(Task).filter(
            Task.project_id == project_id,
            Task.annotator_id == user.id
        ).first()
        
        if assigned_task:
            # 标注者有分配给他们的任务包
            # 如果要求特定角色权限，标注者不能执行（需要项目管理员权限）
            if required_role:
                raise HTTPException(status_code=403, detail="权限不足")
            # 否则允许访问
            return project
    
    if not project_user:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    
    if required_role and project_user.role != required_role and user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="权限不足")
    
    return project


@router.post("", response_model=ProjectResponse)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """创建项目"""
    db_project = Project(
        name=project_data.name,
        description=project_data.description,
        annotation_type=project_data.annotation_type,
        images_per_task=project_data.images_per_task,
        creator_id=current_user.id
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    # 将创建者添加为项目管理员
    project_user = ProjectUser(
        project_id=db_project.id,
        user_id=current_user.id,
        role=UserRole.PROJECT_ADMIN
    )
    db.add(project_user)
    db.commit()
    
    # 注意：任务包创建将在图片上传后根据images_per_task自动创建
    # 这里先保存images_per_task到项目描述或其他地方，或者创建一个新的字段
    # 为了简化，我们可以在图片上传时检查项目是否有images_per_task设置
    
    return db_project


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目列表"""
    # 超级管理员可以看到所有项目
    if current_user.role == UserRole.SUPER_ADMIN:
        total = db.query(Project).count()
        projects = db.query(Project).offset(skip).limit(limit).all()
    elif current_user.role == UserRole.PROJECT_ADMIN:
        # 项目管理员可以看到自己创建或参与的项目
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
        
        total = len(project_ids)
        projects = db.query(Project).filter(Project.id.in_(project_ids)).offset(skip).limit(limit).all()
    else:
        # 标注者只能看到自己被分配了任务的项目
        from app.models import Task
        task_project_ids = db.query(Task.project_id).filter(
            Task.annotator_id == current_user.id
        ).distinct().all()
        project_ids = [pid[0] for pid in task_project_ids]
        
        total = len(project_ids)
        projects = db.query(Project).filter(Project.id.in_(project_ids)).offset(skip).limit(limit).all() if project_ids else []
    
    return {"items": projects, "total": total}


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目详情"""
    project = check_project_permission(project_id, current_user, db)
    return project


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新项目"""
    project = check_project_permission(project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    project.name = project_data.name
    project.description = project_data.description
    # 注意：标注类型创建后不能修改
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除项目"""
    project = check_project_permission(project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    try:
        # 删除关联数据（由于设置了cascade，应该自动删除，但为了安全还是显式删除）
        # 1. 删除标注
        from app.models import Annotation, Image, Category, ProjectUser
        images = db.query(Image).filter(Image.project_id == project_id).all()
        for image in images:
            # 删除图片的标注
            db.query(Annotation).filter(Annotation.image_id == image.id).delete()
            # 删除YOLO标注文件
            import os
            annotation_dir = os.getenv("ANNOTATION_DIR", "./annotations")
            image_name = os.path.splitext(image.filename)[0]
            annotation_file = os.path.join(annotation_dir, str(project_id), f"{image_name}.txt")
            if os.path.exists(annotation_file):
                try:
                    os.remove(annotation_file)
                except:
                    pass
            # 删除图片文件
            upload_dir = os.getenv("UPLOAD_DIR", "./uploads")
            image_file = os.path.join(upload_dir, image.filepath)
            if os.path.exists(image_file):
                try:
                    os.remove(image_file)
                except:
                    pass
        
        # 2. 删除图片记录
        db.query(Image).filter(Image.project_id == project_id).delete()
        
        # 3. 删除类别
        db.query(Category).filter(Category.project_id == project_id).delete()
        
        # 4. 删除项目用户关联
        db.query(ProjectUser).filter(ProjectUser.project_id == project_id).delete()

        # 5. 删除训练产物（训练输出、归档、训练得到的模型）
        import os
        import shutil
        import glob
        from app.models import TrainingTask

        training_output_dir = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")
        model_dir = os.getenv("MODEL_DIR", "./models")

        # 删除训练归档（zip）
        for t in db.query(TrainingTask).filter(TrainingTask.project_id == project_id).all():
            if t.output_archive_path:
                archive_path = os.path.join(training_output_dir, t.output_archive_path)
                if os.path.exists(archive_path):
                    try:
                        os.remove(archive_path)
                    except Exception:
                        pass

        # 删除训练输出目录 project_{id}
        project_output = os.path.join(training_output_dir, f"project_{project_id}")
        if os.path.exists(project_output):
            try:
                shutil.rmtree(project_output)
            except Exception:
                pass

        # 删除该项目训练得到的模型文件 trained_{project_id}_*.pt
        for pt in glob.glob(os.path.join(model_dir, f"trained_{project_id}_*.pt")):
            try:
                os.remove(pt)
            except Exception:
                pass
        
        # 6. 删除项目目录（上传、标注）
        upload_dir = os.getenv("UPLOAD_DIR", "./uploads")
        annotation_dir = os.getenv("ANNOTATION_DIR", "./annotations")
        project_upload_dir = os.path.join(upload_dir, "images", str(project_id))
        project_annotation_dir = os.path.join(annotation_dir, str(project_id))
        
        if os.path.exists(project_upload_dir):
            try:
                shutil.rmtree(project_upload_dir)
            except:
                pass
        
        if os.path.exists(project_annotation_dir):
            try:
                shutil.rmtree(project_annotation_dir)
            except:
                pass
        
        # 7. 删除项目记录
        db.delete(project)
        db.commit()
        
        return {"message": "项目已删除"}
    except Exception as e:
        db.rollback()
        import traceback
        error_detail = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"删除项目失败: {error_detail}")
