#!/bin/bash
# 在宿主机预下载 YOLO11 官方模型，供 Docker 容器内训练使用（解决容器无外网时的下载失败）
# 用法: ./scripts/download_yolo_models.sh [模型名...]
# 无参数时下载目标检测和实例分割的全部尺寸模型

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="${MODELS_DIR:-$PROJECT_ROOT/models}"
mkdir -p "$MODELS_DIR"

# 目标检测 + 实例分割 全部尺寸
DEFAULT_MODELS=(
    "yolo11n.pt" "yolo11s.pt" "yolo11m.pt" "yolo11l.pt" "yolo11x.pt"
    "yolo11n-seg.pt" "yolo11s-seg.pt" "yolo11m-seg.pt" "yolo11l-seg.pt" "yolo11x-seg.pt"
)
MODELS=("${@:-${DEFAULT_MODELS[@]}}")

BASE_URL="https://github.com/ultralytics/assets/releases/download/v8.4.0"

ok=0 skip=0 fail=0
for name in "${MODELS[@]}"; do
    dst="$MODELS_DIR/$name"
    if [[ -f "$dst" ]]; then
        echo "[跳过] $name (已存在)"
        ((skip++)) || true
        continue
    fi
    url="$BASE_URL/$name"
    echo -n "[下载] $name ... "
    if curl -fSL -o "$dst" "$url" 2>/dev/null || wget -q -O "$dst" "$url" 2>/dev/null; then
        echo "完成"
        ((ok++)) || true
    else
        echo "失败"
        ((fail++)) || true
    fi
done

echo ""
echo "下载完成: 成功 $ok, 跳过 $skip, 失败 $fail"
echo "模型保存至: $MODELS_DIR"
echo ""

# 模型已保存到 ./models，Docker 部署时该目录会挂载到容器的 /app/models，无需额外复制。

[[ $fail -gt 0 ]] && exit 1
