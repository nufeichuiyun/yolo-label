"""
训练归档服务：将数据集、模型、训练曲线打包为 zip
"""
import os
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

TRAINING_OUTPUT_DIR = os.getenv("TRAINING_OUTPUT_DIR", "./training_output")
TRAINING_ARCHIVES_DIR = os.getenv("TRAINING_ARCHIVES_DIR", os.path.join(TRAINING_OUTPUT_DIR, "archives"))
MODEL_DIR = os.getenv("MODEL_DIR", "./models")


def _sanitize_filename(name: str) -> str:
    """将名称转为安全文件名，替换非法字符"""
    return re.sub(r'[/\\:*?"<>|]', '_', name).strip() or "project"


def create_training_archive(
    project_name: str,
    project_id: int,
    task_id: int,
    created_at: datetime,
    dataset_dir: str,
    runs_dir: str,
    model_path: str,
) -> str:
    """
    创建训练完整包 zip：数据集、模型、训练曲线。

    Args:
        project_name: 项目名称
        project_id: 项目 ID
        task_id: 训练任务 ID
        created_at: 训练开始时间
        dataset_dir: 数据集目录（含 images/train, images/val, labels/train, labels/val, data.yaml）
        runs_dir: YOLO 训练输出目录（含 weights/, results.png, results.csv 等）
        model_path: 模型文件名（在 MODEL_DIR 下）或完整路径

    Returns:
        归档 zip 相对路径（相对于 TRAINING_ARCHIVES_DIR 的父级，便于存储）
    """
    safe_name = _sanitize_filename(project_name)
    dt_str = created_at.strftime("%Y-%m-%d_%H-%M-%S") if created_at else datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    archive_folder_name = f"{safe_name}_{dt_str}"
    archives_dir = os.path.abspath(TRAINING_ARCHIVES_DIR)
    os.makedirs(archives_dir, exist_ok=True)
    archive_dir = os.path.join(archives_dir, archive_folder_name)
    os.makedirs(archive_dir, exist_ok=True)

    try:
        # 根目录：{项目名}_{日期时间}，内含 3 个子文件夹，解压后得到 1 个文件夹
        # 1. 数据集 -> dataset/
        dataset_dst = os.path.join(archive_dir, "dataset")
        if os.path.exists(dataset_dir):
            shutil.copytree(dataset_dir, dataset_dst, dirs_exist_ok=True)

        # 2. 模型 -> model/
        model_dst = os.path.join(archive_dir, "model")
        os.makedirs(model_dst, exist_ok=True)
        full_model_path = model_path if os.path.isabs(model_path) else os.path.join(MODEL_DIR, model_path)
        if model_path and os.path.exists(full_model_path):
            shutil.copy2(full_model_path, os.path.join(model_dst, os.path.basename(model_path)))

        # 3. 训练结果（曲线、csv 等）-> training_results/
        training_results_dst = os.path.join(archive_dir, "training_results")
        os.makedirs(training_results_dst, exist_ok=True)
        if os.path.exists(runs_dir):
            for f in os.listdir(runs_dir):
                src = os.path.join(runs_dir, f)
                if os.path.isfile(src) and not f.endswith(".pt"):
                    shutil.copy2(src, os.path.join(training_results_dst, f))

        # 4. 压缩为 zip（arcname 含顶层文件夹名，解压后得到 1 个文件夹内含 3 个子文件夹）
        zip_name = f"{archive_folder_name}.zip"
        zip_path = os.path.join(archives_dir, zip_name)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(archive_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    # 以 archives_dir 为基准，使 zip 内路径为 archive_folder_name/dataset/... 等
                    arcname = os.path.relpath(fp, archives_dir)
                    zf.write(fp, arcname)

        # 5. 删除临时目录
        shutil.rmtree(archive_dir, ignore_errors=True)

        # 返回相对路径，便于存储和下载（archives/xxx.zip）
        return os.path.join("archives", zip_name)
    except Exception as e:
        if os.path.exists(archive_dir):
            shutil.rmtree(archive_dir, ignore_errors=True)
        raise RuntimeError(f"创建训练归档失败: {e}") from e
