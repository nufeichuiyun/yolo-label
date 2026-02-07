#!/bin/bash
# 打包离线部署文件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PACKAGE_NAME="yolo-label-offline-$(date +%Y%m%d-%H%M%S)"
PACKAGE_DIR="/tmp/$PACKAGE_NAME"

echo "=== 打包离线部署文件 ==="
echo "目标目录: $PACKAGE_DIR"

mkdir -p "$PACKAGE_DIR"

# 1. 导出Docker镜像
echo "步骤1: 导出Docker镜像..."
if docker images | grep -q "afa-label_backend"; then
    docker save \
      afa-label_backend:latest \
      afa-label_frontend:latest \
      postgres:15-alpine \
      redis:7-alpine \
      -o "$PACKAGE_DIR/yolo-label-images.tar"
    
    # 压缩镜像（可选，如果空间有限）
    echo "压缩镜像文件..."
    gzip "$PACKAGE_DIR/yolo-label-images.tar"
    echo "✓ 镜像导出完成: $PACKAGE_DIR/yolo-label-images.tar.gz"
else
    echo "⚠ 警告: 未找到镜像，请先运行 docker-compose build"
    exit 1
fi

# 2. 打包项目文件
echo "步骤2: 打包项目文件..."
mkdir -p "$PACKAGE_DIR/offline-deploy"

rsync -av --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.env' \
  --exclude='uploads_data' \
  --exclude='annotations_data' \
  --exclude='models_data' \
  --exclude='postgres_data' \
  --exclude='*.tar.gz' \
  --exclude='*.tar' \
  --exclude='*.zip' \
  --exclude='offline-deploy' \
  ./ "$PACKAGE_DIR/offline-deploy/"

echo "✓ 文件打包完成"

# 3. 复制部署脚本
echo "步骤3: 复制部署脚本..."
if [ -f "deploy-offline.sh" ]; then
    cp deploy-offline.sh "$PACKAGE_DIR/"
    chmod +x "$PACKAGE_DIR/deploy-offline.sh"
else
    echo "⚠ 警告: deploy-offline.sh 不存在，将创建默认版本"
    cat > "$PACKAGE_DIR/deploy-offline.sh" << 'DEPLOY_EOF'
#!/bin/bash
set -e
echo "=== YOLO Label 离线部署 ==="
echo "步骤1: 导入Docker镜像..."
gunzip -c yolo-label-images.tar.gz | docker load
echo "步骤2: 启动服务..."
cd offline-deploy
docker-compose up -d
sleep 10
echo "步骤3: 初始化数据库..."
docker exec -it yolo-label-backend python init_db.py
echo "部署完成！访问 http://localhost:3000"
DEPLOY_EOF
    chmod +x "$PACKAGE_DIR/deploy-offline.sh"
fi

# 4. 创建README
cat > "$PACKAGE_DIR/README.md" << 'EOF'
# YOLO Label 离线部署包

## 部署步骤

1. 解压文件: `tar -xzf yolo-label-offline-*.tar.gz`
2. 进入目录: `cd yolo-label-offline-*`
3. 运行部署: `./deploy-offline.sh`

## 系统要求

- Linux (Ubuntu 22.04/24.04推荐)
- Docker 20.10+
- Docker Compose 2.0+
- 至少10GB磁盘空间

## 访问地址

- 前端: http://localhost:3000
- API文档: http://localhost:8000/docs
- 默认账号: admin / admin123
EOF

echo "✓ README创建完成"

# 5. 创建最终压缩包
echo "步骤4: 创建最终压缩包..."
cd /tmp
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"

echo ""
echo "=== 打包完成 ==="
echo "部署包位置: /tmp/${PACKAGE_NAME}.tar.gz"
echo ""
echo "文件大小:"
du -h "/tmp/${PACKAGE_NAME}.tar.gz"
echo ""
echo "传输到目标服务器后，解压并运行 deploy-offline.sh"