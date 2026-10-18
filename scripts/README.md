# 脚本说明

## YOLO-Label 控制面板（Windows）

`yolo-label.bat` + `yolo-label.ps1` 提供交互式菜单，封装 `docker compose` 常用操作：启动、停止、状态、日志、重启、重建镜像、初始化数据库。

```cmd
REM 在项目根目录或资源管理器中双击均可
scripts\yolo-label.bat
```

完整说明（含环境要求、代理配置、常见问题）见 [`docs/WINDOWS.md`](../docs/WINDOWS.md)。

Linux / macOS 用户请使用项目根目录的 `manage.sh`。

## YOLO11 模型批量下载

用于预下载 YOLO11 官方预训练模型，解决 Docker 容器内无外网时的训练失败问题。模型保存到项目根目录的 `models/` 文件夹，Docker 部署时会自动挂载到容器的 `/app/models`。

### 下载的模型

| 类型       | 模型列表                                                                 |
|------------|--------------------------------------------------------------------------|
| 目标检测   | yolo11n.pt, yolo11s.pt, yolo11m.pt, yolo11l.pt, yolo11x.pt              |
| 实例分割   | yolo11n-seg.pt, yolo11s-seg.pt, yolo11m-seg.pt, yolo11l-seg.pt, yolo11x-seg.pt |

### Linux / macOS

```bash
# 下载全部 10 个模型
./scripts/download_yolo_models.sh

# 仅下载指定模型
./scripts/download_yolo_models.sh yolo11n.pt yolo11n-seg.pt

# 自定义输出目录
MODELS_DIR=/path/to/models ./scripts/download_yolo_models.sh
```

### Windows

**方式一：PowerShell**

```powershell
.\scripts\download_yolo_models.ps1
```

**方式二：CMD 或双击运行**

```cmd
scripts\download_yolo_models.bat
```

或在资源管理器中双击 `download_yolo_models.bat`。

若遇执行策略限制，可先执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download_yolo_models.ps1
```

### 环境变量

| 变量        | 说明                     |
|-------------|--------------------------|
| `MODELS_DIR`| 模型输出目录，默认 `./models` |

## YOLO26 模型下载

使用主后端的 Python 3.11+ 环境，脚本仅依赖标准库。默认下载检测和实例分割的 n/s/m/l/x 共 10 个官方权重。来源固定为 Ultralytics assets v8.4.0，SHA256 固定在 `backend/app/trusted_models.py`，校验失败不覆盖原文件，也不留下不完整权重。YOLO26 权重不放进 Git 历史。

```sh
python scripts/download_yolo26_models.py
# 只下载两个轻量模型，或指定部署目录：
python scripts/download_yolo26_models.py yolo26n.pt yolo26n-seg.pt --output-dir /path/to/models
```

安装主后端 `requirements.txt` 的 Ultralytics 8.4.176 后，可在训练窗口或 MCP 的 `base_model` 参数选择对应模型。只下载部分权重时，其他尺寸虽在列表中，但提交训练会提示权重缺失。默认仍为 YOLO11；现有 RKNN 转换器不支持 YOLO26。
