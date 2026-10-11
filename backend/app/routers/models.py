"""
模型管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
import json
from uuid import uuid4
from app.database import get_db
from app.models import User, Model, UserRole
from app.schemas import ModelResponse, ModelListResponse, ModelCreate
from app.auth import get_current_user, require_super_admin

router = APIRouter(prefix="/api/models", tags=["模型管理"])

MODEL_DIR = os.getenv("MODEL_DIR", "./models")
ALLOWED_EXTENSIONS = {".pt", ".pth", ".onnx"}  # YOLO模型文件扩展名


def ensure_model_dir():
    """确保模型目录存在"""
    os.makedirs(MODEL_DIR, exist_ok=True)


@router.post("/project/{project_id}/upload", response_model=ModelResponse)
async def upload_model(
    project_id: int,
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """仅可信超级管理员可上传模型；PT 解析具有执行代码的能力。"""
    from app.routers.projects import check_project_permission
    
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    ensure_model_dir()
    
    # 检查文件扩展名
    file_ext = os.path.splitext(file.filename or "")[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型，仅支持: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    # 检查项目内模型名称是否已存在
    existing_model = db.query(Model).filter(
        Model.project_id == project_id,
        Model.name == name
    ).first()
    if existing_model:
        raise HTTPException(status_code=400, detail="该项目下模型名称已存在")
    
    # filename 保留相对 MODEL_DIR 的路径语义，旧版根目录文件仍可直接读取。
    # 不使用客户端文件名，避免跨项目覆盖模型或预置权重。
    safe_filename = f"uploads/{project_id}/{uuid4().hex}{file_ext}"
    filepath = os.path.join(MODEL_DIR, safe_filename)
    created_file = False
    committed = False
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        # 排他创建，即使 UUID 碰撞也不能覆盖或在错误清理时删除已有文件。
        with open(filepath, "xb") as buffer:
            created_file = True
            shutil.copyfileobj(file.file, buffer)
        
        file_size = os.path.getsize(filepath)
        
        # 尝试提取模型类别信息
        # 同步解析在后端进程内执行，不能把 Celery 函数名当作隔离边界。
        class_names = None
        try:
            # 使用容器内安装的 Ultralytics 同步解析可信模型。
            from app.tasks.models import extract_model_classes_sync
            result = extract_model_classes_sync(filepath)
            if result and isinstance(result, list) and len(result) > 0:
                class_names = json.dumps(result, ensure_ascii=False)
                print(f"通过celery worker成功提取模型类别信息: {len(result)} 个类别")
        except Exception as e:
            print(f"通过celery worker解析失败: {e}")
            import traceback
            traceback.print_exc()
            # 如果celery worker失败，尝试在后端直接解析（如果后端有ultralytics）
            try:
                from ultralytics import YOLO
                model = YOLO(filepath)
                
                # YOLO11/YOLOv8的类别信息在model.names中（字典格式，key是class_id，value是class_name）
                if hasattr(model, 'names') and model.names:
                    names_dict = model.names
                    # 将字典转换为有序列表
                    if isinstance(names_dict, dict):
                        # 获取所有class_id并排序，按顺序构建列表
                        class_ids = sorted(names_dict.keys())
                        names_list = [names_dict[i] for i in class_ids]
                    elif isinstance(names_dict, list):
                        names_list = names_dict
                    else:
                        names_list = []
                    
                    if names_list:
                        class_names = json.dumps(names_list, ensure_ascii=False)
                        print(f"在后端直接提取模型类别信息: {len(names_list)} 个类别")
                        print(f"类别列表: {names_list[:10]}...")  # 打印前10个类别作为调试
            except ImportError:
                # 后端没有ultralytics，会在选中模型时通过celery worker实时解析
                print(f"后端无法导入ultralytics，将在选中模型时通过celery worker实时解析类别")
            except Exception as e2:
                print(f"警告：无法提取模型类别信息: {e2}")
                import traceback
                traceback.print_exc()
        
        # 如果无法解析，class_names保持为None，不保存任何默认类别
        if class_names:
            print(f"模型类别信息已提取: {class_names[:100]}...")
        else:
            print(f"警告：无法提取模型类别信息，将在选中模型时实时解析")
        
        # 创建数据库记录
        relative_path = f"models/{safe_filename}"
        db_model = Model(
            project_id=project_id,
            name=name,
            filename=safe_filename,
            filepath=relative_path,
            file_size=file_size,
            model_type="yolo11",
            description=description,
            class_names=class_names,
            is_default=False,
            created_by=current_user.id
        )
        db.add(db_model)
        db.commit()
        committed = True
        db.refresh(db_model)
        
        return db_model
    except Exception as e:
        db.rollback()
        # 仅清理本次排他创建且尚未提交的文件，不触碰旧模型/基础权重。
        if created_file and not committed:
            try:
                os.remove(filepath)
            except FileNotFoundError:
                pass
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="模型上传失败") from e


@router.get("/project/{project_id}", response_model=ModelListResponse)
async def list_models(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的模型列表"""
    from app.routers.projects import check_project_permission
    
    # 检查项目权限
    check_project_permission(project_id, current_user, db)
    
    models = db.query(Model).filter(Model.project_id == project_id).order_by(Model.created_at.desc()).all()
    return {"items": models, "total": len(models)}


@router.get("/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取模型详情"""
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    from app.routers.projects import check_project_permission
    check_project_permission(model.project_id, current_user, db)
    return model


@router.delete("/{model_id}")
async def delete_model(
    model_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除模型"""
    from app.routers.projects import check_project_permission
    
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    
    # 检查项目权限
    check_project_permission(model.project_id, current_user, db)
    
    # 检查权限（只有创建者或管理员可以删除）
    if model.created_by != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="无权删除此模型")
    
    # 删除文件
    filepath = os.path.join(MODEL_DIR, model.filename)
    if os.path.exists(filepath):
        os.remove(filepath)
    
    # 删除数据库记录
    db.delete(model)
    db.commit()
    
    return {"message": "模型已删除"}


@router.post("/{model_id}/set-default")
async def set_default_model(
    model_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """设置项目内的默认模型"""
    from app.routers.projects import check_project_permission
    
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    
    # 检查项目权限
    check_project_permission(model.project_id, current_user, db)
    
    # 取消该项目内其他模型的默认状态
    db.query(Model).filter(
        Model.project_id == model.project_id,
        Model.is_default == True
    ).update({"is_default": False})
    
    # 设置当前模型为默认
    model.is_default = True
    db.commit()
    
    return {"message": "默认模型已设置"}


@router.get("/{model_id}/classes")
async def get_model_classes(
    model_id: int,
    force_reparse: bool = True,  # 默认强制重新解析，确保获取最新的类别信息
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取模型的类别列表"""
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    
    from app.routers.projects import check_project_permission
    check_project_permission(model.project_id, current_user, db)

    # 如果数据库中有类别信息且不强制重新解析，直接返回
    if model.class_names and not force_reparse:
        try:
            classes = json.loads(model.class_names)
            if isinstance(classes, list) and len(classes) > 0:
                return {"classes": classes}
        except:
            pass
    
    # 如果数据库中没有，或者强制重新解析，尝试从模型文件实时解析
    # 复用 Celery 任务函数；apply() 在当前进程执行，并不提供隔离。
    # 使用绝对路径，避免相对路径问题
    filepath = os.path.join(MODEL_DIR, model.filename)
    if not os.path.isabs(filepath):
        filepath = os.path.abspath(filepath)
    
    print(f"[DEBUG] get_model_classes - 模型ID: {model_id}, 文件名: {model.filename}")
    print(f"[DEBUG] get_model_classes - MODEL_DIR: {MODEL_DIR}")
    print(f"[DEBUG] get_model_classes - 文件路径: {filepath}")
    print(f"[DEBUG] get_model_classes - 文件是否存在: {os.path.exists(filepath)}")
    print(f"[DEBUG] get_model_classes - force_reparse: {force_reparse}")
    print(f"[DEBUG] get_model_classes - 数据库中已有类别: {model.class_names is not None}")
    if model.class_names:
        print(f"[DEBUG] get_model_classes - 数据库中类别内容（前100字符）: {model.class_names[:100]}...")
    
    if os.path.exists(filepath):
        try:
            print(f"[DEBUG] 尝试通过celery任务解析...")
            from app.tasks.models import extract_model_classes_task
            # apply() 在当前后端进程同步调用任务。
            task_result = extract_model_classes_task.apply(args=[filepath])
            print(f"[DEBUG] celery任务已提交，等待结果...")
            result = task_result.get(timeout=30)  # 等待30秒
            print(f"[DEBUG] celery任务返回结果: {result}")
            print(f"[DEBUG] 结果类型: {type(result)}")
            if result and isinstance(result, list) and len(result) > 0:
                print(f"[DEBUG] celery任务解析成功，类别数量: {len(result)}")
                print(f"[DEBUG] 类别列表（前10个）: {result[:10]}")
                # 更新数据库
                model.class_names = json.dumps(result, ensure_ascii=False)
                db.commit()
                print(f"[SUCCESS] 成功解析模型类别: {len(result)} 个类别")
                return {"classes": result}
            else:
                print(f"[WARNING] celery任务返回空结果或无效结果")
        except Exception as e:
            print(f"[ERROR] 通过celery任务解析失败: {e}")
            import traceback
            traceback.print_exc()
        
        # 如果celery失败，尝试使用同步方式（直接调用，使用容器内安装的ultralytics）
        try:
            print(f"[DEBUG] 尝试使用subprocess方式解析...")
            from app.tasks.models import extract_model_classes_sync
            result = extract_model_classes_sync(filepath)
            print(f"[DEBUG] subprocess方式返回结果: {result}")
            if result and isinstance(result, list) and len(result) > 0:
                print(f"[DEBUG] subprocess方式解析成功，类别数量: {len(result)}")
                print(f"[DEBUG] 类别列表（前10个）: {result[:10]}")
                model.class_names = json.dumps(result, ensure_ascii=False)
                db.commit()
                print(f"[SUCCESS] 成功解析模型类别: {len(result)} 个类别")
                return {"classes": result}
            else:
                print(f"[WARNING] subprocess方式返回空结果")
        except Exception as e2:
            print(f"[ERROR] subprocess方式也失败: {e2}")
            import traceback
            traceback.print_exc()
    else:
        print(f"[ERROR] 模型文件不存在: {filepath}")
    
    # 如果都没有，返回空列表
    print(f"[WARNING] 无法解析模型类别，返回空列表")
    return {"classes": []}
