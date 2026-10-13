<p align="center"><h1 align="center">🏷️ YOLO-Label</h1></p>
<p align="center"><strong>标注 → 训练 → 部署，一个 Web 平台全搞定</strong></p>
<p align="center">开源的一站式 YOLO 视觉平台：数据标注、AI 预标注、模型训练，直到 RK3588 边缘部署，全流程在浏览器里闭环，无需在多个工具间来回切换。</p>

<p align="center">
  <a href="https://github.com/nufeichuiyun/yolo-label">GitHub</a> ·
  <a href="https://gitee.com/junzixing/yolo-label">Gitee</a>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.10+-blue.svg" alt="Python"></a>
  <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-18.2+-blue.svg" alt="React"></a>
  <a href="https://github.com/ultralytics/ultralytics"><img src="https://img.shields.io/badge/YOLO-11-green.svg" alt="YOLO11"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-0.104+-009688.svg" alt="FastAPI"></a>
</p>

<p align="center">
  <a href="#start">🚀 快速开始</a> ·
  <a href="#features">🎯 功能</a> ·
  <a href="#train">🧠 模型训练</a> ·
  <a href="#rknn">📦 边缘部署</a> ·
  <a href="#faq">❓ 常见问题</a>
</p>

<p align="center">
  <img src="pictures/目标检测标注示例.gif" width="48%" alt="目标检测标注示例">
  <img src="pictures/实例分割标注示例.gif" width="48%" alt="实例分割标注示例">
</p>

---

## ✨ 为什么选择 YOLO-Label？

传统工作流要在标注工具、脚本、训练框架之间反复横跳。YOLO-Label 把这一切整合进一个 Web 平台：

- **标注即训练** — 标完直接在平台内训练 YOLO11，告别格式转换与环境折腾
- **AI 提效** — 内置 YOLO11 预标注，自动生成初版标注，人工只需微调
- **开箱即用** — Docker 一键部署，支持 GPU 加速，5 分钟即可开始标注
- **团队协作** — 任务包分配 + 三级权限，适合 1~15 人团队并行作业
- **直达边缘** — 训练完一键转成 RK3588 的 `.rknn`（INT8 量化），打包即可部署

<a id="features"></a>

## 🎯 功能一览

| 功能 | 说明 |
|------|------|
| 🟦 **目标检测标注** | 矩形框标注，快捷键切换类别，支持 YOLO 格式导入导出 |
| 🔷 **实例分割标注** | 多边形标注，顶点增删、右键操作，精细勾勒目标轮廓 |
| 🤖 **AI 预标注** | 用已有 YOLO11 模型自动为图片生成标注，大幅减少手工量 |
| 🧠 **一键训练** | 平台内直接训练 YOLO11，实时查看训练进度与指标曲线 |
| 📦 **RKNN 转换（RK3588）** | 训练后自动把 `.pt` 转成 INT8 量化的 `.rknn`，打包 PT+RKNN 一键下载 |
| 🔁 **项目导出与导入** | 图片 + 类别 + 标注完整打包，支持跨实例迁移与备份 |
| 👥 **权限与协作** | 超级管理员 / 项目管理员 / 标注员三级权限，任务包分配与进度追踪 |
| 🐳 **Docker 部署** | 完全容器化，支持 GPU / CPU / 离线部署，无环境依赖 |

---

<a id="start"></a>

## 🚀 快速开始

源码仓库：[GitHub](https://github.com/nufeichuiyun/yolo-label) · [Gitee](https://gitee.com/junzixing/yolo-label)，主分支均为 `master`。下方示例使用 Gitee，也可将克隆地址替换为 `https://github.com/nufeichuiyun/yolo-label.git`。

### Linux / macOS

```bash
git clone https://gitee.com/junzixing/yolo-label.git
cd yolo-label

./manage.sh prod deploy   # 生产部署（交互式引导：Docker / GPU / 密码 / 端口）
./manage.sh test deploy   # 测试部署（默认配置 + 热重载）
```

### Windows 11

需要 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（启用 WSL2 后端）。GPU 用户额外需要 NVIDIA 驱动（≥ 535，自带 WSL2 GPU 支持，**无需单独装 CUDA Toolkit**）。详见 [`docs/WINDOWS.md`](docs/WINDOWS.md)。

```cmd
git clone https://gitee.com/junzixing/yolo-label.git
cd yolo-label

REM 双击 scripts\yolo-label.bat 打开控制面板（启动/停止/状态/日志/重建）
scripts\yolo-label.bat
```

### 安全部署

生产密钥、首次管理员密码领取、Redis 内网访问和已有安装升级步骤见 [部署安全说明](docs/SECURITY_DEPLOYMENT.md)。模型上传仅限超级管理员，并且必须来自可信来源；原图访问需要登录及项目/任务权限。

### 系统要求

| 项目 | 最低要求 |
|------|---------|
| 操作系统 | Ubuntu 22.04 / 24.04 等支持 Docker 的 Linux；或 **Windows 11 + Docker Desktop (WSL2)** |
| 内存 | 2 GB（训练建议 8 GB+）|
| 磁盘 | 4 GB（首次构建约 17 GB）|
| GPU（可选）| NVIDIA 显卡。Linux 装 [Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)；Windows 仅需新版驱动 + Docker Desktop 启用 GPU |

### 常用命令

| 命令 | 说明 |
|------|------|
| `./manage.sh prod deploy` | 首次生产部署 |
| `./manage.sh prod redeploy` | 重新部署（可选保留数据）|
| `./manage.sh prod restart` | 重启服务 |
| `./manage.sh status` | 查看状态 |
| `./manage.sh logs [服务名]` | 查看日志 |

### 访问地址

- 前端界面：<http://localhost:3000>
- API 文档：<http://localhost:8000/docs>
- 测试环境默认账号 `admin` / `admin123`（请尽快修改）

---

<a id="train"></a>

## 🧠 模型训练

标注完成后无需离开平台即可得到可部署的模型：

```
选择基础模型 → 配置参数 → 后台训练 → 实时监控 → 下载模型
```

1. **前置条件**：项目内至少 10 张已标注图片 + 1 个类别
2. **选择基础模型**：YOLO11 全系列（n / s / m / l / x），按精度-速度权衡选择
3. **配置参数**：训练轮数、批次大小、图片尺寸等，均有合理默认值
4. **后台执行**：训练跑在 Celery 后台，关闭浏览器也不中断
5. **实时监控**：过程中查看 loss、mAP 等指标变化
6. **下载结果**：`.pt` 模型 / 完整训练包（含数据集、权重、曲线图）/ **PT+RKNN 包**（开启转换时）

| 项目类型 | 训练模式 | 基础模型示例 |
|---------|---------|------------|
| 目标检测 | Detection | yolo11n.pt / yolo11s.pt |
| 实例分割 | Segmentation | yolo11n-seg.pt / yolo11s-seg.pt |

系统按项目类型自动选择对应基础模型，无需手动切换。

### 离线训练

容器可能无法联网下载基础模型，可提前在宿主机预下载：

```bash
./scripts/download_yolo_models.sh
```

脚本会把 YOLO11 全系列模型下载到本地 `models/` 目录（已通过 Docker 卷挂载进容器），训练时优先使用本地缓存。

<a id="rknn"></a>

### 📦 RKNN 转换（部署到 RK3588）

面向瑞芯微 RK3588 边缘设备，平台可在训练完成后自动把 `.pt` 转为 INT8 量化的 `.rknn`：

1. 发起训练时勾选 **「训练完成后转换为 RKNN（RK3588，INT8 量化）」**（默认开启）
2. 训练完成后转换在后台异步进行，训练历史中显示 **「RKNN 转换中 → 已转换 RKNN」**
3. 完成后点击 **「下载 PT+RKNN 包」** 获取含 `.pt` 与 `.rknn` 的压缩包

- **量化校准图**自动复用本次验证集（不足时从训练集补足），无需额外准备
- 转换由独立的 **`rknn-worker`** 容器处理（内置 RKNN Toolkit2，独立 Python 3.10 环境），**纯 CPU 即可，无需 GPU**
- 转换链路 `PT → ONNX → RKNN(INT8)`，支持检测与分割模型

---

## 🤖 AI 预标注

1. 在 **模型管理** 页上传 YOLO11 模型（`.pt`）
2. 进入项目详情，点击 **AI 预标注**，选择模型和类别映射
3. 任务后台执行，完成后查看并修正自动生成的标注

无 GPU 时自动用 CPU，功能完整，速度较慢。

## 🔁 项目导出与导入

在项目详情页点击 **导出**：

- **导出 YOLO 格式（仅已标注）**：仅含已标注图片与标注文件，适合直接训练或下游任务
- **导出完整项目（可导入）**：含项目元数据、类别、全部图片及标注，用于迁移或备份

在 **项目管理** 页点击 **导入项目**，选择之前导出的 zip 即可（需项目管理员或超级管理员权限）。

## ⚙️ 部署进阶（GPU / 离线）

```bash
# 验证 GPU 是否可用（需先装 NVIDIA Container Toolkit）
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi

# 离线部署：联网环境打包
./manage.sh offline package
# 目标服务器解压后
tar -xzf yolo-label-offline-*.tar.gz && cd yolo-label-offline-* && ./deploy.sh
```

部署时选择启用 GPU，可大幅加速预标注与模型训练。

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Ant Design + Fabric.js |
| 后端 | FastAPI + PostgreSQL 15 + Redis |
| AI | YOLO11 (ultralytics) + PyTorch 2.7（cu128，支持 Blackwell GPU）|
| 边缘部署 | RKNN Toolkit2（PT→ONNX→RKNN，RK3588）|
| 任务队列 | Celery + Redis（训练/预标注走默认队列，RKNN 转换走独立 `rknn` 队列）|
| 部署 | Docker + Docker Compose |

<a id="faq"></a>

## ❓ 常见问题

| 问题 | 解决方案 |
|------|---------|
| 端口被占用 | 部署脚本会自动检测并推荐可用端口 |
| GPU 不可用 | 确认 `nvidia-smi` 正常，已装 NVIDIA Container Toolkit |
| 预标注无结果 | 确认 Celery worker 正常：`docker logs yolo-label-celery-worker` |
| 训练卡在下载模型 | 执行 `./scripts/download_yolo_models.sh` 预下载模型 |
| RKNN 一直「转换中」/ 失败 | 查看转换 worker 日志：`docker logs yolo-label-rknn-worker` |
| 新 GPU（Blackwell，如 RTX 50 系）报 `no kernel image` | 需 torch ≥2.7+cu128（本项目已默认），并确认宿主驱动 ≥ 570 |

---

## 📮 关注与交流

欢迎关注 **「怒飞垂云」** 公众号，获取最新动态、使用教程和技术分享：

<img src="pictures/公众号.jpg" width="200" alt="怒飞垂云公众号">

如果这个项目对你有帮助，欢迎点个 Star ⭐ 支持一下。

## 📄 许可证

本项目采用 [GNU AGPL-3.0](./LICENSE) 许可证。

> 模型训练与推理基于 [Ultralytics YOLO](https://github.com/ultralytics/ultralytics)（AGPL-3.0）。依据 AGPL-3.0，若将本项目作为网络服务对外提供，需向使用者公开对应源代码；如需用于闭源商业场景以规避 AGPL 义务，请向 Ultralytics 申请商业授权。

## 🙏 致谢

[YOLO / ultralytics](https://github.com/ultralytics/ultralytics) · [FastAPI](https://fastapi.tiangolo.com/) · [React](https://reactjs.org/) · [Ant Design](https://ant.design/)

### 同源部署与 RKNN 开关

前端构建时设置 `VITE_API_BASE_URL=/` 可让网页和 API 共用入口，适用于反向代理或 Windows 单端口部署。未设置时保留原有生产环境 8000 端口；也可指定完整 API 地址。

未安装 RKNN worker 的环境，在后端设置 `RKNN_ENABLED=false`。网页会禁用转换选项，接口也会拒绝转换请求；默认保持启用以兼容现有 Compose 部署。

完整训练包中的 `dataset/data.yaml` 使用相对路径，可解压到其他机器使用，不再引用训练服务器的临时目录。
