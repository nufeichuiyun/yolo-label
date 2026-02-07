"""
YOLO11推理服务（Docker容器化版本）
"""
import os
import json
from pathlib import Path
from typing import List, Dict, Optional

# 直接导入ultralytics（容器内已安装）
try:
    from ultralytics import YOLO
    import torch
    print(f"[INFO] 成功导入ultralytics")
    print(f"[INFO] CUDA可用: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"[INFO] CUDA设备: {torch.cuda.get_device_name(0)}")
        print(f"[INFO] CUDA版本: {torch.version.cuda}")
except ImportError as e:
    raise ImportError(f"无法导入ultralytics，请确保已安装: {e}")


class YOLOInferenceService:
    """YOLO推理服务（使用容器内安装的ultralytics）"""
    
    def __init__(self, model_path: str):
        """
        初始化推理服务
        
        Args:
            model_path: 模型文件路径
        """
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"模型文件不存在: {model_path}")
        
        self.model_path = model_path
        self.model = None
        
        # 直接加载模型
        try:
            print(f"[INFO] 加载YOLO模型: {self.model_path}")
            self.model = YOLO(self.model_path)
            print(f"[INFO] 模型加载成功")
        except Exception as e:
            print(f"[ERROR] 模型加载失败: {e}")
            raise RuntimeError(f"模型加载失败: {e}")
    
    def get_class_names(self) -> List[str]:
        """
        获取模型的类别名称列表
        
        Returns:
            类别名称列表
        """
        if not self.model:
            return []
        
        try:
            if hasattr(self.model, 'names') and self.model.names:
                names_dict = self.model.names
                max_id = max(names_dict.keys()) if names_dict else 0
                names_list = [names_dict.get(i, f"class_{i}") for i in range(max_id + 1)]
                return names_list
        except Exception as e:
            print(f"[ERROR] 获取类别名称失败: {e}")
        
        return []
    
    def predict_images_batch(
        self,
        image_paths: List[str],
        conf_threshold: float = 0.25,
        selected_classes: Optional[List[str]] = None
    ) -> List[List[Dict]]:
        """
        批量处理多张图片（提高GPU利用率）
        
        Args:
            image_paths: 图片路径列表
            conf_threshold: 置信度阈值
            selected_classes: 选中的类别名称列表（None表示使用所有类别）
        
        Returns:
            检测结果列表的列表，每个结果对应一张图片
        """
        if not image_paths:
            return []
        
        return self._predict_images_batch_direct(image_paths, conf_threshold, selected_classes)
    
    def predict_image(
        self,
        image_path: str,
        conf_threshold: float = 0.25,
        selected_classes: Optional[List[str]] = None
    ) -> List[Dict]:
        """
        对单张图片进行推理
        
        Args:
            image_path: 图片路径
            conf_threshold: 置信度阈值
            selected_classes: 选中的类别名称列表（None表示使用所有类别）
        
        Returns:
            检测结果列表，每个结果包含：
            {
                "class_name": str,
                "class_id": int,
                "confidence": float,
                "bbox": {
                    "x_center": float,
                    "y_center": float,
                    "width": float,
                    "height": float
                }
            }
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片文件不存在: {image_path}")
        
        return self._predict_image_direct(image_path, conf_threshold, selected_classes)
    
    def _predict_image_direct(
        self,
        image_path: str,
        conf_threshold: float,
        selected_classes: Optional[List[str]]
    ) -> List[Dict]:
        """直接方式推理（使用已加载的模型，支持GPU加速）"""
        if not self.model:
            raise RuntimeError("模型未加载")
        
        try:
            # 确定使用的设备（优先使用GPU）
            # 注意：使用solo pool避免CUDA fork问题
            try:
                device = 'cuda' if torch.cuda.is_available() else 'cpu'
                if device == 'cuda':
                    print(f"[DEBUG] 使用GPU推理: {torch.cuda.get_device_name(0)}")
                else:
                    print(f"[DEBUG] 使用CPU推理")
            except RuntimeError as e:
                # 如果CUDA访问失败，回退到CPU
                print(f"[WARNING] GPU访问失败，回退到CPU: {e}")
                device = 'cpu'
            
            # 运行推理（使用GPU如果可用，需要启用mask输出）
            # 检查模型类型，如果是分割模型则显式指定task='segment'
            try:
                # 检查模型的task属性（YOLO模型加载后会有task属性）
                model_task = getattr(self.model, 'task', None)
                print(f"[DEBUG] 单张推理 - 模型task类型: {model_task}")
                
                # 如果模型是分割模型，显式指定task='segment'以确保返回masks
                if model_task == 'segment':
                    results = self.model.predict(
                        image_path,
                        conf=conf_threshold,
                        verbose=False,
                        device=device,
                        half=(device == 'cuda'),  # GPU时启用FP16加速
                        task='segment'  # 显式指定分割任务
                    )
                else:
                    # 默认情况下，让YOLO自动检测模型类型
                    results = self.model.predict(
                        image_path,
                        conf=conf_threshold,
                        verbose=False,
                        device=device,
                        half=(device == 'cuda')  # GPU时启用FP16加速
                    )
            except Exception as e:
                # 如果指定task失败，回退到默认方式
                print(f"[WARNING] 单张推理 - 指定task失败，使用默认方式: {e}")
                results = self.model.predict(
                    image_path,
                    conf=conf_threshold,
                    verbose=False,
                    device=device,
                    half=(device == 'cuda')
                )
            
            detections = []
            
            for result in results:
                if result.boxes is not None and len(result.boxes) > 0:
                    boxes = result.boxes
                    # 获取masks（如果模型支持分割）
                    masks = result.masks if hasattr(result, 'masks') and result.masks is not None else None
                    
                    # 获取图片尺寸
                    img_width = result.orig_shape[1] if hasattr(result, 'orig_shape') else None
                    img_height = result.orig_shape[0] if hasattr(result, 'orig_shape') else None
                    
                    if not img_width or not img_height:
                        continue
                    
                    for i in range(len(boxes)):
                        cls_id = int(boxes.cls[i])
                        conf = float(boxes.conf[i])
                        class_name = self.model.names.get(cls_id, f"class_{cls_id}")
                        
                        # 如果指定了类别过滤，只保留选中的类别
                        if selected_classes and class_name not in selected_classes:
                            continue
                        
                        # 获取边界框（YOLO格式：xyxy）
                        box = boxes.xyxy[i].cpu().numpy()
                        x1, y1, x2, y2 = box
                        
                        # 转换为YOLO格式（归一化的中心点坐标和宽高）
                        width = x2 - x1
                        height = y2 - y1
                        x_center = (x1 + x2) / 2.0
                        y_center = (y1 + y2) / 2.0
                        
                        # 归一化（确保转换为Python原生float类型，避免numpy类型导致JSON序列化问题）
                        x_center_norm = float(x_center / img_width)
                        y_center_norm = float(y_center / img_height)
                        width_norm = float(width / img_width)
                        height_norm = float(height / img_height)
                        
                        detection = {
                            "class_name": class_name,
                            "class_id": cls_id,
                            "confidence": float(conf),  # 确保confidence也是Python原生类型
                            "bbox": {
                                "x_center": x_center_norm,
                                "y_center": y_center_norm,
                                "width": width_norm,
                                "height": height_norm
                            }
                        }
                        
                        # 如果有mask，转换为polygon
                        if masks is not None and i < len(masks.data):
                            try:
                                import cv2
                                import numpy as np
                                
                                # 获取mask数据
                                mask = masks.data[i].cpu().numpy()
                                
                                # 将mask调整到原始图片尺寸
                                if hasattr(masks, 'orig_shape'):
                                    mask_resized = cv2.resize(mask.astype(np.uint8), (img_width, img_height), interpolation=cv2.INTER_NEAREST)
                                else:
                                    mask_resized = mask.astype(np.uint8)
                                
                                # 找到轮廓
                                contours, _ = cv2.findContours(mask_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                                
                                if contours:
                                    # 选择最大的轮廓
                                    largest_contour = max(contours, key=cv2.contourArea)
                                    
                                    # 使用Douglas-Peucker算法简化轮廓
                                    epsilon = 0.002 * cv2.arcLength(largest_contour, True)
                                    simplified_contour = cv2.approxPolyDP(largest_contour, epsilon, True)
                                    
                                    # 限制最大顶点数为15
                                    max_points = 15
                                    if len(simplified_contour) > max_points:
                                        # 逐步增加epsilon直到顶点数<=15
                                        epsilon_multipliers = [0.005, 0.01, 0.02, 0.05, 0.1]
                                        for mult in epsilon_multipliers:
                                            epsilon = mult * cv2.arcLength(largest_contour, True)
                                            simplified_contour = cv2.approxPolyDP(largest_contour, epsilon, True)
                                            if len(simplified_contour) <= max_points:
                                                break
                                        
                                        # 如果仍然超过15个顶点，强制限制
                                        if len(simplified_contour) > max_points:
                                            # 均匀采样，保留15个顶点
                                            step = len(simplified_contour) / max_points
                                            indices = [int(i * step) for i in range(max_points)]
                                            simplified_contour = simplified_contour[indices]
                                    
                                    # 转换为归一化坐标的points数组
                                    points = []
                                    for point in simplified_contour:
                                        x_norm = float(point[0][0]) / img_width
                                        y_norm = float(point[0][1]) / img_height
                                        points.append([x_norm, y_norm])
                                    
                                    # 至少需要3个点才能形成多边形
                                    if len(points) >= 3:
                                        detection["polygon"] = {"points": points}
                            except Exception as e:
                                import traceback
                                print(f"[WARNING] 转换mask到polygon失败: {e}")
                                traceback.print_exc()
                                # 如果转换失败，只使用bbox
                        
                        detections.append(detection)
            
            return detections
        except Exception as e:
            print(f"[ERROR] 推理失败: {e}")
            import traceback
            traceback.print_exc()
            raise RuntimeError(f"推理失败: {e}")
    
    def _predict_images_batch_direct(
        self,
        image_paths: List[str],
        conf_threshold: float,
        selected_classes: Optional[List[str]]
    ) -> List[List[Dict]]:
        """批量处理多张图片（直接方式）"""
        if not self.model:
            raise RuntimeError("模型未加载")
        
        # 直接调用predict，传入图片列表
        # 注意：使用solo pool避免CUDA fork问题
        try:
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        except RuntimeError as e:
            # 如果CUDA访问失败，回退到CPU
            print(f"[WARNING] GPU访问失败，回退到CPU: {e}")
            device = 'cpu'
        # 检查模型类型，如果是分割模型则显式指定task='segment'
        try:
            # 检查模型的task属性（YOLO模型加载后会有task属性）
            model_task = getattr(self.model, 'task', None)
            print(f"[DEBUG] 批量推理 - 模型task类型: {model_task}")
            
            # 如果模型是分割模型，显式指定task='segment'以确保返回masks
            if model_task == 'segment':
                results = self.model.predict(
                    image_paths,
                    conf=conf_threshold,
                    verbose=False,
                    device=device,
                    half=(device == 'cuda'),  # GPU时启用FP16加速
                    task='segment'  # 显式指定分割任务
                )
            else:
                # 默认情况下，让YOLO自动检测模型类型
                results = self.model.predict(
                    image_paths,
                    conf=conf_threshold,
                    verbose=False,
                    device=device,
                    half=(device == 'cuda')  # GPU时启用FP16加速
                )
        except Exception as e:
            # 如果指定task失败，回退到默认方式
            print(f"[WARNING] 批量推理 - 指定task失败，使用默认方式: {e}")
            results = self.model.predict(
                image_paths,
                conf=conf_threshold,
                verbose=False,
                device=device,
                half=(device == 'cuda')
            )
        
        # 处理结果
        all_detections = []
        for result in results:
            detections = []
            if result.boxes is not None and len(result.boxes) > 0:
                boxes = result.boxes
                masks = result.masks if hasattr(result, 'masks') and result.masks is not None else None
                print(f"[DEBUG] 批量推理 - 检测到 {len(boxes)} 个目标，masks: {'有' if masks is not None else '无'}")
                
                for i in range(len(boxes)):
                    cls_id = int(boxes.cls[i])
                    conf = float(boxes.conf[i])
                    class_name = self.model.names.get(cls_id, f"class_{cls_id}")
                    
                    if selected_classes and class_name not in selected_classes:
                        continue
                    
                    box = boxes.xyxy[i].cpu().numpy()
                    x1, y1, x2, y2 = box
                    
                    img_width = result.orig_shape[1] if hasattr(result, 'orig_shape') else None
                    img_height = result.orig_shape[0] if hasattr(result, 'orig_shape') else None
                    
                    if img_width and img_height:
                        width = x2 - x1
                        height = y2 - y1
                        x_center = (x1 + x2) / 2.0
                        y_center = (y1 + y2) / 2.0
                        
                        # 归一化（确保转换为Python原生float类型，避免numpy类型导致JSON序列化问题）
                        x_center_norm = float(x_center / img_width)
                        y_center_norm = float(y_center / img_height)
                        width_norm = float(width / img_width)
                        height_norm = float(height / img_height)
                        
                        detection = {
                            "class_name": class_name,
                            "class_id": cls_id,
                            "confidence": float(conf),  # 确保confidence也是Python原生类型
                            "bbox": {
                                "x_center": x_center_norm,
                                "y_center": y_center_norm,
                                "width": width_norm,
                                "height": height_norm
                            }
                        }
                        
                        # 如果有mask，转换为polygon
                        if masks is not None and i < len(masks.data):
                            try:
                                import cv2
                                import numpy as np
                                
                                # 获取mask数据
                                mask = masks.data[i].cpu().numpy()
                                
                                # 检查mask的尺寸
                                mask_height, mask_width = mask.shape[:2]
                                print(f"[DEBUG] 批量推理 - Mask尺寸: {mask_width}x{mask_height}, 图片尺寸: {img_width}x{img_height}")
                                
                                # 将mask调整到原始图片尺寸
                                if mask_width != img_width or mask_height != img_height:
                                    mask_resized = cv2.resize(mask.astype(np.uint8), (img_width, img_height), interpolation=cv2.INTER_NEAREST)
                                    print(f"[DEBUG] 批量推理 - Mask已调整尺寸: {mask_width}x{mask_height} -> {img_width}x{img_height}")
                                else:
                                    mask_resized = mask.astype(np.uint8)
                                    print(f"[DEBUG] 批量推理 - Mask尺寸匹配，无需调整")
                                
                                # 找到轮廓
                                contours, _ = cv2.findContours(mask_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                                
                                if contours:
                                    # 选择最大的轮廓
                                    largest_contour = max(contours, key=cv2.contourArea)
                                    
                                    # 使用Douglas-Peucker算法简化轮廓
                                    epsilon = 0.002 * cv2.arcLength(largest_contour, True)
                                    simplified_contour = cv2.approxPolyDP(largest_contour, epsilon, True)
                                    
                                    # 限制最大顶点数为15
                                    max_points = 15
                                    if len(simplified_contour) > max_points:
                                        # 逐步增加epsilon直到顶点数<=15
                                        epsilon_multipliers = [0.005, 0.01, 0.02, 0.05, 0.1]
                                        for mult in epsilon_multipliers:
                                            epsilon = mult * cv2.arcLength(largest_contour, True)
                                            simplified_contour = cv2.approxPolyDP(largest_contour, epsilon, True)
                                            if len(simplified_contour) <= max_points:
                                                break
                                        
                                        # 如果仍然超过15个顶点，强制限制
                                        if len(simplified_contour) > max_points:
                                            # 均匀采样，保留15个顶点
                                            step = len(simplified_contour) / max_points
                                            indices = [int(i * step) for i in range(max_points)]
                                            simplified_contour = simplified_contour[indices]
                                    
                                    # 转换为归一化坐标的points数组
                                    points = []
                                    for point in simplified_contour:
                                        x_norm = float(point[0][0]) / img_width
                                        y_norm = float(point[0][1]) / img_height
                                        points.append([x_norm, y_norm])
                                    
                                    # 至少需要3个点才能形成多边形
                                    if len(points) >= 3:
                                        detection["polygon"] = {"points": points}
                                        print(f"[DEBUG] 批量推理 - 成功转换mask到polygon，顶点数: {len(points)}")
                                    else:
                                        print(f"[WARNING] 批量推理 - Polygon点数不足（{len(points)} < 3），跳过")
                                else:
                                    print(f"[WARNING] 批量推理 - 未找到轮廓")
                            except Exception as e:
                                import traceback
                                print(f"[WARNING] 批量推理 - 转换mask到polygon失败: {e}")
                                traceback.print_exc()
                                # 如果转换失败，只使用bbox
                        else:
                            if masks is None:
                                print(f"[DEBUG] 批量推理 - 目标 {i} 没有masks数据（模型可能不支持分割）")
                            elif i >= len(masks.data):
                                print(f"[DEBUG] 批量推理 - 目标 {i} 超出masks范围（masks.data长度: {len(masks.data)}）")
                        
                        detections.append(detection)
            all_detections.append(detections)
        
        return all_detections


def create_yolo_service(model_path: str) -> YOLOInferenceService:
    """
    创建YOLO推理服务实例
    
    Args:
        model_path: 模型文件路径
    
    Returns:
        YOLOInferenceService实例
    """
    return YOLOInferenceService(model_path)
