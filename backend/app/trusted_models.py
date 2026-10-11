"""受信任基础权重边界，仅依赖标准库；禁止把任意路径/URL交给模型加载器。"""
import hashlib
import os
from pathlib import Path

# 与已核验的 Ultralytics assets v8.4.0 官方 YOLO11 发行权重字节一致。
# 更新权重必须先独立核验来源并更新此清单；不能按运行目录内容自动信任。
MODEL_SHA256 = {
    "yolo11n.pt": "0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1",
    "yolo11s.pt": "85a76fe86dd8afe384648546b56a7a78580c7cb7b404fc595f97969322d502d5",
    "yolo11m.pt": "d5ffc1a674953a08e11a8d21e022781b1b23a19b730afc309290bd9fb5305b95",
    "yolo11l.pt": "9ebd0e09d59811db4b1d61e2bc6730649608b1ac47f8dd01e2da6bca7c20023f",
    "yolo11n-seg.pt": "55ed65c56c91713d23e8402371c6c49a6fd84f257f7dce452e8d70e41dcbe152",
    "yolo11s-seg.pt": "1caa81c0195412efa411b632bcfb8c184939dddb6ae41f6a80c41b211ff257c3",
    "yolo11m-seg.pt": "eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf",
    "yolo11l-seg.pt": "cabe90049795dfc9a370b7934d6dec7f6b9e44a20e573b0ff81b7e205512c872",
}


def allowed_base_models(annotation_type: str) -> tuple[str, ...]:
    if annotation_type == "detection":
        return tuple(f"yolo11{size}.pt" for size in "nsml")
    if annotation_type == "segmentation":
        return tuple(f"yolo11{size}-seg.pt" for size in "nsml")
    raise ValueError("该项目类型尚无受信任的基础权重，暂不支持训练")


def default_base_model(annotation_type: str) -> str:
    return allowed_base_models(annotation_type)[0]


def validate_base_model(
    base_model: str, annotation_type: str, model_dir: str | None = None,
) -> Path:
    """返回经过类型白名单、目录边界与固定 SHA-256 核验的本地文件。"""
    if base_model not in allowed_base_models(annotation_type):
        raise ValueError("基础模型必须来自该项目类型的受信任列表，不接受路径或网址")
    root = Path(model_dir if model_dir is not None else os.getenv("MODEL_DIR", "./models")).resolve()
    try:
        path = (root / base_model).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("基础权重不在受信任模型目录内")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        raise ValueError("受信任基础权重缺失或不可读，请由管理员恢复官方权重") from None
    if digest.hexdigest() != MODEL_SHA256[base_model]:
        raise ValueError("基础权重 SHA-256 校验失败，请由管理员恢复官方权重")
    return path
