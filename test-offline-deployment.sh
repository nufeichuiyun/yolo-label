#!/bin/bash
# 离线部署自动测试脚本
# 功能：1. 创建压缩包 2. 清理所有容器和镜像 3. 使用压缩包重新部署

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  YOLO Label 离线部署自动测试"
echo "=========================================="
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 步骤1: 创建压缩包
echo -e "${GREEN}步骤1: 创建离线部署压缩包...${NC}"
if [ -f "package-for-offline.sh" ]; then
    ./package-for-offline.sh
    PACKAGE_FILE=$(ls -t /tmp/yolo-label-offline-*.tar.gz | head -1)
    if [ -f "$PACKAGE_FILE" ]; then
        echo -e "${GREEN}✓ 压缩包创建成功: $PACKAGE_FILE${NC}"
        PACKAGE_SIZE=$(du -h "$PACKAGE_FILE" | cut -f1)
        echo "  文件大小: $PACKAGE_SIZE"
    else
        echo -e "${RED}✗ 压缩包创建失败${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ 未找到 package-for-offline.sh${NC}"
    exit 1
fi

echo ""

# 步骤2: 停止并清理所有容器、镜像和数据
echo -e "${YELLOW}步骤2: 清理现有部署...${NC}"
echo "  警告: 将删除所有容器、镜像和数据卷（不包含代码）"

# 2.1 停止所有容器
echo "  2.1 停止所有容器..."
docker-compose down 2>/dev/null || true
echo "    ✓ 容器已停止"

# 2.2 删除所有相关容器（包括已停止的）
echo "  2.2 删除所有相关容器..."
CONTAINERS=$(docker ps -a --filter "name=yolo-label" --format "{{.Names}}" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    echo "$CONTAINERS" | xargs -r docker rm -f 2>/dev/null || true
    echo "    ✓ 容器已删除"
else
    echo "    ✓ 没有需要删除的容器"
fi

# 2.3 删除所有相关镜像
echo "  2.3 删除所有相关镜像..."
IMAGES=$(docker images --filter "reference=afa-label*" --format "{{.Repository}}:{{.Tag}}" 2>/dev/null || true)
if [ -n "$IMAGES" ]; then
    echo "$IMAGES" | xargs -r docker rmi -f 2>/dev/null || true
    echo "    ✓ 镜像已删除"
else
    echo "    ✓ 没有需要删除的镜像"
fi

# 2.4 删除所有相关数据卷（重要：这会删除所有数据）
echo "  2.4 删除所有数据卷..."
VOLUMES=$(docker volume ls --filter "name=afa-label" --format "{{.Name}}" 2>/dev/null || true)
if [ -n "$VOLUMES" ]; then
    echo "    将删除以下数据卷:"
    echo "$VOLUMES" | sed 's/^/      - /'
    echo "$VOLUMES" | xargs -r docker volume rm 2>/dev/null || true
    echo "    ✓ 数据卷已删除"
else
    echo "    ✓ 没有需要删除的数据卷"
fi

# 2.5 清理未使用的网络
echo "  2.5 清理未使用的网络..."
docker network prune -f >/dev/null 2>&1 || true
echo "    ✓ 网络已清理"

echo -e "${GREEN}✓ 清理完成${NC}"
echo ""

# 步骤3: 使用压缩包重新部署
echo -e "${GREEN}步骤3: 使用压缩包重新部署...${NC}"

# 3.1 解压到临时目录
TEMP_DEPLOY_DIR="/tmp/yolo-label-test-deploy-$$"
mkdir -p "$TEMP_DEPLOY_DIR"
cd "$TEMP_DEPLOY_DIR"

echo "  3.1 解压部署包..."
tar -xzf "$PACKAGE_FILE"
DEPLOY_DIR=$(ls -d yolo-label-offline-* | head -1)
cd "$DEPLOY_DIR"

echo "    ✓ 解压完成"

# 3.2 运行部署脚本
echo "  3.2 运行部署脚本..."
if [ -f "deploy-offline.sh" ]; then
    chmod +x deploy-offline.sh
    ./deploy-offline.sh
else
    echo -e "${RED}✗ 未找到 deploy-offline.sh${NC}"
    exit 1
fi

echo ""

# 步骤4: 验证部署
echo -e "${GREEN}步骤4: 验证部署...${NC}"
sleep 5

# 4.1 检查容器状态
echo "  4.1 检查容器状态..."
docker-compose ps

# 4.2 检查服务可访问性
echo ""
echo "  4.2 检查服务可访问性..."
if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    echo -e "    ${GREEN}✓ 后端API可访问${NC}"
else
    echo -e "    ${RED}✗ 后端API不可访问${NC}"
fi

if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "    ${GREEN}✓ 前端可访问${NC}"
else
    echo -e "    ${RED}✗ 前端不可访问${NC}"
fi

# 4.3 检查YOLO11导入
echo ""
echo "  4.3 检查YOLO11集成..."
if docker logs yolo-label-celery-worker 2>&1 | grep -q "成功导入ultralytics"; then
    echo -e "    ${GREEN}✓ YOLO11成功导入${NC}"
else
    echo -e "    ${YELLOW}⚠ YOLO11导入状态未知${NC}"
fi

# 4.4 检查GPU支持
echo ""
echo "  4.4 检查GPU支持..."
if docker logs yolo-label-celery-worker 2>&1 | grep -q "CUDA可用: True"; then
    echo -e "    ${GREEN}✓ GPU可用${NC}"
elif docker logs yolo-label-celery-worker 2>&1 | grep -q "CUDA可用: False"; then
    echo -e "    ${YELLOW}⚠ GPU不可用（将使用CPU）${NC}"
else
    echo -e "    ${YELLOW}⚠ GPU状态未知${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}  测试完成！${NC}"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  前端: http://localhost:3000"
echo "  API文档: http://localhost:8000/docs"
echo ""
echo "默认账号: admin / admin123"
echo ""
echo "查看日志:"
echo "  docker logs -f yolo-label-backend"
echo "  docker logs -f yolo-label-celery-worker"
echo ""
echo "清理测试目录（可选）:"
echo "  rm -rf $TEMP_DEPLOY_DIR"
echo ""
