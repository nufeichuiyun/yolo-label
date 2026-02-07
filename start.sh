#!/bin/bash

# yolo-label 启动脚本

echo "=========================================="
echo "yolo-label - YOLO图像标注工具"
echo "=========================================="

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: 未安装Docker，请先安装Docker"
    exit 1
fi

# 检查Docker Compose是否安装
if ! command -v docker-compose &> /dev/null; then
    echo "错误: 未安装Docker Compose，请先安装Docker Compose"
    exit 1
fi

# 检查环境
ENV=${1:-dev}

if [ "$ENV" = "prod" ]; then
    echo "启动生产环境..."
    echo "构建镜像..."
    docker-compose build
    echo "启动服务..."
    docker-compose up -d
    
    echo ""
    echo "等待数据库启动..."
    sleep 10
    
    echo ""
    echo "初始化数据库..."
    docker exec -it yolo-label-backend python init_db.py 2>/dev/null || echo "提示: 如果数据库已初始化，可以忽略此错误"
    
    echo ""
    echo "服务已启动！"
    echo "前端地址: http://localhost:3000"
    echo "后端API: http://localhost:8000"
    echo "API文档: http://localhost:8000/docs"
    echo ""
    echo "默认管理员账号:"
    echo "  用户名: admin"
    echo "  密码: admin123"
    echo "⚠️  请及时修改默认密码！"
    echo ""
    echo "查看日志: docker-compose logs -f"
else
    echo "启动开发环境..."
    echo "提示: 首次启动需要构建镜像，可能需要几分钟"
    echo ""
    
    # 检查是否后台运行
    DETACHED=false
    BUILD_FLAG=""
    for arg in "$@"; do
        if [ "$arg" = "-d" ] || [ "$arg" = "--detach" ]; then
            DETACHED=true
        elif [ "$arg" = "--build" ]; then
            BUILD_FLAG="--build"
        fi
    done
    
    # 清理有问题的旧容器（引用不存在镜像的容器）
    echo "清理旧容器（如果存在）..."
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml down 2>/dev/null || true
    
    # 检查是否需要构建
    if [ "$BUILD_FLAG" = "--build" ] || [ "$2" = "--build" ]; then
        echo "强制重新构建镜像..."
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache
    else
        # 先构建镜像（如果不存在会自动构建，已存在则快速跳过）
        echo "检查并构建镜像（如果不存在）..."
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml build
    fi
    
    echo "启动服务..."
    if [ "$DETACHED" = true ] || [ "$2" = "-d" ] || [ "$3" = "-d" ]; then
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
        echo ""
        echo "✅ 服务已在后台启动！"
        echo "前端地址: http://localhost:3000"
        echo "后端API: http://localhost:8000"
        echo "API文档: http://localhost:8000/docs"
        echo ""
        echo "查看日志: docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f"
        echo "停止服务: docker-compose -f docker-compose.yml -f docker-compose.dev.yml down"
    else
        # 前台运行（注意：可能会看到 Docker Compose 日志监控的警告，但不影响服务）
        echo "提示: 如需后台运行，使用 ./start.sh dev -d"
        echo ""
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
    fi
fi
