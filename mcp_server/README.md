# YOLO-Label MCP

提供 11 个工具：项目列表、项目概况、标注结构检查、图片列表、原图与标注预览、训练列表、训练状态、提交训练、取消训练、训练报告、模型/完整包下载。Codex、Claude Code 共用服务；网页功能保留。

## 部署

Python 3.11+，独立虚拟环境。不要把 MCP 依赖安装到已有训练或 RKNN 环境。

```sh
python -m venv .venv-mcp
.venv-mcp/bin/pip install -r mcp_server/requirements.txt
export YOLO_MCP_CONFIG=/private/path/server.json
.venv-mcp/bin/python mcp_server/server.py
```

Windows 使用 `.venv-mcp\Scripts\python.exe`。`server.json` 是部署私有文件，不要提交：

```json
{
  "api_url": "http://127.0.0.1:3000",
  "username": "mcp_operator",
  "password": "填写专用服务账号密码",
  "tokens": {"codex": "填入至少32字符随机令牌", "claude-code": "另一个独立随机令牌"},
  "data_dir": "./mcp-data",
  "host": "127.0.0.1",
  "port": 3001,
  "allowed_hosts": ["127.0.0.1:3001", "localhost:3001"]
}
```

服务账号用项目管理员角色，只加入需要操作的项目，不授予超级管理员权限。所有业务操作仍由现有 API 校验权限。新增项目需要把服务账号加入项目。不同客户端用不同令牌；删除/更换对应令牌后重启 MCP 即可撤销访问。禁用服务账号或移除项目成员权限也会阻止后续业务请求。

局域网部署需要指定监听地址及精确 Host，并给防火墙配置访问范围；HTTP 只用于可信局域网，远程接入使用 HTTPS 或 SSH 隧道。服务拒绝网页 Origin、未知 Host 和未认证请求，不提供文件任意读取或命令执行工具。

## Codex / Claude Code

标准端点是 `http(s)://服务器:3001/mcp`，使用 `Authorization: Bearer <专用令牌>`，支持 Streamable HTTP。

也提供 `client.py` 本地 stdio 转接器。私有 `client.json`：

```json
{"url":"http://服务器:3001/mcp","tokens":{"codex":"实际令牌","claude-code":"另一个令牌"}}
```

Codex 配置（路径替换为实际绝对路径）：

```toml
[mcp_servers.yolo_label]
command = "/path/to/.venv-mcp/bin/python"
args = ["/path/to/yolo-label/mcp_server/client.py", "--config", "/private/path/client.json", "--client", "codex"]
startup_timeout_sec = 30
tool_timeout_sec = 180
```

Claude Code：

```sh
claude mcp add --transport stdio --scope user yolo_label -- /path/to/.venv-mcp/bin/python /path/to/yolo-label/mcp_server/client.py --config /private/path/client.json --client claude-code
claude mcp list
```

配置中仅包含私有文件路径，令牌不进入共享工程配置。私有配置限制为当前用户可读。新会话加载新配置；如果 P3 未启动，先启动 YOLO-Label。

## 使用约定

- `start_training` 默认 3 轮、640 分辨率、batch 4，始终关闭 RKNN。第一次提交生成 UUID `request_id`，同一次提交重试时复用它。同一 ID 换参数会被拒绝。网络超时后先查训练列表，不要自动换 ID 重训。
- 训练立即返回 `task_id`；用 `training_status` 每 10 秒查询。`cancel_training` 是取消请求，训练在批次/轮次检查点退出，加载模型或单个批次较慢时不会立即释放显存。Windows 一键退出仍会检查实际训练进程。
- `check_dataset` 统计类别实例数、涉及图片数、空标注、越界/非法坐标和标注状态不一致。不能代替人工判断漏标、错类、图片质量或数据泄漏。
- `training_report` 读取实际训练包中的 `results.csv`，最多返回最近 100 轮。运行中返回实时状态；不同数据划分的指标不可直接比较。
- `get_artifact` 返回文件名、字节数、SHA256 和 `/artifacts/...` 下载路径。用同一 MCP 令牌访问该路径；不会把模型二进制塞进上下文。数据留在服务端缓存，按任务覆盖同名缓存；管理员可在停止服务后清理 `data_dir` 内 `.pt/.zip`，保留 `operations.sqlite3`（去重记录和操作审计）。
- 审计记录客户端、工具、目标、开始/结果和时间，不记录密码/令牌。仅提供标注读取检查，不开放批量修改标注或删除工程。
- 服务使用一个进程。不要多副本共享此 SQLite 去重库；不要删除去重记录后重试旧提交。

## 图片抽查

先调用 `list_images(project_id, skip, limit)` 分页选图，再调用 `inspect_image(project_id, image_id)`。返回顺序是文字说明、原图预览、标注叠加图，图片使用 MCP 原生 `ImageContent`，HTTP 和 stdio 转接均可传给支持视觉输入的客户端。无需切到网页，也无需另行打开 URL。图片会传入所连接 AI 客户端的模型上下文，请按数据保密要求选用客户端。

- `view` 可选 `both`（默认）、`original`、`overlay`；`max_size` 为预览最长边，默认 1600，范围 256–2048，不放大小图。
- `crop: [左, 上, 右, 下]` 使用 EXIF 校正后的原图像素，先裁剪后缩放。例如 `[100, 200, 900, 800]`；看细小污渍或线头时应补看局部，不能只凭缩略图下结论。
- 矩形和分割多边形均可绘制。图上 `#123 c4` 表示标注 ID 123、类别 ID 4；中文类别名、归一化坐标、原图像素外接框和异常说明在同一返回的文字表里。不同类别颜色固定，不依赖系统中文字体。
- 几何错误会明确列出，不绘制成正常框；不会更改原始标注。EXIF 方向、数据库尺寸不一致会提示核对。图像只读，无图片磁盘缓存，每次重新校验项目及图片权限。
- 单图最多 40 MB、4000 万像素、1000 条标注，支持静态 PNG/JPEG/BMP/WEBP；超限、损坏或动画明确拒绝。预览是 JPEG，已去除 EXIF 等元数据。
- AI 能据图提出漏标、错类、框偏大偏小等疑点；仍需类别定义和有代表性的抽样。空标注可能是负样本，视觉抽查不等于全量验收。只提供审查，不自动修标注。

调用示例：

```json
{"name":"inspect_image","arguments":{"project_id":1,"image_id":12,"view":"both","max_size":1600,"crop":[100,200,900,800]}}
```

## 验证

```sh
.venv-mcp/bin/python -m unittest discover -s mcp_server/tests -v
# 后端独立测试环境
python -m unittest discover -s backend/tests -v
```

官方 SDK `mcp==1.30.0` 使用 MIT 许可证，Pillow 使用 MIT-CMU 许可证，本项目仍为 AGPL-3.0。协议/客户端参考：[Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.30.0)、[Codex MCP](https://developers.openai.com/codex/mcp)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)。
