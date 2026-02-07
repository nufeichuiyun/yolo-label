"""
模型相关的Celery任务（Docker容器化版本）
"""
import os
import json
from typing import List, Optional
from app.celery_app import celery_app

# 直接导入ultralytics（容器内已安装）
try:
    from ultralytics import YOLO
    print(f"[INFO] 成功导入ultralytics")
except ImportError as e:
    raise ImportError(f"无法导入ultralytics，请确保已安装: {e}")


@celery_app.task(name="extract_model_classes")
def extract_model_classes_task(model_path: str) -> Optional[List[str]]:
    """
    从YOLO模型文件中提取类别信息（使用容器内安装的ultralytics）
    
    Args:
        model_path: 模型文件路径
    
    Returns:
        类别名称列表，如果失败返回None
    """
    print(f"[DEBUG] extract_model_classes_task 开始执行，模型路径: {model_path}")
    return extract_model_classes_direct(model_path)


# 同步调用版本（用于API直接调用）
def extract_model_classes_sync(model_path: str) -> Optional[List[str]]:
    """
    同步版本：从YOLO模型文件中提取类别信息
    
    Args:
        model_path: 模型文件路径
    
    Returns:
        类别名称列表，如果失败返回None
    """
    return extract_model_classes_direct(model_path)


def extract_model_classes_direct(model_path: str) -> Optional[List[str]]:
    """
    直接使用容器内的ultralytics解析模型类别
    
    Args:
        model_path: 模型文件路径
    
    Returns:
        类别名称列表，如果失败返回None
    """
    print(f"[DEBUG] extract_model_classes_direct 开始执行，模型路径: {model_path}")
    
    try:
        if not os.path.exists(model_path):
            print(f"[ERROR] 模型文件不存在: {model_path}")
            return None
        
        print(f"[DEBUG] 加载模型...")
        model = YOLO(model_path)
        print(f"[DEBUG] 模型加载成功")
        
        if hasattr(model, 'names') and model.names:
            names_dict = model.names
            print(f"[DEBUG] model.names类型: {type(names_dict)}")
            
            if isinstance(names_dict, dict):
                print(f"[DEBUG] names_dict是字典，键数量: {len(names_dict)}")
                # 获取所有class_id并排序，按顺序构建列表
                class_ids = sorted(names_dict.keys())
                names_list = [names_dict[i] for i in class_ids]
                print(f"[DEBUG] 构建的类别列表数量: {len(names_list)}")
                print(f"[DEBUG] 类别列表（前10个）: {names_list[:10]}")
                return names_list
            elif isinstance(names_dict, list):
                print(f"[DEBUG] names_dict是列表，直接使用")
                return names_dict
            else:
                print(f"[WARNING] names_dict既不是字典也不是列表")
                return []
        else:
            print(f"[WARNING] model.names不存在或为空")
            return []
    except Exception as e:
        print(f"[ERROR] 提取模型类别失败: {e}")
        import traceback
        traceback.print_exc()
        return None
