# yolo-label

> A modern web-based image annotation platform designed specifically for YOLO format.

基于 Web 的 AI 图片标注平台，支持 YOLO 格式的目标检测和实例分割标注。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18.2+-blue.svg)](https://reactjs.org/)

---

## 功能特性

- **多种标注类型**：目标检测（矩形框）、实例分割（多边形）
- **AI 辅助标注**：集成 YOLO11 模型，支持自动预标注，大幅提升标注效率
- **数据管理**：支持 YOLO 格式导入导出，多项目管理
- **权限管理**：超级管理员、项目管理员、标注员三级权限体系
- **Docker 部署**：一键启动，完全容器化，无需外部 conda/CUDA 环境
- **GPU 加速**：自动检测并使用 NVIDIA GPU 加速推理，也支持 CPU 回退

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Ant Design + Fabric.js |
| 后端 | FastAPI + PostgreSQL 15 + Redis |
| AI 模型 | YOLO11 (ultralytics) + PyTorch |
| 异步任务 | Celery + Redis |
| 部署 | Docker + Docker Compose |

## 系统架构

```
┌─────────────────┐
│   Frontend      │  React + TypeScript + Vite
│   (Port 3000)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Backend API   │  FastAPI + Python 3.11
│   (Port 8000)   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────────┐
│PostgreSQL│ │Celery Worker │  YOLO11 + PyTorch + CUDA
│(Port5432)│ │  (GPU 支持)  │
└────────┘ └──────────────┘
    │
    ▼
┌────────┐
│ Redis  │  任务队列和缓存
│(Port6379)│
└────────┘
```

## 目录结构

```
yolo-label/
├── backend/                # 后端代码
│   ├── app/                # 应用代码（路由、模型、服务等）
│   ├── alembic/            # 数据库迁移
│   ├── models/             # YOLO 模型文件
│   ├── main.py             # 入口文件
│   ├── Dockerfile          # 后端镜像构建
│   └── requirements.txt    # Python 依赖
├── frontend/               # 前端代码
│   ├── src/                # 源代码（页面、组件、API 等）
│   ├── Dockerfile          # 前端镜像构建
│   └── package.json        # Node 依赖
├── docker-compose.yml      # 生产环境配置
├── docker-compose.dev.yml  # 开发环境覆盖配置
├── start.sh                # 启动脚本
├── deploy-offline.sh       # 离线部署脚本
├── package-for-offline.sh  # 离线打包脚本
├── .env.example            # 环境变量示例
└── README.md               # 本文件
```

---

## 生产环境部署（推荐）

一键部署脚本会自动完成所有配置工作：

```bash
git clone <repository-url>
cd yolo-label
./deploy.sh
```

脚本会自动引导你完成：

1. **检测/安装 Docker** — 未安装则自动安装
2. **检测 GPU** — 如有 NVIDIA GPU，可选启用并自动安装 NVIDIA Container Toolkit
3. **设置密码** — 交互式设置数据库密码、管理员密码，自动生成 JWT 密钥
4. **配置端口** — 自动检测端口占用，推荐可用端口
5. **构建和启动** — 生成生产配置，构建镜像，启动所有服务
6. **健康检查** — 验证所有服务正常运行，输出部署总结

> **支持重新运行**：再次执行 `./deploy.sh` 可选择保留数据重新部署或完全清除重新开始。

### 系统要求

- **操作系统**：Ubuntu 22.04 / 24.04（或其他支持 Docker 的 Linux 发行版）
- **内存**：至少 2GB 可用
- **磁盘**：至少 4GB 可用空间（首次构建镜像约需 17GB）

### 部署后常用命令

```bash
# 查看所有服务日志
docker-compose -f docker-compose.prod.yml logs -f

# 查看服务状态
docker-compose -f docker-compose.prod.yml ps

# 停止服务（保留数据）
docker-compose -f docker-compose.prod.yml down

# 重启服务
docker-compose -f docker-compose.prod.yml restart

# 重新部署
./deploy.sh
```

---

## 开发环境部署

如需本地开发调试，使用开发环境启动脚本：

```bash
# 启动开发环境（支持热重载）
./start.sh dev

# 强制重新构建
./start.sh dev --build
```

首次启动后初始化数据库：

```bash
docker exec -it yolo-label-backend python init_db.py
```

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

**默认账号**：用户名 `admin`，密码见 `init_db.py` 初始化时的输出

---

## GPU 支持（可选）

GPU 用于加速 AI 辅助标注的推理过程。**如果没有 GPU，系统会自动使用 CPU 进行推理，速度较慢但功能完整。**

### 安装 NVIDIA Container Toolkit

```bash
# 添加 NVIDIA Container Toolkit 仓库
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list \
  | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# 安装
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# 重启 Docker
sudo systemctl restart docker

# 验证安装
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### 验证 GPU 支持

启动服务后，检查 celery worker 日志：

```bash
docker logs yolo-label-celery-worker | grep CUDA
```

应该看到类似输出：
```
[INFO] CUDA可用: True
[INFO] CUDA设备: NVIDIA GeForce RTX 3090
```

---

## AI 辅助标注

AI 预标注功能允许使用 YOLO11 模型自动为项目中的图片生成标注。

### 使用流程

1. **上传模型**
   - 访问模型管理页面：http://localhost:3000/models
   - 点击"上传模型"，选择 YOLO11 模型文件（`.pt` 格式）
   - 系统自动提取模型类别信息

2. **执行预标注**
   - 进入项目详情页面
   - 点击"AI 预标注"按钮
   - 选择模型和需要检测的类别（支持多选）
   - 点击"开始预标注"
   - 任务在后台执行，关闭网页后也会继续运行

3. **检查和修正**
   - 预标注完成后查看自动生成的标注
   - 手动修正不准确的标注，补充遗漏的标注
   - AI 标注结果与手动标注可混合使用

### 注意事项

- 仅支持 YOLO11 格式的模型文件（`.pt`）
- 建议使用 `yolo11n.pt`（nano 版本，速度快）进行快速预标注
- 如果模型中的类别在项目中不存在，系统会自动创建
- 大量图片的预标注可能需要较长时间，可通过进度条查看状态

---

## 离线部署

适用于不联网的服务器环境。

### 在源服务器上（联网）

```bash
cd /path/to/yolo-label

# 运行打包脚本，生成离线部署包
./package-for-offline.sh

# 生成文件位于 /tmp/yolo-label-offline-*.tar.gz（约 6-8GB）
# 通过 U 盘、移动硬盘等方式传输到目标服务器
```

### 在目标服务器上（不联网）

```bash
# 解压部署包
tar -xzf yolo-label-offline-*.tar.gz
cd yolo-label-offline-*

# 运行部署脚本
chmod +x deploy-offline.sh
./deploy-offline.sh
```

> 目标服务器需要预先安装 Docker 和 Docker Compose。

---

## 数据存储与备份

### 数据持久化

所有业务数据存储在 Docker Volumes 中，**不依赖系统用户名，不会因删除容器或镜像而丢失**：

| Volume 名称 | 存储内容 |
|-------------|---------|
| `afa-label_postgres_data` | 数据库数据 |
| `afa-label_uploads_data` | 上传的图片 |
| `afa-label_annotations_data` | 标注数据 |
| `afa-label_models_data` | 模型文件 |

> **注意**：执行 `docker-compose down -v` 会删除 volumes，导致数据丢失！

### 数据备份

```bash
# 备份数据库
docker run --rm -v afa-label_postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup.tar.gz /data

# 备份上传的图片
docker run --rm -v afa-label_uploads_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/uploads_backup.tar.gz /data

# 备份标注数据
docker run --rm -v afa-label_annotations_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/annotations_backup.tar.gz /data

# 备份模型文件
docker run --rm -v afa-label_models_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/models_backup.tar.gz /data
```

### 数据恢复

```bash
docker run --rm -v afa-label_postgres_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/postgres_backup.tar.gz -C /
# 其他 volume 恢复方式类似
```

---

## 开发说明

### 开发环境

开发环境采用混合模式，支持热重载：

```bash
./start.sh dev
```

- **前端**：Docker 容器运行，代码通过 volume 挂载，Vite 热重载
- **后端**：Docker 容器运行，代码通过 volume 挂载，uvicorn --reload
- **数据库 / Redis**：Docker 容器运行

### 前端本地开发

```bash
cd frontend
npm install
npm start
# 前端运行在 http://localhost:3000，支持热重载
```

### 数据库迁移

```bash
# 进入后端容器
docker exec -it yolo-label-backend bash

# 创建迁移
alembic revision --autogenerate -m "描述"

# 应用迁移
alembic upgrade head
```

---

## 常见问题

### 端口被占用

检查端口占用情况，或修改 `docker-compose.yml` 中的端口映射：

```bash
netstat -tulpn | grep -E '3000|8000|5432|6379'
```

### 数据库连接失败

确保 PostgreSQL 容器已正常启动：

```bash
docker-compose ps
docker-compose logs db
```

如果问题持续，尝试重建：

```bash
docker-compose down -v
docker-compose up -d
sleep 10
docker exec -it yolo-label-backend python init_db.py
```

### GPU 不可用

1. 确认已安装 NVIDIA 驱动：`nvidia-smi`
2. 确认已安装 NVIDIA Container Toolkit（见上方安装步骤）
3. 查看 Celery Worker 日志：`docker logs yolo-label-celery-worker | grep CUDA`

### 预标注任务瞬间完成但无结果

确认 Celery Worker 使用 solo pool：

```bash
docker logs yolo-label-celery-worker | grep "solo"
# 应该看到: concurrency: 1 (solo)
```

### 模型加载失败

1. 确认模型文件格式正确（`.pt` 文件）
2. 检查模型文件权限：`docker exec -it yolo-label-backend ls -la /app/models`
3. 查看详细日志：`docker logs yolo-label-celery-worker`

### 权限问题

```bash
sudo chown -R $USER:$USER .
```

---

## 生产环境建议

1. **修改默认密码**：首次登录后立即修改 admin 密码
2. **修改环境变量**：编辑 `.env` 文件，修改数据库密码和 SECRET_KEY
3. **配置 HTTPS**：使用 Nginx 等反向代理配置 HTTPS
4. **定期备份**：备份 PostgreSQL 数据库和 Docker volumes
5. **监控资源**：监控 CPU、内存、GPU 使用情况
6. **日志管理**：配置日志轮转和集中管理

---

## 贡献

欢迎贡献！请遵循以下流程：

1. Fork 仓库
2. 创建分支：`git checkout -b feature/your-feature-name`
3. 提交更改（使用[约定式提交](https://www.conventionalcommits.org/)格式）：
   - `feat:` 新功能
   - `fix:` 修复 bug
   - `docs:` 文档更新
   - `refactor:` 代码重构
4. 推送分支并创建 Pull Request

## 许可证

本项目采用 [MIT License](./LICENSE) 开源协议。

## 致谢

- [YOLO / ultralytics](https://github.com/ultralytics/ultralytics) - 目标检测模型
- [FastAPI](https://fastapi.tiangolo.com/) - 现代 Web 框架
- [React](https://reactjs.org/) - UI 框架
- [Ant Design](https://ant.design/) - UI 组件库
- [Fabric.js](http://fabricjs.com/) - Canvas 库
