"""
预标注任务
"""
import os
import json
from typing import List, Dict
from celery import Task
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import PreAnnotationTask, Image, Category, Annotation, Project, Model
from app.services.yolo_service import create_yolo_service
from sqlalchemy.orm import Session

# 直接导入torch用于GPU显存检测（容器内已安装）
try:
    import torch
except ImportError:
    torch = None


class DatabaseTask(Task):
    """带数据库会话的任务基类"""
    _db: Session = None
    
    @property
    def db(self):
        if self._db is None:
            self._db = SessionLocal()
        return self._db
    
    def after_return(self, *args, **kwargs):
        """任务完成后关闭数据库会话"""
        if self._db:
            self._db.close()
            self._db = None


@celery_app.task(bind=True, base=DatabaseTask)
def preannotate_project_task(
    self,
    task_id: str,
    project_id: int,
    model_id: int,
    selected_classes: List[str],
    conf_threshold: float = 0.25
):
    """
    预标注项目任务
    
    Args:
        task_id: 任务ID
        project_id: 项目ID
        model_id: 模型ID
        selected_classes: 选中的类别名称列表
        conf_threshold: 置信度阈值
    """
    db = self.db
    
    try:
        # 更新任务状态为运行中
        task = db.query(PreAnnotationTask).filter(PreAnnotationTask.task_id == task_id).first()
        if not task:
            raise ValueError(f"任务不存在: {task_id}")
        
        task.status = "running"
        db.commit()
        
        # 获取项目信息
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"项目不存在: {project_id}")
        
        # 获取模型信息
        model = db.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"模型不存在: {model_id}")
        
        # 获取模型文件路径
        MODEL_DIR = os.getenv("MODEL_DIR", "./models")
        model_path = os.path.join(MODEL_DIR, model.filename)
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"模型文件不存在: {model_path}")
        
        # 创建YOLO推理服务
        print(f"[DEBUG] 创建YOLO推理服务，模型路径: {model_path}")
        yolo_service = create_yolo_service(model_path)
        print(f"[DEBUG] YOLO推理服务创建成功")
        
        # 获取项目的所有图片
        images = db.query(Image).filter(Image.project_id == project_id).all()
        total_images = len(images)
        
        if total_images == 0:
            task.status = "completed"
            task.progress = 100
            task.total_images = 0
            task.processed_images = 0
            db.commit()
            return {"message": "项目中没有图片"}
        
        task.total_images = total_images
        task.processed_images = 0
        db.commit()
        
        # 获取项目的类别映射（类别名称 -> 类别ID）
        categories = db.query(Category).filter(Category.project_id == project_id).all()
        category_name_to_id = {cat.name: cat.id for cat in categories}
        
        # 如果选中的类别在项目中不存在，创建它们
        for class_name in selected_classes:
            if class_name not in category_name_to_id:
                # 创建新类别
                new_category = Category(
                    project_id=project_id,
                    name=class_name,
                    color="#FF0000"  # 默认红色
                )
                db.add(new_category)
                db.flush()
                category_name_to_id[class_name] = new_category.id
        
        db.commit()
        
        # 获取上传目录
        UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
        
        # 批量处理优化：一次处理多张图片以提高GPU利用率
        # 根据GPU显存动态调整批量大小：
        # - 8GB显存：64-128张/批
        # - 12GB显存：128-256张/批
        # - 16GB+显存：256-512张/批
        # 当前显存使用不到1G，说明可以大幅增加批量大小以提高GPU利用率
        # 默认批量大小，可以根据实际显存使用情况调整
        default_batch_size = 128
        
        # 尝试检测GPU显存并动态调整批量大小
        try:
            if torch and torch.cuda.is_available():
                gpu_memory_gb = torch.cuda.get_device_properties(0).total_memory // (1024**3)
                if gpu_memory_gb >= 16:
                    batch_size = 256  # 16GB+显存使用256张/批
                elif gpu_memory_gb >= 12:
                    batch_size = 128  # 12GB显存使用128张/批
                elif gpu_memory_gb >= 8:
                    batch_size = 64   # 8GB显存使用64张/批
                else:
                    batch_size = 32   # 小于8GB使用32张/批
                print(f"[DEBUG] 检测到GPU显存: {gpu_memory_gb}GB，使用批量大小: {batch_size}")
            else:
                batch_size = default_batch_size
                print(f"[DEBUG] 未检测到GPU，使用默认批量大小: {batch_size}")
        except Exception as e:
            batch_size = default_batch_size
            print(f"[DEBUG] GPU显存检测失败，使用默认批量大小: {batch_size}: {e}")
        
        processed_count = 0
        progress_update_interval = 10  # 每10张图片更新一次进度
        
        # 批量处理图片
        for batch_start in range(0, total_images, batch_size):
            batch_end = min(batch_start + batch_size, total_images)
            batch_images = images[batch_start:batch_end]
            batch_size_actual = len(batch_images)
            
            print(f"[DEBUG] 批量处理图片 {batch_start+1}-{batch_end}/{total_images} (批量大小: {batch_size_actual})")
            
            # 收集批量图片路径
            batch_image_paths = []
            batch_image_objects = []
            for image in batch_images:
                image_path = os.path.join(UPLOAD_DIR, image.filepath)
                if os.path.exists(image_path):
                    batch_image_paths.append(image_path)
                    batch_image_objects.append(image)
                else:
                    print(f"警告：图片文件不存在: {image_path}")
                    batch_image_objects.append(None)  # 占位符
            
            if not batch_image_paths:
                continue
            
            # 批量推理
            import time
            batch_start_time = time.time()
            try:
                batch_detections = yolo_service.predict_images_batch(
                    batch_image_paths,
                    conf_threshold=conf_threshold,
                    selected_classes=selected_classes
                )
                batch_time = time.time() - batch_start_time
                print(f"[DEBUG] 批量推理完成，耗时: {batch_time:.2f}秒，平均每张: {batch_time/len(batch_image_paths):.2f}秒")
            except Exception as e:
                print(f"[ERROR] 批量推理失败: {e}")
                import traceback
                traceback.print_exc()
                # 如果批量失败，回退到单张处理
                batch_detections = []
                for image_path in batch_image_paths:
                    try:
                        detections = yolo_service.predict_image(
                            image_path,
                            conf_threshold=conf_threshold,
                            selected_classes=selected_classes
                        )
                        batch_detections.append(detections)
                    except Exception as e2:
                        print(f"[ERROR] 单张推理也失败: {e2}")
                        batch_detections.append([])
            
            # 处理批量结果
            detection_idx = 0
            for idx in range(batch_start, batch_end):
                image = batch_image_objects[idx - batch_start]
                if image is None:
                    continue
                
                detections = batch_detections[detection_idx] if detection_idx < len(batch_detections) else []
                detection_idx += 1
                
                try:
                    if len(detections) > 0:
                        # 删除该图片的旧标注（如果存在）
                        db.query(Annotation).filter(Annotation.image_id == image.id).delete()
                        
                        # 创建新标注
                        annotations_to_create = []
                        for det in detections:
                            class_name = det["class_name"]
                            category_id = category_name_to_id.get(class_name)
                            
                            if category_id:
                                # 根据项目的annotation_type决定保存的数据格式
                                if project.annotation_type.value == "segmentation":
                                    # 实例分割：只保存polygon数据，不保存bbox
                                    if "polygon" in det and det["polygon"] and "points" in det["polygon"]:
                                        # 保存polygon数据，确保所有值都是Python原生类型
                                        points = det["polygon"]["points"]
                                        # 转换所有点坐标为Python原生类型
                                        annotation_data = {
                                            "points": [[float(p[0]), float(p[1])] for p in points]
                                        }
                                    else:
                                        # 如果没有polygon，跳过此标注（segmentation项目必须有polygon）
                                        print(f"警告: 实例分割项目中的检测结果缺少polygon数据，跳过类别: {class_name}")
                                        continue
                                else:
                                    # 目标检测：保存bbox数据
                                    # 确保所有值都是Python原生类型（不是numpy类型），以便JSON序列化
                                    annotation_data = {
                                        "x_center": float(det["bbox"]["x_center"]),
                                        "y_center": float(det["bbox"]["y_center"]),
                                        "width": float(det["bbox"]["width"]),
                                        "height": float(det["bbox"]["height"])
                                    }
                                
                                bbox_data = json.dumps(annotation_data)
                                annotation = Annotation(
                                    image_id=image.id,
                                    category_id=category_id,
                                    annotator_id=task.created_by,  # 使用任务创建者作为标注者
                                    bbox_data=bbox_data
                                )
                                annotations_to_create.append(annotation)
                        
                        # 批量添加标注
                        db.bulk_save_objects(annotations_to_create)
                        
                        # 更新图片标注状态
                        image.is_annotated = len(annotations_to_create) > 0
                        
                        processed_count += 1
                    
                    # 更新进度（每10张图片或每批结束时）
                    current_idx = idx + 1
                    should_update_progress = current_idx % progress_update_interval == 0 or current_idx == total_images
                    
                    if should_update_progress:
                        progress = int(current_idx / total_images * 100)
                        task.progress = progress
                        task.processed_images = current_idx
                        db.commit()
                        
                        # 更新Celery任务状态
                        self.update_state(
                            state="PROGRESS",
                            meta={
                                "current": current_idx,
                                "total": total_images,
                                "progress": progress
                            }
                        )
                except Exception as e:
                    print(f"处理图片失败: {image.filename}, 错误: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    continue
        
        # 保存YOLO格式标注文件
        from app.routers.annotations import save_yolo_annotation
        for image in images:
            annotations = db.query(Annotation).filter(Annotation.image_id == image.id).all()
            if annotations:
                annotation_data = []
                for ann in annotations:
                    annotation_json = json.loads(ann.bbox_data)
                    # 根据项目类型构建正确的数据格式
                    if project.annotation_type.value == "segmentation":
                        # 实例分割：使用polygon格式
                        if "points" in annotation_json:
                            annotation_data.append({
                                "category_id": ann.category_id,
                                "polygon": {"points": annotation_json["points"]}
                            })
                        else:
                            # 如果没有polygon，跳过（或使用bbox作为后备）
                            print(f"警告: 图片 {image.filename} 的标注缺少polygon数据，跳过")
                            continue
                    else:
                        # 目标检测：使用bbox格式
                        annotation_data.append({
                            "category_id": ann.category_id,
                            "bbox": annotation_json
                        })
                if annotation_data:
                    save_yolo_annotation(image.id, annotation_data, db)
        
        # 更新任务状态为完成
        task.status = "completed"
        task.progress = 100
        task.processed_images = total_images
        db.commit()
        
        return {
            "message": "预标注完成",
            "total_images": total_images,
            "processed_images": processed_count
        }
        
    except Exception as e:
        # 更新任务状态为失败
        error_msg = str(e)
        print(f"预标注任务失败: {error_msg}")
        import traceback
        traceback.print_exc()
        
        task = db.query(PreAnnotationTask).filter(PreAnnotationTask.task_id == task_id).first()
        if task:
            task.status = "failed"
            task.error_message = error_msg
            db.commit()
        
        raise
