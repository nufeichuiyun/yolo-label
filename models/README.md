# 预训练模型目录

本目录已包含 YOLO11 官方预训练模型（n/s/m/l 尺寸），供训练时直接使用，无需联网下载。

## 已包含的模型

| 类型       | 模型 |
|------------|------|
| 目标检测   | yolo11n.pt, yolo11s.pt, yolo11m.pt, yolo11l.pt |
| 实例分割   | yolo11n-seg.pt, yolo11s-seg.pt, yolo11m-seg.pt, yolo11l-seg.pt |

## X 尺寸模型（需自行下载）

`yolo11x.pt` 和 `yolo11x-seg.pt` 体积超过 100MB，未纳入版本控制。若需使用 X 尺寸（最准），请：

1. 运行 `./scripts/download_yolo_models.sh yolo11x.pt yolo11x-seg.pt`（Linux/macOS）
2. 或运行 `.\scripts\download_yolo_models.ps1` 后手动删除其他模型，仅保留 X 尺寸
3. 或从 [ultralytics/assets](https://github.com/ultralytics/assets/releases) 手动下载后放入本目录

训练时若选择 X 尺寸且本地不存在，将尝试在线下载（需容器可访问外网）。

Docker 部署时，此目录会挂载到容器的 `/app/models`，训练会优先使用本地已有模型。
