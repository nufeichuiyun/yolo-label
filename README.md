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
- **团队协作**：适合 1~15 人标注团队，支持将项目拆分为多个任务包并行分配，多人同时标注
- **Docker 部署**：一键启动，完全容器化，无需外部 conda/CUDA 环境
- **GPU 加速**：自动检测并使用 NVIDIA GPU 加速推理，也支持 CPU 回退

## 使用演示

### 目标检测标注

![目标检测标注示例](pictures/目标检测标注示例.gif)

### 实例分割标注

![实例分割标注示例](pictures/实例分割标注示例.gif)

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
├── manage.sh               # 统一管理脚本（部署/重启/清理/离线打包等）
├── docker-compose.yml      # 基础 Docker Compose 配置
├── docker-compose.dev.yml  # 开发/测试环境覆盖配置
└── README.md               # 本文件
```

---

## 快速开始

所有操作通过统一管理脚本 `manage.sh` 完成：

```bash
git clone <repository-url>
cd yolo-label

# 生产环境首次部署（交互式引导：Docker/GPU/密码/端口）
./manage.sh prod deploy

# 测试环境首次部署（默认配置，支持热重载）
./manage.sh test deploy
```

### 系统要求

- **操作系统**：Ubuntu 22.04 / 24.04（或其他支持 Docker 的 Linux 发行版）
- **内存**：至少 2GB 可用
- **磁盘**：至少 4GB 可用空间（首次构建镜像约需 17GB）

### 管理命令一览

| 命令 | 说明 |
|------|------|
| `./manage.sh prod deploy` | 首次生产环境部署（完整交互式设置） |
| `./manage.sh prod redeploy` | 重复生产环境部署（复用配置，可选保留/清除数据） |
| `./manage.sh prod restart` | 生产环境重启 |
| `./manage.sh prod clean` | 生产环境清理（删除容器、数据、配置） |
| `./manage.sh test deploy` | 首次测试环境部署（默认配置，热重载） |
| `./manage.sh test redeploy` | 重复测试环境部署 |
| `./manage.sh test restart` | 测试环境重启 |
| `./manage.sh test clean` | 测试环境清理 |
| `./manage.sh offline package` | 离线环境打包 |
| `./manage.sh offline deploy` | 离线环境部署（支持重复部署） |
| `./manage.sh status` | 查看服务状态 |
| `./manage.sh logs [服务名]` | 查看服务日志 |
| `./manage.sh help` | 查看完整帮助 |

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

- **生产环境**：登录密码在部署时交互设置
- **测试环境**：默认账号 `admin` / `admin123`

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

```bash
# 在联网服务器上打包（生成 /tmp/yolo-label-offline-*.tar.gz，约 6-8GB）
./manage.sh offline package

# 传输到目标服务器后解压运行
tar -xzf yolo-label-offline-*.tar.gz
cd yolo-label-offline-*
./deploy.sh    # 支持重复运行，自动处理已有部署
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

测试环境采用混合模式，代码通过 volume 挂载，前后端均支持热重载：

```bash
./manage.sh test deploy
```

### 数据库迁移

```bash
docker exec -it yolo-label-backend bash
alembic revision --autogenerate -m "描述"
alembic upgrade head
```

---

## 常见问题

### 端口被占用

生产环境部署时脚本会自动检测端口冲突并推荐可用端口。手动检查：

```bash
netstat -tulpn | grep -E '3000|8000|5432|6379'
```

### 数据库连接失败

```bash
./manage.sh status              # 查看服务状态
./manage.sh logs db             # 查看数据库日志
./manage.sh test redeploy       # 或重新部署
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

1. **使用 `prod deploy`**：部署时会交互式设置强密码和 JWT 密钥，无需手动修改配置文件
2. **配置 HTTPS**：使用 Nginx 等反向代理配置 HTTPS
3. **定期备份**：备份 PostgreSQL 数据库和 Docker volumes
4. **监控资源**：监控 CPU、内存、GPU 使用情况
5. **日志管理**：配置日志轮转和集中管理

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

## 关于作者

本项目由 **怒飞垂云** 开发维护。如果你在使用过程中遇到问题，或者对无人机、飞控开发等领域感兴趣，欢迎通过以下方式交流：

- **个人博客**：[怒飞垂云 | 无人机知识库](http://www.nufeichuiyun.com/) — 分享飞控固件开发、无人机组装调试等原创教程
- **QQ**：3500985284
- **微信公众号**：扫码关注，获取更多技术分享

<img src="pictures/公众号.jpg" width="200" alt="怒飞垂云公众号">
