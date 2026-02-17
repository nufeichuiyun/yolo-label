"""
YOLO 训练服务：数据集准备、data.yaml 生成
"""
import os
import json
import shutil
import random
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
TRAINING_OUTPUT_DIR = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")


def get_annotated_images_for_project(db, project_id: int):
    """
    获取项目中有标注的图片列表（复用 export 逻辑）
    
    Returns:
        List[Image]: 有标注的图片列表
    """
    from app.models import Image, Annotation
    
    project_image_ids = [img.id for img in db.query(Image.id).filter(Image.project_id == project_id).all()]
    if not project_image_ids:
        return []
    
    annotated_image_ids = db.query(Annotation.image_id).filter(
        Annotation.image_id.in_(project_image_ids)
    ).distinct().all()
    
    image_ids = [row[0] for row in annotated_image_ids]
    return db.query(Image).filter(Image.id.in_(image_ids)).all()


def prepare_dataset(
    db,
    project_id: int,
    output_dir: str,
    train_split: float = 0.8,
    random_seed: Optional[int] = 42
) -> Tuple[str, int, int]:
    """
    准备训练数据集：划分 train/val，生成 images 和 labels 目录及 data.yaml
    
    Args:
        db: 数据库会话
        project_id: 项目 ID
        output_dir: 输出目录（将创建 images/train, images/val, labels/train, labels/val）
        train_split: 训练集比例 (0-1)
        random_seed: 随机种子，保证可复现
    
    Returns:
        Tuple[data_yaml_path, train_count, val_count]
    """
    from app.models import Project, Category, Annotation
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"项目不存在: {project_id}")
    
    images = get_annotated_images_for_project(db, project_id)
    if len(images) < 10:
        raise ValueError(f"已标注图片数量不足，至少需要 10 张，当前 {len(images)} 张")
    
    categories = db.query(Category).filter(Category.project_id == project_id).order_by(Category.id).all()
    if len(categories) < 1:
        raise ValueError(f"类别数量不足，至少需要 1 个类别，当前 {len(categories)} 个")
    
    category_id_to_class_id = {cat.id: idx for idx, cat in enumerate(categories)}
    
    # 划分 train/val
    if random_seed is not None:
        random.seed(random_seed)
    shuffled = list(images)
    random.shuffle(shuffled)
    split_idx = int(len(shuffled) * train_split)
    train_images = shuffled[:split_idx]
    val_images = shuffled[split_idx:]
    
    if len(train_images) < 2 or len(val_images) < 1:
        raise ValueError("划分后训练集或验证集图片数量不足")
    
    # 创建目录
    os.makedirs(output_dir, exist_ok=True)
    for split in ["train", "val"]:
        os.makedirs(os.path.join(output_dir, "images", split), exist_ok=True)
        os.makedirs(os.path.join(output_dir, "labels", split), exist_ok=True)
    
    # 写入图片和标注
    for split, img_list in [("train", train_images), ("val", val_images)]:
        for image in img_list:
            src_path = os.path.join(UPLOAD_DIR, image.filepath)
            if not os.path.exists(src_path):
                continue
            
            dst_img_path = os.path.join(output_dir, "images", split, image.filename)
            shutil.copy2(src_path, dst_img_path)
            
            annotations = db.query(Annotation).filter(Annotation.image_id == image.id).all()
            if annotations:
                yolo_lines = []
                for ann in annotations:
                    class_id = category_id_to_class_id.get(ann.category_id)
                    if class_id is None:
                        continue
                    
                    try:
                        annotation_data = json.loads(ann.bbox_data) if isinstance(ann.bbox_data, str) else ann.bbox_data
                        
                        if project.annotation_type.value == "segmentation":
                            if "points" in annotation_data:
                                points = annotation_data["points"]
                                point_str = " ".join([f"{p[0]} {p[1]}" for p in points])
                                yolo_lines.append(f"{class_id} {point_str}\n")
                            else:
                                continue
                        else:
                            x_center = annotation_data.get('x_center', 0)
                            y_center = annotation_data.get('y_center', 0)
                            width = annotation_data.get('width', 0)
                            height = annotation_data.get('height', 0)
                            yolo_lines.append(f"{class_id} {x_center} {y_center} {width} {height}\n")
                    except Exception:
                        continue
                
                if yolo_lines:
                    label_filename = f"{os.path.splitext(image.filename)[0]}.txt"
                    label_path = os.path.join(output_dir, "labels", split, label_filename)
                    with open(label_path, "w", encoding="utf-8") as f:
                        f.writelines(yolo_lines)
    
    # 生成 data.yaml
    names_dict = {i: cat.name for i, cat in enumerate(categories)}
    data_yaml_content = f"""# YOLO 训练数据集配置 - 由 yolo-label 自动生成
path: {os.path.abspath(output_dir)}
train: images/train
val: images/val

names:
"""
    for idx, cat in enumerate(categories):
        data_yaml_content += f"  {idx}: {cat.name}\n"
    
    data_yaml_path = os.path.join(output_dir, "data.yaml")
    with open(data_yaml_path, "w", encoding="utf-8") as f:
        f.write(data_yaml_content)
    
    return data_yaml_path, len(train_images), len(val_images)


def get_default_base_model(annotation_type: str) -> str:
    """根据项目标注类型返回默认基础模型"""
    if annotation_type == "segmentation":
        return "yolo11n-seg.pt"
    return "yolo11n.pt"


def get_available_base_models(annotation_type: str) -> List[dict]:
    """返回可用的基础模型列表"""
    detection_models = [
        {"value": "yolo11n.pt", "label": "YOLO11 Nano (最快)"},
        {"value": "yolo11s.pt", "label": "YOLO11 Small"},
        {"value": "yolo11m.pt", "label": "YOLO11 Medium"},
        {"value": "yolo11l.pt", "label": "YOLO11 Large"},
        {"value": "yolo11x.pt", "label": "YOLO11 X-Large (最准)"},
    ]
    segmentation_models = [
        {"value": "yolo11n-seg.pt", "label": "YOLO11 Nano Seg (最快)"},
        {"value": "yolo11s-seg.pt", "label": "YOLO11 Small Seg"},
        {"value": "yolo11m-seg.pt", "label": "YOLO11 Medium Seg"},
        {"value": "yolo11l-seg.pt", "label": "YOLO11 Large Seg"},
        {"value": "yolo11x-seg.pt", "label": "YOLO11 X-Large Seg (最准)"},
    ]
    return segmentation_models if annotation_type == "segmentation" else detection_models
