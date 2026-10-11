"""
图片管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy.orm import Session
from typing import List
from PIL import Image as PILImage
import os
import shutil
from uuid import uuid4
from app.database import get_db
from app.models import User, Image, Project, Annotation, Task, TaskImage, UserRole
from app.schemas import ImageResponse, ImageListResponse
from app.auth import get_current_user
from app.routers.projects import check_project_permission
from sqlalchemy import func, and_

router = APIRouter(prefix="/api/images", tags=["图片"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def check_image_permission(image: Image, user: User, db: Session) -> None:
    """图片内容和详情遵循与标注列表相同的项目及任务权限。"""
    check_project_permission(image.project_id, user, db)
    if user.role == UserRole.ANNOTATOR:
        assigned = db.query(TaskImage).join(Task).filter(
            TaskImage.image_id == image.id,
            Task.project_id == image.project_id,
            Task.annotator_id == user.id,
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="该图片不在您的任务包中")


@router.get("/{image_id}/content")
async def get_image_content(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """凭图片 ID 获取原图，不接受客户端文件路径或 URL 中的令牌。"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    check_image_permission(image, current_user, db)

    root = Path(UPLOAD_DIR).resolve()
    project_dir = (root / "images" / str(image.project_id)).resolve()
    filepath = (root / image.filepath).resolve()
    # 旧数据库路径无需迁移；同时拒绝路径穿越、跨项目路径和指向目录外的软链接。
    if (not project_dir.is_relative_to(root)
            or not filepath.is_relative_to(project_dir)
            or not filepath.is_file()):
        raise HTTPException(status_code=404, detail="图片文件不存在")
    media_type = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".bmp": "image/bmp",
    }.get(filepath.suffix.lower())
    if not media_type:
        raise HTTPException(status_code=404, detail="图片文件不存在")
    return FileResponse(
        filepath,
        media_type=media_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


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
    """上传图片，使用唯一存储名并原子提交图片及任务记录。"""
    import sys
    owned_paths = set()

    def remove_owned_file(filepath):
        # 仅删除本次成功创建的文件，排他创建失败（包括碰撞）不取得文件所有权。
        if filepath in owned_paths:
            try:
                Path(filepath).unlink(missing_ok=True)
                owned_paths.remove(filepath)
            except OSError:
                pass

    def rollback_upload():
        db.rollback()
        for filepath in list(owned_paths):
            remove_owned_file(filepath)

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

        # 预检查所有文件的扩展名
        unsupported_files = []
        for file in files:
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext not in ALLOWED_EXTENSIONS:
                unsupported_files.append(file.filename)
        if unsupported_files:
            supported = ", ".join(ALLOWED_EXTENSIONS)
            examples = unsupported_files[:5]
            detail = f"包含不支持的文件格式，仅支持 {supported}。不支持的文件：{'、'.join(examples)}"
            if len(unsupported_files) > 5:
                detail += f" 等共 {len(unsupported_files)} 个"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=detail
            )

        # 检查项目权限并刷新项目信息
        project = check_project_permission(project_id, current_user, db)
        db.refresh(project)  # 确保获取最新的images_per_task值

        # 创建项目目录
        project_dir = os.path.join(UPLOAD_DIR, "images", str(project_id))
        os.makedirs(project_dir, exist_ok=True)

        uploaded_images = []

        # 标注、导出及训练都按 filename 推导标签名，因此文件名和路径都需唯一。
        for idx, file in enumerate(files):
            if idx > 0 and idx % 100 == 0:
                print(f"[DEBUG] 已处理 {idx}/{len(files)} 个文件", flush=True)
            filepath = None
            created_current_file = False
            try:
                safe_name = file.filename.replace('/', '_').replace('\\', '_').replace('..', '_')
                stem, extension = os.path.splitext(safe_name)
                # 在文件系统字节上限内为 UUID 和扩展名留出空间。
                stem = stem.encode('utf-8')[:255 - 33 - len(extension.encode('utf-8'))].decode('utf-8', errors='ignore')
                safe_filename = f"{uuid4().hex}_{stem}{extension}"
                filepath = os.path.join(project_dir, safe_filename)
                with open(filepath, "xb") as buffer:
                    created_current_file = True
                    owned_paths.add(filepath)
                    shutil.copyfileobj(file.file, buffer)

                width, height = get_image_size(filepath)
                file_size = os.path.getsize(filepath)
                if file_size == 0:
                    remove_owned_file(filepath)
                    continue
            except Exception as e:
                if created_current_file:
                    remove_owned_file(filepath)
                print(f"上传文件失败: {file.filename}, 错误: {str(e)}", flush=True)
                continue

            # 数据库失败必须终止事务并清理本批新文件，不能吞掉错误后继续使用失效会话。
            db_image = Image(
                project_id=project_id,
                filename=safe_filename,
                filepath=f"images/{project_id}/{safe_filename}",
                width=width,
                height=height,
                file_size=file_size
            )
            db.add(db_image)
            uploaded_images.append(db_image)

        db.flush()

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
                
                last_task_count = len(unassigned_image_ids) % images_per_task
                if last_task_count == 0:
                    last_task_count = images_per_task
                print(f"[DEBUG] 自动创建了 {task_count} 个任务包，最后任务包包含 {last_task_count} 张图片")
            else:
                print(f"[DEBUG] 所有上传的图片都已被分配到任务包，跳过自动创建")
        
        # 图片与自动分包一起提交；成功提交后的读取失败不能删除已落库的图片。
        db.commit()
        owned_paths.clear()
        for img in uploaded_images:
            db.refresh(img)

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
        rollback_upload()
        raise
    except Exception as e:
        rollback_upload()
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
    
    check_image_permission(image, current_user, db)
    
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
