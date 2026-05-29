# RKNN 转换 worker 镜像
# 独立于主后端：Python 3.10 + RKNN Toolkit2 2.3.2 + torch<=2.4.0 + onnx==1.16.1
# 不能与主 worker(py3.11/torch2.7.1)共存，故单独成容器，仅消费 Celery 的 rknn 队列。
# 构建上下文必须为仓库根目录(才能同时 COPY rknn_converter/ 与 backend/app)。

FROM python:3.10-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1

# pip 源：默认清华(国内构建快)，可用 --build-arg PIP_INDEX_URL=... 覆盖为官方源
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn
RUN mkdir -p /root/.pip && \
    printf "[global]\nindex-url = %s\ntrusted-host = %s\n" "$PIP_INDEX_URL" "$PIP_TRUSTED_HOST" > /root/.pip/pip.conf

# apt 源：默认清华(国内构建快)，可用 --build-arg APT_MIRROR=deb.debian.org 还原官方源
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" \
        /etc/apt/sources.list 2>/dev/null || true

# 系统依赖(libgl1 提供 libGL.so.1 供 opencv 加载)；--no-install-recommends 避免拉入 mesa/llvm 等庞大依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 复制转换器工程(含 rockchip 改版 ultralytics、RKNN wheel)
COPY rknn_converter/yolo11_pt_to_rknn /app/yolo11_pt_to_rknn

WORKDIR /app/yolo11_pt_to_rknn

# 步骤1: 安装 RKNN Toolkit2 及依赖
RUN cd install_rknn && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements_cp310-2.3.2.txt && \
    pip install --no-cache-dir rknn_toolkit2-2.3.2-cp310-cp310-manylinux_2_17_x86_64.manylinux2014_x86_64.whl

# 步骤2: 安装 YOLO11 导出依赖(含 onnxscript，torch.onnx.export 所需)
RUN cd yolo11_pt_to_rk_onnx && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir onnxscript

# 步骤3: 固定 onnx 版本以兼容 RKNN Toolkit2
RUN pip install --no-cache-dir "onnx==1.16.1"

# 步骤4: 安装 Celery worker 角色所需依赖(与后端版本对齐，共用 broker/DB)
RUN pip install --no-cache-dir \
    celery==5.3.4 \
    redis==5.0.1 \
    sqlalchemy==2.0.23 \
    psycopg2-binary==2.9.9

# 验证转换链路依赖
RUN python3 -c "import rknn; print('RKNN OK')" && \
    python3 -c "import torch; print('PyTorch OK')" && \
    python3 -c "import ultralytics; print('Ultralytics OK')"

# 复制后端应用(用于注册 celery app 与共享 models/database/tasks)
COPY backend/app /app/app

WORKDIR /app

# 只消费 rknn 队列；solo 池 + 单并发，避免 RKNN 多进程问题
CMD ["celery", "-A", "app.celery_app", "worker", "--loglevel=info", "--pool=solo", "--concurrency=1", "-Q", "rknn"]
