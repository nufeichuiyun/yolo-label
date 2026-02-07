"""
标注管理路由
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
import os
from app.database import get_db
from app.models import User, Annotation, Image, Category, Task, TaskImage
from app.schemas import AnnotationCreate, AnnotationResponse
from app.auth import get_current_user
from app.routers.projects import check_project_permission
from app.models import UserRole

router = APIRouter(prefix="/api/annotations", tags=["标注"])

ANNOTATION_DIR = os.getenv("ANNOTATION_DIR", "./annotations")


def save_yolo_annotation(image_id: int, annotations: List[dict], db: Session):
    """保存YOLO格式标注文件（支持目标检测和实例分割）"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return
    
    # 获取项目信息，确定标注类型
    from app.models import Project
    project = db.query(Project).filter(Project.id == image.project_id).first()
    if not project:
        return
    
    # 获取项目的所有类别，按ID排序，创建category_id到class_id的映射
    from app.models import Category
    categories = db.query(Category).filter(Category.project_id == image.project_id).order_by(Category.id).all()
    category_id_to_class_id = {cat.id: idx for idx, cat in enumerate(categories)}
    
    # 创建项目标注目录
    project_dir = os.path.join(ANNOTATION_DIR, str(image.project_id))
    os.makedirs(project_dir, exist_ok=True)
    
    # 生成YOLO格式文件（文件名与图片相同，扩展名为.txt）
    image_name = os.path.splitext(image.filename)[0]
    annotation_file = os.path.join(project_dir, f"{image_name}.txt")
    
    # 根据项目类型写入不同的YOLO格式
    with open(annotation_file, "w") as f:
        for ann in annotations:
            category_id = ann.get("category_id")
            annotation_data = ann.get("bbox") or ann.get("polygon")  # 兼容bbox和polygon字段
            if annotation_data and category_id is not None:
                # 将category_id转换为class_id（类别在排序列表中的索引）
                class_id = category_id_to_class_id.get(category_id)
                if class_id is None:
                    # 如果找不到映射，跳过这个标注
                    print(f"警告: 类别ID {category_id} 不存在于项目中，跳过该标注")
                    continue
                
                # 根据项目类型选择格式
                if project.annotation_type.value == "segmentation":
                    # 实例分割：polygon格式 class_id x1 y1 x2 y2 x3 y3 ...
                    if "points" in annotation_data:
                        points = annotation_data["points"]
                        # points格式：[[x1, y1], [x2, y2], ...]（归一化坐标）
                        point_str = " ".join([f"{p[0]} {p[1]}" for p in points])
                        line = f"{class_id} {point_str}\n"
                        f.write(line)
                    else:
                        print(f"警告: 实例分割标注缺少points字段，跳过")
                        continue
                else:
                    # 目标检测：bbox格式 class_id x_center y_center width height
                    if "x_center" in annotation_data:
                        line = f"{class_id} {annotation_data['x_center']} {annotation_data['y_center']} {annotation_data['width']} {annotation_data['height']}\n"
                        f.write(line)
                    else:
                        print(f"警告: 目标检测标注缺少x_center字段，跳过")
                        continue
    
    # 更新图片标注状态
    image.is_annotated = len(annotations) > 0
    db.commit()


@router.post("", response_model=List[AnnotationResponse])
async def create_annotations(
    image_id: int,
    annotations: List[dict],  # [{"category_id": 1, "bbox": {...}}]
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建标注（批量）"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限
    check_project_permission(image.project_id, current_user, db)
    
    # 如果是标注者，检查图片是否在自己的任务包中
    if current_user.role == UserRole.ANNOTATOR:
        task_image = db.query(TaskImage).join(Task).filter(
            TaskImage.image_id == image_id,
            Task.annotator_id == current_user.id
        ).first()
        if not task_image:
            raise HTTPException(status_code=403, detail="无权标注此图片，该图片不在您的任务包中")
    
    # 删除该图片的旧标注
    db.query(Annotation).filter(Annotation.image_id == image_id).delete()
    
    # 创建新标注
    db_annotations = []
    for ann_data in annotations:
        category_id = ann_data.get("category_id")
        # 支持bbox（目标检测）和polygon（实例分割）两种格式
        annotation_data = ann_data.get("bbox") or ann_data.get("polygon") or {}
        bbox_data = json.dumps(annotation_data)
        
        # 验证类别是否存在
        category = db.query(Category).filter(Category.id == category_id).first()
        if not category:
            continue
        
        db_ann = Annotation(
            image_id=image_id,
            category_id=category_id,
            annotator_id=current_user.id,
            bbox_data=bbox_data
        )
        db.add(db_ann)
        db_annotations.append(db_ann)
    
    db.commit()
    
    # 保存YOLO格式文件
    save_yolo_annotation(image_id, annotations, db)
    
    for ann in db_annotations:
        db.refresh(ann)
    
    return db_annotations


@router.get("/image/{image_id}", response_model=List[AnnotationResponse])
async def get_image_annotations(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取图片的标注列表"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限
    check_project_permission(image.project_id, current_user, db)
    
    # 如果是标注者，检查图片是否在自己的任务包中
    if current_user.role == UserRole.ANNOTATOR:
        task_image = db.query(TaskImage).join(Task).filter(
            TaskImage.image_id == image_id,
            Task.annotator_id == current_user.id
        ).first()
        if not task_image:
            raise HTTPException(status_code=403, detail="无权查看此图片的标注，该图片不在您的任务包中")
    
    annotations = db.query(Annotation).filter(Annotation.image_id == image_id).all()
    return annotations


@router.delete("/image/{image_id}")
async def delete_image_annotations(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除图片的所有标注"""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查项目权限
    check_project_permission(image.project_id, current_user, db)
    
    # 如果是标注者，检查图片是否在自己的任务包中
    if current_user.role == UserRole.ANNOTATOR:
        task_image = db.query(TaskImage).join(Task).filter(
            TaskImage.image_id == image_id,
            Task.annotator_id == current_user.id
        ).first()
        if not task_image:
            raise HTTPException(status_code=403, detail="无权删除此图片的标注，该图片不在您的任务包中")
    
    # 删除数据库记录
    db.query(Annotation).filter(Annotation.image_id == image_id).delete()
    
    # 删除YOLO文件
    project_dir = os.path.join(ANNOTATION_DIR, str(image.project_id))
    image_name = os.path.splitext(image.filename)[0]
    annotation_file = os.path.join(project_dir, f"{image_name}.txt")
    if os.path.exists(annotation_file):
        os.remove(annotation_file)
    
    # 更新图片状态
    image.is_annotated = False
    db.commit()
    
    return {"message": "标注已删除"}
