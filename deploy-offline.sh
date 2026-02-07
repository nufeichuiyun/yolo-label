#!/bin/bash
# 离线部署脚本

set -e

echo "=== YOLO Label 离线部署 ==="

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo "错误: 未安装Docker，请先安装Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "错误: 未安装Docker Compose，请先安装Docker Compose"
    exit 1
fi

# 1. 导入Docker镜像
echo "步骤1: 导入Docker镜像..."
if [ -f "yolo-label-images.tar.gz" ]; then
    echo "解压并导入镜像文件（这可能需要几分钟）..."
    gunzip -c yolo-label-images.tar.gz | docker load
elif [ -f "yolo-label-images.tar" ]; then
    echo "导入镜像文件（这可能需要几分钟）..."
    docker load < yolo-label-images.tar
else
    echo "错误: 未找到镜像文件 yolo-label-images.tar 或 yolo-label-images.tar.gz"
    exit 1
fi
echo "✓ 镜像导入完成"

# 2. 解压项目文件（如果已解压则跳过）
if [ ! -d "offline-deploy" ]; then
    echo "步骤2: 解压项目文件..."
    if [ -f "yolo-label-files.tar.gz" ]; then
        tar -xzf yolo-label-files.tar.gz
    elif [ -f "yolo-label-files.zip" ]; then
        unzip -q yolo-label-files.zip
    else
        echo "⚠ 警告: 未找到项目文件包，假设已在当前目录"
    fi
fi

if [ -d "offline-deploy" ]; then
    cd offline-deploy
fi

echo "✓ 文件准备完成"

# 3. 检查GPU支持（可选）
echo "步骤3: 检查GPU支持..."
if command -v nvidia-smi &> /dev/null; then
    echo "检测到NVIDIA GPU"
    if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &> /dev/null 2>&1; then
        echo "✓ NVIDIA Container Toolkit已安装"
    else
        echo "⚠ 警告: 检测到GPU但NVIDIA Container Toolkit未安装"
        echo "   GPU功能将不可用，但CPU模式仍可工作"
    fi
else
    echo "未检测到GPU，将使用CPU模式"
fi

# 4. 启动服务
echo "步骤4: 启动服务..."
docker-compose up -d

# 5. 等待服务启动
echo "步骤5: 等待服务启动..."
sleep 10

# 6. 检查服务状态
echo "步骤6: 检查服务状态..."
docker-compose ps

# 7. 初始化数据库
echo "步骤7: 初始化数据库..."
max_retries=5
retry=0
while [ $retry -lt $max_retries ]; do
    if docker exec yolo-label-backend python init_db.py 2>&1 | grep -q "创建成功\|已存在"; then
        echo "✓ 数据库初始化完成"
        break
    else
        retry=$((retry + 1))
        echo "等待数据库就绪... ($retry/$max_retries)"
        sleep 5
    fi
done

if [ $retry -eq $max_retries ]; then
    echo "⚠ 警告: 数据库初始化可能失败，请手动检查:"
    echo "  docker exec -it yolo-label-backend python init_db.py"
fi

echo ""
echo "=== 部署完成 ==="
echo ""
echo "访问地址:"
echo "  前端: http://localhost:3000"
echo "  API文档: http://localhost:8000/docs"
echo ""
echo "默认账号:"
echo "  用户名: admin"
echo "  密码: admin123"
echo ""
echo "查看服务状态:"
echo "  docker-compose ps"
echo ""
echo "查看日志:"
echo "  docker logs -f yolo-label-backend"
echo "  docker logs -f yolo-label-celery-worker"
echo ""
echo "停止服务:"
echo "  docker-compose down"
echo ""
echo "启动服务:"
echo "  docker-compose up -d"