"""受信任基础权重边界，仅依赖标准库；禁止把任意路径/URL交给模型加载器。"""
import hashlib
import os
from pathlib import Path

# 与已核验的 Ultralytics assets v8.4.0 官方 YOLO11 / YOLO26 发行权重字节一致。
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
    "yolo26l-seg.pt": "636024306410afa1732692322fba57d22ea2b1c2f07613fcee131a93d7dd380c",
    "yolo26l.pt": "9fe3c544f2b19bebad7ea41e76d7ad3d88b7c2f10d11d24430c5311f6b32db26",
    "yolo26m-seg.pt": "16b636f04e8fb6a325b3370f22dc5e5535ff473e384f4d041fd28d788f6ee9f5",
    "yolo26m.pt": "401cea9ab23ad19246ff7744859816bc599f350e93c9dd30367b6f0a0745d0b7",
    "yolo26n-seg.pt": "361fbfabab285c3237700b6bb91d7ecfa602cd945fffda8dbe1242829b71e73f",
    "yolo26n.pt": "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef",
    "yolo26s-seg.pt": "3da1d83e31caec96f9300eb4064f4f62882c133c7c264d63dfe61a7c197837a4",
    "yolo26s.pt": "646f8bc3fe0a656803d95c294f7852321748cb29d13466a1af8862e2db384a1b",
    "yolo26x-seg.pt": "92b3de0065766a17180d6219858717dc9d03cdce8a3ca9576c97fd75aabb64f3",
    "yolo26x.pt": "9fdd44a31c504547ffb81d2c6d9e6dac3493c8eaa8b0398d3f43bae6c7003e92",
}


def allowed_base_models(annotation_type: str) -> tuple[str, ...]:
    if annotation_type == "detection":
        return tuple(f"yolo{family}{size}.pt" for family, sizes in (("11", "nsml"), ("26", "nsmlx")) for size in sizes)
    if annotation_type == "segmentation":
        return tuple(f"yolo{family}{size}-seg.pt" for family, sizes in (("11", "nsml"), ("26", "nsmlx")) for size in sizes)
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


def supports_rknn(base_model: str) -> bool:
    """当前独立转换器使用 Rockchip 修改版 YOLO11，不能处理 YOLO26。"""
    return base_model in MODEL_SHA256 and base_model.startswith("yolo11")
