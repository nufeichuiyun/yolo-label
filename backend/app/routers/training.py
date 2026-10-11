"""
训练路由
"""
import json
import logging
import os
import tempfile
import uuid
import zipfile
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import User, TrainingTask, Project, Category, UserRole
from app.schemas import TrainingTaskCreate, TrainingTaskResponse, TrainingTaskMetrics
from app.auth import get_current_user, require_project_admin_or_super_admin
from app.routers.projects import check_project_permission
from app.services.training_service import (
    get_annotated_images_for_project,
    get_default_base_model,
    get_available_base_models,
)
from app.services.training_archive_service import TRAINING_ARCHIVES_DIR
from app.tasks.training import train_model_task, TRAINING_METRICS_KEY_PREFIX
from app.celery_app import celery_app
from app.trusted_models import validate_base_model

router = APIRouter(prefix="/api/training", tags=["训练"])
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
TRAINING_OUTPUT_DIR = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")
CELERY_TASK_KEY_PREFIX = "training_celery:"
CELERY_TASK_TTL = 86400  # 24 小时


def _get_latest_metrics(task_id: str) -> TrainingTaskMetrics | None:
    """从 Redis 读取训练实时指标"""
    try:
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        raw = r.get(f"{TRAINING_METRICS_KEY_PREFIX}{task_id}")
        if raw:
            data = json.loads(raw)
            return TrainingTaskMetrics(
                epoch=data.get("epoch"),
                loss=data.get("loss"),
                map50=data.get("map50"),
                map50_95=data.get("map50_95"),
                lr=data.get("lr"),
            )
    except Exception:
        pass
    return None


@router.post("", response_model=TrainingTaskResponse)
async def create_training_task(
    task_data: TrainingTaskCreate,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """创建训练任务（仅项目管理员或超级管理员可操作）"""
    project = check_project_permission(
        task_data.project_id, current_user, db,
        required_role=UserRole.PROJECT_ADMIN
    )

    # 校验：至少 1 个类别
    categories = db.query(Category).filter(Category.project_id == task_data.project_id).all()
    if len(categories) < 1:
        raise HTTPException(status_code=400, detail="项目至少需要 1 个类别")

    # 校验：至少 10 张已标注图片
    images = get_annotated_images_for_project(db, task_data.project_id)
    if len(images) < 10:
        raise HTTPException(status_code=400, detail="项目至少需要 10 张已标注图片")

    # 校验：同一项目不能有运行中的训练任务
    running = db.query(TrainingTask).filter(
        TrainingTask.project_id == task_data.project_id,
        TrainingTask.status == "running"
    ).first()
    if running:
        raise HTTPException(status_code=400, detail="该项目已有训练任务正在运行，请先停止或等待完成后再开始新训练")

    # 确定基础模型
    try:
        base_model = task_data.base_model if task_data.base_model is not None else get_default_base_model(project.annotation_type.value)
        validate_base_model(base_model, project.annotation_type.value, MODEL_DIR)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    epochs = task_data.epochs or 100
    imgsz = task_data.imgsz or 640
    batch = task_data.batch if task_data.batch is not None else 16  # 0=自动根据显存
    train_split = task_data.train_split or 0.8
    convert_to_rknn = True if task_data.convert_to_rknn is None else task_data.convert_to_rknn

    task_id = str(uuid.uuid4())
    db_task = TrainingTask(
        project_id=task_data.project_id,
        base_model=base_model,
        task_id=task_id,
        status="pending",
        progress=0,
        epochs=epochs,
        current_epoch=0,
        train_images=0,
        val_images=0,
        convert_to_rknn=convert_to_rknn,
        created_by=current_user.id
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    result = train_model_task.delay(
        task_id=task_id,
        project_id=task_data.project_id,
        base_model=base_model,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        train_split=train_split
    )
    # 存储 Celery 任务 ID，用于后续 revoke
    if result and result.id:
        import redis
        try:
            r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
            r.setex(f"{CELERY_TASK_KEY_PREFIX}{task_id}", CELERY_TASK_TTL, result.id)
        except Exception:
            pass

    return db_task


@router.get("/task/{task_id}", response_model=TrainingTaskResponse)
async def get_training_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取训练任务状态（运行中时包含 latest_metrics）"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db)
    resp = TrainingTaskResponse.model_validate(task)
    if task.status == "running":
        metrics = _get_latest_metrics(task_id)
        if metrics:
            resp.latest_metrics = metrics
    return resp


@router.post("/task/{task_id}/revoke")
async def revoke_training_task(
    task_id: str,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """中断/停止正在进行的训练任务（即使 Redis 映射丢失也会强制标记为失败，避免任务卡死）"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db, required_role=UserRole.PROJECT_ADMIN)

    if task.status not in ("running", "pending"):
        raise HTTPException(status_code=400, detail="只能中断未完成的任务")

    # 尝试通过 Redis 找回 Celery 任务 ID 并 revoke。失败不影响 DB 状态更新
    # （Redis 重启或映射过期时，Celery 那边任务可能已经死了，但 DB 仍是 running，必须强制清理）
    revoke_sent = False
    try:
        import redis
        r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        celery_task_id = r.get(f"{CELERY_TASK_KEY_PREFIX}{task_id}")
        if celery_task_id:
            celery_task_id = celery_task_id.decode() if isinstance(celery_task_id, bytes) else celery_task_id
            celery_app.control.revoke(celery_task_id, terminate=True)
            revoke_sent = True
    except Exception as e:
        logging.warning("revoke 训练任务时联系 Celery/Redis 失败 task_id=%s err=%s", task_id, e)

    task.status = "failed"
    task.error_message = "用户中断" if revoke_sent else "用户中断（未找到 Celery 映射，仅清理 DB 状态）"
    db.commit()

    msg = "已发送停止信号，任务将尽快终止" if revoke_sent else "未找到对应的 Celery 任务（可能 Redis 重启），已强制清理任务状态"
    return {"message": msg}


@router.get("/project/{project_id}", response_model=List[TrainingTaskResponse])
async def list_project_training_tasks(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目的所有训练任务"""
    check_project_permission(project_id, current_user, db)
    tasks = db.query(TrainingTask).filter(
        TrainingTask.project_id == project_id
    ).order_by(TrainingTask.created_at.desc()).all()
    return tasks


@router.get("/project/{project_id}/base-models")
async def get_base_models(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取项目可用的基础模型列表（根据标注类型）"""
    project = check_project_permission(project_id, current_user, db)
    try:
        models = get_available_base_models(project.annotation_type.value)
        default = get_default_base_model(project.annotation_type.value)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"models": models, "default": default}


@router.get("/download/{task_id}")
async def download_trained_model(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """下载训练完成的模型"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db)

    if task.status != "completed":
        raise HTTPException(status_code=400, detail="任务未完成，无法下载模型")

    if not task.output_model_path:
        raise HTTPException(status_code=404, detail="未找到输出模型")

    file_path = os.path.join(MODEL_DIR, task.output_model_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")

    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=task.output_model_path
    )


@router.get("/download-archive/{task_id}")
async def download_training_archive(
    task_id: str,
    current_user: User = Depends(require_project_admin_or_super_admin),
    db: Session = Depends(get_db)
):
    """下载训练完整包（数据集+模型+训练曲线 zip）"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db, UserRole.PROJECT_ADMIN)

    if task.status != "completed":
        raise HTTPException(status_code=400, detail="任务未完成，无法下载归档")

    if not task.output_archive_path:
        raise HTTPException(status_code=404, detail="未找到训练归档（可能为旧版本训练任务）")

    zip_name = os.path.basename(task.output_archive_path)
    # 尝试两种路径：1) TRAINING_ARCHIVES_DIR（与创建时一致） 2) TRAINING_OUTPUT_DIR + output_archive_path
    candidates = [
        os.path.abspath(os.path.join(TRAINING_ARCHIVES_DIR, zip_name)),
        os.path.abspath(os.path.join(TRAINING_OUTPUT_DIR, task.output_archive_path)),
    ]
    file_path = None
    for p in candidates:
        if os.path.exists(p):
            file_path = p
            break
    if not file_path:
        logging.warning(
            "归档文件不存在 task_id=%s output_archive_path=%s 已查找: %s",
            task_id, task.output_archive_path, candidates
        )
        raise HTTPException(status_code=404, detail="归档文件不存在")

    return FileResponse(
        file_path,
        media_type="application/zip",
        filename=os.path.basename(task.output_archive_path)
    )


@router.get("/download-bundle/{task_id}")
async def download_pt_rknn_bundle(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """下载 PT + RKNN 模型包（zip，含 .pt 与 .rknn 两个文件）"""
    task = db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    check_project_permission(task.project_id, current_user, db)

    if task.status != "completed":
        raise HTTPException(status_code=400, detail="任务未完成，无法下载模型包")
    if not task.output_model_path:
        raise HTTPException(status_code=404, detail="未找到 .pt 模型")

    pt_path = os.path.join(MODEL_DIR, task.output_model_path)
    if not os.path.exists(pt_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")

    if task.rknn_status != "completed" or not task.output_rknn_path:
        raise HTTPException(status_code=400, detail="RKNN 尚未转换完成，无法下载模型包")
    rknn_path = os.path.join(MODEL_DIR, task.output_rknn_path)
    if not os.path.exists(rknn_path):
        raise HTTPException(status_code=404, detail="RKNN 文件不存在")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    try:
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(pt_path, os.path.basename(pt_path))
            zf.write(rknn_path, os.path.basename(rknn_path))
    except Exception:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        raise

    return FileResponse(
        tmp.name,
        media_type="application/zip",
        filename=f"model_bundle_{task_id}.zip",
        background=BackgroundTask(os.unlink, tmp.name),
    )
