"""
数据导出与导入路由
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os
import zipfile
import tempfile
import json
import io
from app.database import get_db
from app.models import User, Project, Image, Annotation, Category, ProjectUser
from app.auth import get_current_user, require_project_admin_or_super_admin
from app.routers.projects import check_project_permission
from app.models import UserRole, AnnotationType
from datetime import datetime

router = APIRouter(prefix="/api/export", tags=["导出"])

ANNOTATION_DIR = os.getenv("ANNOTATION_DIR", "./annotations")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


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


# ============ 完整项目导出（可导入） ============
EXPORT_MANIFEST_VERSION = 1
EXPORT_FOLDER = "yolo_label_project"


def _safe_project_name(project: Project, project_id: int) -> str:
    """生成安全的项目名称（用于文件名）"""
    safe = "".join(c for c in project.name if c.isalnum() or c in (' ', '-', '_')).strip()
    if not safe or any(ord(c) > 127 for c in safe):
        safe = f"project_{project_id}"
    return safe.replace(' ', '_')


@router.get("/project/{project_id}/full")
async def export_project_full(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """导出完整项目（包含所有图片、类别、标注，可用于导入到其他实例）"""
    check_project_permission(project_id, current_user, db)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    images = db.query(Image).filter(Image.project_id == project_id).all()
    if not images:
        raise HTTPException(status_code=400, detail="项目中没有图片")

    categories = db.query(Category).filter(Category.project_id == project_id).order_by(Category.id).all()
    category_id_to_class_id = {cat.id: idx for idx, cat in enumerate(categories)}

    export_time = datetime.now().strftime('%Y%m%d_%H%M%S')
    safe_name = _safe_project_name(project, project_id)
    zip_filename = f"{safe_name}_full_{export_time}.zip"

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    temp_file.close()

    try:
        with zipfile.ZipFile(temp_file.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # project.json
            project_data = {
                "name": project.name,
                "description": project.description or "",
                "annotation_type": project.annotation_type.value,
                "images_per_task": project.images_per_task,
            }
            zipf.writestr(f"{EXPORT_FOLDER}/project.json", json.dumps(project_data, ensure_ascii=False, indent=2))

            # categories.json
            categories_data = [{"name": c.name, "color": c.color or "#FF0000"} for c in categories]
            zipf.writestr(f"{EXPORT_FOLDER}/categories.json", json.dumps(categories_data, ensure_ascii=False, indent=2))

            # manifest.json
            manifest = {
                "version": EXPORT_MANIFEST_VERSION,
                "export_time": datetime.now().isoformat(),
                "image_count": len(images),
                "category_count": len(categories),
            }
            zipf.writestr(f"{EXPORT_FOLDER}/manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

            # images/ 和 labels/
            for image in images:
                image_path = os.path.join(UPLOAD_DIR, image.filepath)
                if os.path.exists(image_path):
                    zipf.write(image_path, f"{EXPORT_FOLDER}/images/{image.filename}")

                annotations = db.query(Annotation).filter(Annotation.image_id == image.id).all()
                if annotations:
                    yolo_lines = []
                    for ann in annotations:
                        class_id = category_id_to_class_id.get(ann.category_id)
                        if class_id is None:
                            continue
                        try:
                            data = json.loads(ann.bbox_data) if isinstance(ann.bbox_data, str) else ann.bbox_data
                            if project.annotation_type.value == "segmentation":
                                if "points" in data:
                                    pts = data["points"]
                                    line = f"{class_id} " + " ".join(f"{p[0]} {p[1]}" for p in pts) + "\n"
                                    yolo_lines.append(line)
                            else:
                                xc = data.get("x_center", 0)
                                yc = data.get("y_center", 0)
                                w = data.get("width", 0)
                                h = data.get("height", 0)
                                yolo_lines.append(f"{class_id} {xc} {yc} {w} {h}\n")
                        except Exception:
                            continue
                    if yolo_lines:
                        label_name = f"{os.path.splitext(image.filename)[0]}.txt"
                        zipf.writestr(f"{EXPORT_FOLDER}/labels/{label_name}", "".join(yolo_lines))

        return FileResponse(
            temp_file.name,
            media_type='application/zip',
            filename=zip_filename
        )
    except Exception as e:
        if os.path.exists(temp_file.name):
            os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


# ============ 项目导入 ============
@router.post("/project/import")
async def import_project(
    file: UploadFile = File(...),
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """从导出的 zip 文件导入项目"""
    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="请上传 .zip 格式的项目导出文件")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="文件为空")

    try:
        with zipfile.ZipFile(io.BytesIO(content), 'r') as zipf:
            namelist = zipf.namelist()

            # 查找项目根目录（可能带前缀如 yolo_label_project/）
            project_root = None
            for name in namelist:
                if project_root is None and "project.json" in name:
                    project_root = name.split("project.json")[0]
                    break
            if not project_root:
                raise HTTPException(status_code=400, detail="无效的导出文件：缺少 project.json")

            def read_json(path: str) -> dict:
                full = project_root + path if not path.startswith(project_root) else path
                if full not in namelist:
                    raise HTTPException(status_code=400, detail=f"无效的导出文件：缺少 {path}")
                return json.loads(zipf.read(full).decode("utf-8"))

            project_data = read_json("project.json")
            categories_data = read_json("categories.json")

            # 验证 annotation_type
            at = project_data.get("annotation_type", "detection")
            if at not in ("detection", "segmentation", "keypoint"):
                at = "detection"
            annotation_type = AnnotationType(at)

            # 创建项目
            db_project = Project(
                name=project_data.get("name", "导入的项目"),
                description=project_data.get("description") or "",
                annotation_type=annotation_type,
                images_per_task=project_data.get("images_per_task"),
                creator_id=current_user.id
            )
            db.add(db_project)
            db.commit()
            db.refresh(db_project)
            project_id = db_project.id

            # 创建项目管理员
            db.add(ProjectUser(
                project_id=project_id,
                user_id=current_user.id,
                role=UserRole.PROJECT_ADMIN
            ))
            db.commit()

            # 创建类别
            class_id_to_category_id = {}
            for idx, cat in enumerate(categories_data):
                db_cat = Category(
                    project_id=project_id,
                    name=cat.get("name", f"类别{idx}"),
                    color=cat.get("color", "#FF0000")
                )
                db.add(db_cat)
                db.flush()
                class_id_to_category_id[idx] = db_cat.id
            db.commit()

            # 创建图片目录
            project_dir = os.path.join(UPLOAD_DIR, "images", str(project_id))
            os.makedirs(project_dir, exist_ok=True)
            annotation_dir = os.path.join(ANNOTATION_DIR, str(project_id))
            os.makedirs(annotation_dir, exist_ok=True)

            # 从 PIL 获取图片尺寸
            from PIL import Image as PILImage

            images_prefix = project_root + "images/"
            labels_prefix = project_root + "labels/"
            filename_to_image = {}

            for name in namelist:
                if name.startswith(images_prefix) and name != images_prefix:
                    rel = name[len(images_prefix):]
                    if "/" in rel or rel.startswith("."):
                        continue
                    ext = os.path.splitext(rel)[1].lower()
                    if ext not in ALLOWED_IMAGE_EXTENSIONS:
                        continue

                    data = zipf.read(name)
                    safe_path = rel.replace("/", "_").replace("\\", "_").replace("..", "_")
                    filepath = os.path.join(project_dir, safe_path)
                    with open(filepath, "wb") as f:
                        f.write(data)

                    width, height = None, None
                    try:
                        with PILImage.open(filepath) as img:
                            width, height = img.size
                    except Exception:
                        pass

                    rel_path = f"images/{project_id}/{safe_path}"
                    db_image = Image(
                        project_id=project_id,
                        filename=safe_path,
                        filepath=rel_path,
                        width=width,
                        height=height,
                        file_size=len(data)
                    )
                    db.add(db_image)
                    db.flush()
                    filename_to_image[safe_path] = db_image

            db.commit()

            # 导入标注
            for name in namelist:
                if name.startswith(labels_prefix) and name.endswith(".txt"):
                    rel = name[len(labels_prefix):]
                    base = os.path.splitext(rel)[0]
                    # 查找匹配的图片（可能扩展名不同）
                    matched_image = None
                    for fn, img in filename_to_image.items():
                        if os.path.splitext(fn)[0] == base:
                            matched_image = img
                            break
                    if not matched_image:
                        continue

                    label_content = zipf.read(name).decode("utf-8", errors="ignore")
                    lines = [l.strip() for l in label_content.splitlines() if l.strip()]

                    for line in lines:
                        parts = line.split()
                        if len(parts) < 5:
                            continue
                        try:
                            class_id = int(parts[0])
                            category_id = class_id_to_category_id.get(class_id)
                            if category_id is None:
                                continue

                            if annotation_type == AnnotationType.SEGMENTATION:
                                if len(parts) < 7:
                                    continue
                                coords = [float(x) for x in parts[1:]]
                                points = [[coords[i], coords[i + 1]] for i in range(0, len(coords), 2)]
                                bbox_data = json.dumps({"points": points})
                            else:
                                xc, yc, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
                                bbox_data = json.dumps({"x_center": xc, "y_center": yc, "width": w, "height": h})

                            if matched_image:
                                db_ann = Annotation(
                                    image_id=matched_image.id,
                                    category_id=category_id,
                                    annotator_id=current_user.id,
                                    bbox_data=bbox_data
                                )
                                db.add(db_ann)
                                matched_image.is_annotated = True
                        except (ValueError, IndexError):
                            continue

            db.commit()

            # 写入 YOLO 标注文件（与 annotations 同步）
            from app.routers.annotations import save_yolo_annotation
            for img in db.query(Image).filter(Image.project_id == project_id).all():
                anns = db.query(Annotation).filter(Annotation.image_id == img.id).all()
                if anns:
                    ann_list = [{"category_id": a.category_id, "bbox": json.loads(a.bbox_data)} for a in anns]
                    save_yolo_annotation(img.id, ann_list, db)

            # 创建任务包（如果设置了 images_per_task）
            if db_project.images_per_task and db_project.images_per_task > 0:
                from app.models import Task, TaskImage
                image_ids = [img.id for img in db.query(Image).filter(Image.project_id == project_id).order_by(Image.id).all()]
                n = db_project.images_per_task
                for i in range(0, len(image_ids), n):
                    batch = image_ids[i:i + n]
                    task_name = f"任务包 {i // n + 1}"
                    db_task = Task(project_id=project_id, name=task_name, annotator_id=None, status="pending")
                    db.add(db_task)
                    db.flush()
                    for img_id in batch:
                        db.add(TaskImage(task_id=db_task.id, image_id=img_id))
                db.commit()

        return {"message": "项目导入成功", "project_id": project_id}
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="无效的 zip 文件")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")
