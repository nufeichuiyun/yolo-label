"""
数据导出路由
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import os
import zipfile
import tempfile
from app.database import get_db
from app.models import User, Project, Image, Annotation
from app.auth import get_current_user
from app.routers.projects import check_project_permission
from app.models import Category
from datetime import datetime

router = APIRouter(prefix="/api/export", tags=["导出"])

ANNOTATION_DIR = os.getenv("ANNOTATION_DIR", "./annotations")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")


@router.get("/project/{project_id}/yolo")
async def export_project_yolo(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """导出项目的YOLO格式数据（只导出有标注的图片）"""
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    # 获取项目信息
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    # 获取有标注的图片（通过annotation_count > 0判断）
    try:
        # 先获取项目中的所有图片ID
        project_image_ids = [img.id for img in db.query(Image.id).filter(Image.project_id == project_id).all()]
        
        if not project_image_ids:
            raise HTTPException(status_code=400, detail="项目中没有图片")
        
        # 获取这些图片中有标注的图片ID
        annotated_image_ids = db.query(Annotation.image_id).filter(
            Annotation.image_id.in_(project_image_ids)
        ).distinct().all()
        
        if not annotated_image_ids:
            raise HTTPException(status_code=400, detail="项目中没有已标注的图片")
        
        # 提取图片ID列表
        image_ids = [row[0] for row in annotated_image_ids]
        
        # 获取这些图片的详细信息
        images_with_annotations = db.query(Image).filter(
            Image.id.in_(image_ids)
        ).all()
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = f"查询有标注的图片失败: {str(e)}\n{traceback.format_exc()}"
        print(f"查询错误详情: {error_detail}")
        raise HTTPException(status_code=500, detail=f"查询有标注的图片失败: {str(e)}")
    
    if not images_with_annotations:
        raise HTTPException(status_code=400, detail="项目中没有已标注的图片")
    
    # 生成导出时间戳（用于文件名）
    export_time = datetime.now().strftime('%Y%m%d_%H%M%S')
    # 清理项目名称，移除可能不适合文件名的字符，并转换为ASCII安全名称
    # 对于中文，使用拼音或直接移除，或者使用项目ID
    safe_project_name = "".join(c for c in project.name if c.isalnum() or c in (' ', '-', '_')).strip()
    if not safe_project_name or any(ord(c) > 127 for c in safe_project_name):
        # 如果包含非ASCII字符，使用项目ID代替
        safe_project_name = f"project_{project_id}"
    safe_project_name = safe_project_name.replace(' ', '_')
    zip_filename = f"{safe_project_name}_{export_time}.zip"
    
    # 创建临时zip文件
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    temp_file.close()
    
    # 获取类别列表并创建category_id到class_id的映射
    categories = db.query(Category).filter(Category.project_id == project_id).order_by(Category.id).all()
    category_id_to_class_id = {cat.id: idx for idx, cat in enumerate(categories)}
    
    # 创建导出文件夹名称
    export_folder_name = f"{safe_project_name}_{export_time}"
    
    try:
        with zipfile.ZipFile(temp_file.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 添加图片和标注文件（只添加有标注的）
            added_images = 0
            added_labels = 0
            import json
            
            for image in images_with_annotations:
                # 添加图片文件到文件夹中
                image_path = os.path.join(UPLOAD_DIR, image.filepath)
                if os.path.exists(image_path):
                    try:
                        zipf.write(image_path, f"{export_folder_name}/images/{image.filename}")
                        added_images += 1
                    except Exception as e:
                        print(f"添加图片文件失败 {image.filename}: {str(e)}")
                        continue
                else:
                    print(f"图片文件不存在: {image_path}")
                    continue
                
                # 从数据库读取标注并重新生成标注文件（确保class_id正确）
                annotations = db.query(Annotation).filter(Annotation.image_id == image.id).all()
                if annotations:
                    # 生成YOLO格式的标注内容
                    yolo_lines = []
                    for ann in annotations:
                        category_id = ann.category_id
                        class_id = category_id_to_class_id.get(category_id)
                        if class_id is None:
                            print(f"警告: 图片 {image.filename} 的类别ID {category_id} 不存在，跳过该标注")
                            continue
                        
                        # 解析bbox_data
                        try:
                            annotation_data = json.loads(ann.bbox_data) if isinstance(ann.bbox_data, str) else ann.bbox_data
                            
                            # 根据项目类型选择格式
                            if project.annotation_type.value == "segmentation":
                                # 实例分割：polygon格式 class_id x1 y1 x2 y2 x3 y3 ...
                                if "points" in annotation_data:
                                    points = annotation_data["points"]
                                    # points格式：[[x1, y1], [x2, y2], ...]（归一化坐标）
                                    point_str = " ".join([f"{p[0]} {p[1]}" for p in points])
                                    yolo_lines.append(f"{class_id} {point_str}\n")
                                else:
                                    print(f"警告: 实例分割标注缺少points字段，跳过")
                                    continue
                            else:
                                # 目标检测：bbox格式 class_id x_center y_center width height
                                x_center = annotation_data.get('x_center', 0)
                                y_center = annotation_data.get('y_center', 0)
                                width = annotation_data.get('width', 0)
                                height = annotation_data.get('height', 0)
                                yolo_lines.append(f"{class_id} {x_center} {y_center} {width} {height}\n")
                        except Exception as e:
                            print(f"解析标注数据失败 {image.filename}: {str(e)}")
                            continue
                    
                    if yolo_lines:
                        # 将标注内容写入zip文件
                        annotation_filename = f"{os.path.splitext(image.filename)[0]}.txt"
                        yolo_content = "".join(yolo_lines)
                        zipf.writestr(f"{export_folder_name}/labels/{annotation_filename}", yolo_content)
                        added_labels += 1
            
            if added_images == 0:
                raise HTTPException(status_code=500, detail="没有可导出的图片文件")
            
            # 添加类别映射文件（classes.txt）
            classes_content = "\n".join([f"{i}: {cat.name}" for i, cat in enumerate(categories)])
            zipf.writestr(f"{export_folder_name}/classes.txt", classes_content)
            
            # 添加说明文件
            readme_content = f"""YOLO格式标注数据导出
项目名称: {project.name}
标注类型: {project.annotation_type}
导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
已标注图片数量: {len(images_with_annotations)}

目录结构:
- images/ : 图片文件（仅包含已标注的图片）
- labels/ : YOLO格式标注文件（.txt）
- classes.txt : 类别映射文件

YOLO格式说明:
- 目标检测: class_id x_center y_center width height
- 实例分割: class_id x1 y1 x2 y2 x3 y3 ... (多边形顶点坐标)
所有坐标都是归一化的（0-1之间）
class_id是类别在classes.txt中的索引（从0开始）
"""
            zipf.writestr(f"{export_folder_name}/README.txt", readme_content)
        
        # 返回文件
        # 使用ASCII安全的文件名避免编码问题
        return FileResponse(
            temp_file.name,
            media_type='application/zip',
            filename=zip_filename
        )
    except Exception as e:
        import traceback
        error_detail = f"导出失败: {str(e)}\n{traceback.format_exc()}"
        print(f"导出错误详情: {error_detail}")  # 打印到控制台以便调试
        if os.path.exists(temp_file.name):
            os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")
