# 使用NVIDIA CUDA基础镜像（支持GPU）
# 使用CUDA 12.1运行时，兼容大多数GPU
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# 设置Python版本
ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 安装Python 3.11和系统依赖
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    gcc \
    g++ \
    postgresql-client \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 创建python3.11的软链接（如果需要）
RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

# 升级pip
RUN python3 -m pip install --upgrade pip setuptools wheel

# 复制依赖文件
COPY requirements.txt .

# 安装Python依赖（包括PyTorch和YOLO11）
# PyTorch会从CUDA镜像中自动检测CUDA支持
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p /app/uploads/images /app/annotations /app/models

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
