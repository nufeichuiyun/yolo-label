# yolo-label

> 一站式 YOLO 标注与训练平台：标注、预标注、训练、导出，全流程打通。

基于 Web 的 AI 图片标注平台，支持 YOLO 格式的目标检测和实例分割。**从零到训练好的模型，一个平台搞定。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18.2+-blue.svg)](https://reactjs.org/)

---

## 为什么选择 yolo-label？

- **标注即训练**：标注完成后可直接在平台内训练 YOLO11 模型，无需导出到其他工具
- **AI 提效**：集成 YOLO11 预标注，自动生成初版标注，人工只需微调，效率提升数倍
- **开箱即用**：Docker 一键部署，支持 GPU 加速，5 分钟即可开始标注
- **团队协作**：任务包分配、权限管理，适合 1~15 人标注团队并行作业

## 核心功能

| 功能 | 说明 |
|------|------|
| **目标检测 / 实例分割** | 矩形框、多边形标注，支持 YOLO 格式导入导出 |
| **AI 预标注** | 上传 YOLO11 模型，自动为图片生成标注，大幅减少手工工作量 |
| **模型训练** | 标注完成后一键训练，自动打包数据集+模型+训练曲线，支持下载完整包 |
| **项目导出与导入** | 完整项目打包（图片、类别、标注）一键导出，支持迁移/备份到其他实例 |
| **权限与协作** | 超级管理员、项目管理员、标注员三级权限，任务包分配与进度追踪 |
| **Docker 部署** | 完全容器化，支持 GPU，无 conda/CUDA 环境依赖 |

## 使用演示

### 目标检测标注

![目标检测标注示例](pictures/目标检测标注示例.gif)

### 实例分割标注

![实例分割标注示例](pictures/实例分割标注示例.gif)

---

## 快速开始

```bash
git clone <repository-url>
cd yolo-label

# 生产环境部署（交互式引导：Docker/GPU/密码/端口）
./manage.sh prod deploy

# 测试环境部署（默认配置，支持热重载）
./manage.sh test deploy
```

### 系统要求

- **操作系统**：Ubuntu 22.04 / 24.04 或支持 Docker 的 Linux
- **内存**：至少 2GB
- **磁盘**：至少 4GB（首次构建约 17GB）

### 常用命令

| 命令 | 说明 |
|------|------|
| `./manage.sh prod deploy` | 首次生产部署 |
| `./manage.sh prod redeploy` | 重新部署（可选保留数据） |
| `./manage.sh prod restart` | 重启服务 |
| `./manage.sh status` | 查看状态 |
| `./manage.sh logs [服务名]` | 查看日志 |

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:3000 |
| API 文档 | http://localhost:8000/docs |

- **测试环境**：默认账号 `admin` / `admin123`

---

## 模型训练

标注完成后，可在项目详情页直接训练 YOLO11 模型：

1. **开始训练**：满足「至少 10 张已标注图片 + 1 个类别」即可点击「开始训练」
2. **配置参数**：选择基础模型（yolo11n / yolo11s 等）、训练轮数、批次大小等
3. **后台执行**：训练在 Celery 后台运行，关闭网页也会继续
4. **下载结果**：训练完成后可下载 `.pt` 模型或完整包（数据集 + 模型 + 训练曲线 zip）

支持目标检测与实例分割两种训练模式，自动根据项目类型选择对应基础模型。

---

## 项目导出与导入

支持将完整项目导出为 zip 或导入到其他实例，便于迁移、备份与协作。

### 导出

在项目详情页点击 **导出** 下拉菜单：

- **导出 YOLO 格式（仅已标注）**：仅包含已标注的图片和标注文件，适合直接用于训练或下游任务
- **导出完整项目（可导入）**：包含项目元数据、类别、全部图片及标注，可用于迁移或备份

导出时会显示进度提示，完成后自动下载 zip 文件。

### 导入

在 **项目管理** 页点击 **导入项目**，选择之前导出的 zip 文件即可。导入过程中会显示上传进度，完成后自动跳转到新项目详情页。

导入项目需具备项目管理员或超级管理员权限。

---

## AI 预标注

1. 在 **模型管理** 页面上传 YOLO11 模型（`.pt`）
2. 进入项目详情，点击 **AI 预标注**，选择模型和类别
3. 任务在后台执行，完成后可查看并修正自动生成的标注

无 GPU 时自动使用 CPU，功能完整，速度较慢。

---

## GPU 支持（可选）

安装 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) 后，部署时选择启用 GPU，可加速预标注与模型训练。

```bash
# 验证 GPU
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

---

## 离线部署

```bash
# 联网环境打包
./manage.sh offline package

# 目标服务器解压后
tar -xzf yolo-label-offline-*.tar.gz
cd yolo-label-offline-*
./deploy.sh
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Ant Design + Fabric.js |
| 后端 | FastAPI + PostgreSQL 15 + Redis |
| AI | YOLO11 (ultralytics) + PyTorch |
| 任务队列 | Celery + Redis |
| 部署 | Docker + Docker Compose |

---

## 常见问题

- **端口被占用**：部署时脚本会检测并推荐可用端口
- **GPU 不可用**：确认 `nvidia-smi` 正常，已安装 NVIDIA Container Toolkit
- **预标注无结果**：确认 Celery 使用 solo pool，查看 `docker logs yolo-label-celery-worker`

---

## 许可证

[MIT License](./LICENSE)

## 致谢

- [YOLO / ultralytics](https://github.com/ultralytics/ultralytics)
- [FastAPI](https://fastapi.tiangolo.com/)
- [React](https://reactjs.org/)
- [Ant Design](https://ant.design/)
