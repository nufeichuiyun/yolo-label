# Windows 11 部署指南

YOLO-Label 原生支持 Windows 11，依托 Docker Desktop（WSL2 后端）运行，与 Linux 部署使用同一套 `docker-compose.yml`。本文记录 Win11 上的环境准备、首次部署与常见坑。

## 1. 环境准备

| 组件 | 说明 |
|------|------|
| **NVIDIA 驱动** | 装最新版 Game Ready / Studio 驱动（≥ 535）。新版本自带 WSL2 GPU 透传，**无需在 Windows 上单独安装 CUDA Toolkit**。AMD / Intel Arc 显卡无法加速训练，仅能跑 CPU 模式。 |
| **WSL2** | 管理员 PowerShell 执行 `wsl --install`，重启后确认 `wsl --status` 默认版本为 2。 |
| **Docker Desktop** | 官网下载安装。安装向导中 **"Use Windows containers" 不要勾选**（本项目所有镜像都是 Linux 镜像）。安装完启动后到 Settings → General 确认 "Use the WSL 2 based engine" 已勾选。 |
| **Git for Windows** | 用于克隆仓库，自带 Git Bash。 |

### GPU 透传验证

```powershell
docker run --rm --gpus all nvidia/cuda:12.1.0-runtime-ubuntu22.04 nvidia-smi
```

能看到显卡型号、显存即代表透传正常。

## 2. 首次部署

```cmd
git clone https://gitee.com/junzixing/yolo-label.git
cd yolo-label

REM 启动控制面板（菜单交互：启动/停止/状态/日志/重建）
scripts\yolo-label.bat
```

控制面板首次运行选 `1. 启动服务`，会自动构建后端 / 前端镜像并启动所有服务。

> **首次构建较慢**：后端镜像约 13 GB（PyTorch + ultralytics + CUDA），下载 + 构建通常需要 15-30 分钟。如果你在中国大陆，强烈建议先配代理（见下节）。

服务启动后访问：

- 前端 http://localhost:3000
- API  http://localhost:8000/docs
- 默认账号 `admin` / `admin123`（首次登录后请尽快修改）

## 3. 配置代理（国内网络）

Docker Desktop 的代理需通过 GUI 配置（修改 `settings-store.json` 不会生效）：

1. Settings → Resources → Proxies → **Manual proxy configuration**
2. HTTP / HTTPS 都填入你的代理地址，例如 `http://127.0.0.1:7890`（Clash 默认混合端口，按实际工具填写）
3. Bypass 列表：`localhost,127.0.0.1,*.local`
4. **Apply & restart**

> 该配置同时作用于 `docker pull` 和 `docker build`（pip / apt 等步骤都会走代理）。

## 4. 控制面板说明

`scripts\yolo-label.bat` 是一个交互式菜单（PowerShell 实现，bat 仅作为入口）：

| 选项 | 用途 |
|------|------|
| 1 启动服务 | `docker compose up -d`（自动启用 GPU 配置） |
| 2 停止服务 | `docker compose down`，保留数据卷 |
| 3 查看状态 | 容器状态 + 容器内 GPU 检测 + 端口可达性 |
| 4 查看日志 | 实时 tail，可分别选 backend / worker / frontend |
| 5 重启服务 | `docker compose restart` |
| 6 打开浏览器 | 自动访问 http://localhost:3000 |
| 7 重建镜像 | `docker compose build`，修改依赖或代码后用 |
| 8 初始化数据库 | 执行 `init_db.py` 建表 + 默认 admin |

### 环境变量覆盖

控制面板支持通过环境变量定制行为（在命令行设置后再启动 bat）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SHM_SIZE` | `2g` | Celery worker 共享内存。32 GB+ 物理内存建议改为 `4g`，PyTorch 多 worker 训练时可能需要 |
| `GPU` | （未设） | 设为 `0` 时不挂载 GPU compose 覆盖文件，CPU-only 部署用 |
| `DOCKER_BIN` | 自动检测 | Docker 二进制目录。默认走 PATH，找不到则尝试 `C:\Program Files\Docker\Docker\resources\bin` |

例如要用 CPU-only 启动：

```cmd
set GPU=0
scripts\yolo-label.bat
```

## 5. 常见问题

### `Invoke-WebRequest` 测端口超时

PowerShell 的 `Invoke-WebRequest` 默认走 IE / 系统代理设置。如果你开了系统代理（Clash 等），访问 `localhost` 也会被劫持。验证服务时请用 `curl.exe`（绕过系统代理）：

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/
```

### 5432 端口显示 NOT REACHABLE

控制面板只检测必须对外暴露的 3000 / 8000。Postgres 默认只在 Docker 内部网络可达，不影响后端使用。如确实需要从主机用 DBeaver / pgAdmin 直连数据库，可在本地新建 `docker-compose.override.yml`：

```yaml
services:
  db:
    ports:
      - "5432:5432"
```

### bat 文件中文乱码 / 命令被截断

cmd.exe 解析 `.bat` 文件时使用系统 ANSI 编码（中文系统下为 GBK），即使 `chcp 65001` 也无法完全避免 UTF-8 中文字符（特别是含全角括号、逗号时）被错误拆分。**本项目所有面向用户的菜单逻辑都放在 `.ps1` 中**，`.bat` 仅作为 ASCII-only 入口，从根本上避免该问题。如需自定义菜单，请编辑 `scripts/yolo-label.ps1`（PowerShell 完美支持 UTF-8）。

### Alembic 迁移失败 / 数据库表缺失

首次部署后控制面板的 `8. 初始化数据库` 会执行 `init_db.py`，通过 SQLAlchemy 直接建表并创建默认 admin 账号，可作为 alembic 失败时的兜底。生产环境推荐使用 `manage.sh` 走 alembic 路径（仅 Linux）。

### 训练失败：`Duplicate dispatch rule for <built-in function intern>`

PyTorch 2.6+ 在某些环境下存在 `torch._dynamo` 重复注册的 bug。本项目当前使用 `torch==2.7.1`（cu128 构建，支持 Blackwell GPU）；如果遇到该报错，先确认镜像是用当前仓库的 requirements.txt 重新构建过（控制面板 `7. 重建镜像`）。

## 6. 日常使用

服务一旦启动，可以关闭面板窗口（容器在后台运行）。下次需要停止或查日志时再次双击 `scripts\yolo-label.bat` 即可。

Docker Desktop 默认不开机自启；如果希望开机自动跑起来，在 Docker Desktop Settings → General 勾选 "Start Docker Desktop when you sign in to your computer"。
