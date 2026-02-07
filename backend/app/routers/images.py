"""
图片管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from PIL import Image as PILImage
import os
import shutil
from app.database import get_db
from app.models import User, Image, Project, Annotation, Task, TaskImage, UserRole
from app.schemas import ImageResponse, ImageListResponse
from app.auth import get_current_user
from app.routers.projects import check_project_permission
from sqlalchemy import func, and_

router = APIRouter(prefix="/api/images", tags=["图片"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def get_image_size(filepath: str) -> tuple:
    """获取图片尺寸"""
    try:
        with PILImage.open(filepath) as img:
            return img.size
    except Exception:
        return None, None


@router.post("/upload/{project_id}")
async def upload_images(
    project_id: int,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """上传图片（支持批量上传，自动分批处理以避免超时）"""
    import sys
    import asyncio
    sys.stdout.flush()  # 确保输出立即刷新
    try:
        print(f"[DEBUG] 收到上传请求，项目ID: {project_id}, 文件数量: {len(files) if files else 0}", flush=True)
        
        # 检查文件列表是否为空
        if not files or len(files) == 0:
            print("[ERROR] 文件列表为空", flush=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未提供文件"
            )
        
        # 检查项目权限并刷新项目信息
        project = check_project_permission(project_id, current_user, db)
        db.refresh(project)  # 确保获取最新的images_per_task值
        
        # 创建项目目录
        project_dir = os.path.join(UPLOAD_DIR, "images", str(project_id))
        os.makedirs(project_dir, exist_ok=True)
        
        uploaded_images = []
        
        # 处理文件上传（支持大量文件，使用异步处理避免阻塞）
        for idx, file in enumerate(files):
            # 每处理100个文件，输出一次进度
            if idx > 0 and idx % 100 == 0:
                print(f"[DEBUG] 已处理 {idx}/{len(files)} 个文件", flush=True)
                # 定期提交，避免事务过大
                if len(uploaded_images) > 0:
                    db.commit()
                    for img in uploaded_images:
                        db.refresh(img)
            
            # 检查文件扩展名
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext not in ALLOWED_EXTENSIONS:
                continue
            
            try:
                # 清理文件名，移除可能导致问题的字符，但保留中文和基本特殊字符
                # 只移除路径分隔符和危险字符
                safe_filename = file.filename.replace('/', '_').replace('\\', '_').replace('..', '_')
                
                # 保存文件
                filepath = os.path.join(project_dir, safe_filename)
                with open(filepath, "wb") as buffer:
                    shutil.copyfileobj(file.file, buffer)
                
                # 验证文件是否成功保存
                if not os.path.exists(filepath):
                    print(f"警告：文件保存后不存在: {filepath}", flush=True)
                    continue
                
                # 获取图片尺寸
                width, height = get_image_size(filepath)
                file_size = os.path.getsize(filepath)
                
                # 验证文件大小
                if file_size == 0:
                    print(f"警告：文件大小为0，跳过: {filepath}", flush=True)
                    os.remove(filepath)  # 删除空文件
                    continue
                
                # 创建数据库记录
                relative_path = f"images/{project_id}/{safe_filename}"
                db_image = Image(
                    project_id=project_id,
                    filename=safe_filename,
                    filepath=relative_path,
                    width=width,
                    height=height,
                    file_size=file_size
                )
                db.add(db_image)
                uploaded_images.append(db_image)
            except Exception as e:
                print(f"上传文件失败: {file.filename}, 错误: {str(e)}", flush=True)
                continue
        
        db.commit()
        
        for img in uploaded_images:
            db.refresh(img)
        
        # 如果项目设置了images_per_task，自动创建任务包
        if project.images_per_task and project.images_per_task > 0:
            # 检查哪些图片已经被分配到任务包
            uploaded_image_ids = [img.id for img in uploaded_images]
            existing_task_images = db.query(TaskImage.image_id).filter(
                TaskImage.image_id.in_(uploaded_image_ids)
            ).all()
            existing_image_ids = {ti[0] for ti in existing_task_images}
            
            # 只使用未分配的图片创建任务包
            unassigned_images = [img for img in uploaded_images if img.id not in existing_image_ids]
            
            if unassigned_images:
                # 使用刚刚上传的未分配图片创建任务包，按文件名排序
                uploaded_images_sorted = sorted(unassigned_images, key=lambda img: img.filename)
                unassigned_image_ids = [img.id for img in uploaded_images_sorted]
                images_per_task = project.images_per_task
                
                # 计算需要创建的任务包数量（最后一个任务包可能少于images_per_task）
                total_images = len(unassigned_image_ids)
                task_count = (total_images + images_per_task - 1) // images_per_task
                
                # 获取当前项目中已有的任务包数量，用于命名
                existing_task_count = db.query(Task).filter(Task.project_id == project_id).count()
                
                for i in range(task_count):
                    start_idx = i * images_per_task
                    end_idx = min(start_idx + images_per_task, total_images)
                    batch_image_ids = unassigned_image_ids[start_idx:end_idx]
                    
                    task_name = f"任务包 {existing_task_count + i + 1}"
                    
                    # 创建任务包
                    db_task = Task(
                        project_id=project_id,
                        name=task_name,
                        annotator_id=None,  # 未分配，等待管理员分配
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
                
                db.commit()
                last_task_count = len(unassigned_image_ids) % images_per_task
                if last_task_count == 0:
                    last_task_count = images_per_task
                print(f"[DEBUG] 自动创建了 {task_count} 个任务包，最后任务包包含 {last_task_count} 张图片")
            else:
                print(f"[DEBUG] 所有上传的图片都已被分配到任务包，跳过自动创建")
        
        failed_count = len(files) - len(uploaded_images)
        print(f"[DEBUG] 上传完成，成功: {len(uploaded_images)}, 失败: {failed_count}")
        return {
            "message": f"成功上传 {len(uploaded_images)} 张图片" + (f"，失败 {failed_count} 张" if failed_count > 0 else ""),
            "images": uploaded_images,
            "success_count": len(uploaded_images),
            "failed_count": failed_count,
            "total_count": len(files)
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] 上传图片时发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"上传失败: {str(e)}"
        )


@router.get("/project/{project_id}", response_model=ImageListResponse)
async def list_project_images(
    project_id: int,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的图片列表"""
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    # 根据角色过滤图片
    if current_user.role == UserRole.ANNOTATOR:
        # 标注者只能看到自己任务包中的图片
        task_ids = db.query(Task.id).filter(
            Task.project_id == project_id,
            Task.annotator_id == current_user.id
        ).all()
        task_ids = [tid[0] for tid in task_ids]
        
        if not task_ids:
            return {"items": [], "total": 0}
        
        # 获取任务包中的图片ID
        image_ids = db.query(TaskImage.image_id).filter(
            TaskImage.task_id.in_(task_ids)
        ).all()
        image_ids = [iid[0] for iid in image_ids]
        
        if not image_ids:
            return {"items": [], "total": 0}
        
        total = len(image_ids)
        # 按ID排序，确保顺序一致，并统计每张图片的标注数量
        images = db.query(
            Image,
            func.count(Annotation.id).label('annotation_count')
        ).outerjoin(
            Annotation, Image.id == Annotation.image_id
        ).filter(
            Image.id.in_(image_ids)
        ).group_by(Image.id).order_by(Image.id.asc()).offset(skip).limit(limit).all()
    else:
        # 项目管理员和超级管理员可以看到所有图片
        total = db.query(Image).filter(Image.project_id == project_id).count()
        # 按ID排序，确保顺序一致，并统计每张图片的标注数量
        images = db.query(
            Image,
            func.count(Annotation.id).label('annotation_count')
        ).outerjoin(
            Annotation, Image.id == Annotation.image_id
        ).filter(
            Image.project_id == project_id
        ).group_by(Image.id).order_by(Image.id.asc()).offset(skip).limit(limit).all()
    
    # 转换为响应格式，包含标注数量
    image_list = []
    for image, annotation_count in images:
        # 检查文件是否存在
        full_filepath = os.path.join(UPLOAD_DIR, image.filepath)
        file_exists = os.path.exists(full_filepath)
        
        if not file_exists:
            print(f"警告：图片文件不存在: {full_filepath}, image_id: {image.id}")
        
        image_dict = {
            "id": image.id,
            "project_id": image.project_id,
            "filename": image.filename,
            "filepath": image.filepath,
            "width": image.width,
            "height": image.height,
            "file_size": image.file_size,
            "is_annotated": image.is_annotated,
            "annotation_count": annotation_count or 0,
            "created_at": image.created_at
        }
        image_list.append(image_dict)
    
    return {"items": image_list, "total": total}


@router.get("/{image_id}", response_model=ImageResponse)
async def get_image(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取图片详情"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限
    check_project_permission(image.project_id, current_user, db)
    
    # 检查文件是否存在
    full_filepath = os.path.join(UPLOAD_DIR, image.filepath)
    if not os.path.exists(full_filepath):
        print(f"警告：图片文件不存在: {full_filepath}, image_id: {image_id}, filepath: {image.filepath}, filename: {image.filename}")
        # 尝试查找文件（可能是路径问题）
        project_dir = os.path.join(UPLOAD_DIR, "images", str(image.project_id))
        if os.path.exists(project_dir):
            files_in_dir = os.listdir(project_dir)
            print(f"项目目录中的文件: {files_in_dir}")
            if image.filename in files_in_dir:
                print(f"找到文件但路径不匹配，实际路径应为: images/{image.project_id}/{image.filename}")
    
    # 获取标注数量
    annotation_count = db.query(func.count(Annotation.id)).filter(
        Annotation.image_id == image_id
    ).scalar() or 0
    
    # 构建响应
    image_dict = {
        "id": image.id,
        "project_id": image.project_id,
        "filename": image.filename,
        "filepath": image.filepath,
        "width": image.width,
        "height": image.height,
        "file_size": image.file_size,
        "is_annotated": image.is_annotated,
        "annotation_count": annotation_count,
        "created_at": image.created_at
    }
    
    return image_dict


@router.delete("/{image_id}")
async def delete_image(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除图片"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限（需要项目管理员权限）
    check_project_permission(image.project_id, current_user, db, UserRole.PROJECT_ADMIN)
    
    # 删除文件
    filepath = os.path.join(UPLOAD_DIR, image.filepath)
    if os.path.exists(filepath):
        os.remove(filepath)
    
    # 删除数据库记录
    db.delete(image)
    db.commit()
    
    return {"message": "图片已删除"}
