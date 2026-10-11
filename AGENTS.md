# AGENTS.md

本文件是 Codex 在本仓库工作的项目级约定，应与用户当前请求共同遵循。

## 最高优先级：分支规则

- **本项目只允许直接在 `master` 分支开发。** 修改、暂存、提交或推送前必须运行 `git branch --show-current` 检查当前分支。
- 若当前不在 `master`，应先安全切换回 `master`。若存在未提交改动而无法安全切换，立即停止并告知用户；不得擅自搬运、覆盖或丢弃改动。
- 本规则覆盖通用的 `main` 分支偏好：本仓库的主线及远端默认分支是 `master`。禁止自行新建或切换到其他分支，禁止创建 worktree；如用户要求改变本规则，先停下并确认新的明确授权。
- 仓库可能已有用户改动。开始前检查 `git status --short`，只修改任务所需文件，不清理或格式化无关代码。

## 项目概览

YOLO-Label 是中文 Web 视觉平台，覆盖目标检测与实例分割标注、AI 预标注、YOLO11 模型训练、团队协作，以及面向 RK3588 的 RKNN 转换。

主要架构：

- `frontend/`：React 18、TypeScript、Ant Design、Vite、Fabric.js。
- `backend/`：FastAPI、SQLAlchemy、PostgreSQL、Alembic。
- 后台任务：Celery + Redis。训练和预标注使用默认 `celery` 队列，RKNN 转换使用独立 `rknn` 队列。
- 部署：Docker Compose；GPU 支持由 `docker-compose.gpu.yml` 叠加。

## 目录导航

- `frontend/src/pages/Annotation/`：核心标注编辑器、Hooks、坐标与裁剪工具。
- `frontend/src/pages/`：项目、任务、模型、用户、登录等页面。
- `frontend/src/api/`：Axios API 客户端模块；后端接口变更时同步检查这里及调用页面。
- `backend/app/routers/`：`/api/` 路由。
- `backend/app/services/`：YOLO 推理、训练数据准备、训练归档等业务逻辑。
- `backend/app/tasks/`：训练、预标注、模型与 RKNN Celery 任务。
- `backend/app/models.py`、`backend/app/schemas.py`：数据库模型与 Pydantic Schema。
- `backend/alembic/`：数据库迁移。
- `rknn_converter/`：隔离的 RKNN 转换环境和 Rockchip 修改版 Ultralytics 源码。
- `models/`：预训练模型及运行时模型输出挂载目录。
- `manage.sh`、`scripts/`：部署、维护和模型下载脚本。

## 开发与运行

Docker 测试/开发环境（支持热重载）：

```bash
./manage.sh test deploy
./manage.sh status
./manage.sh logs [服务名]
```

直接使用 Compose 时：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.gpu.yml up
```

前端：

```bash
cd frontend
npm ci
npm run dev
npm run build
npm run test
npm run test:watch
```

后端：

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
celery -A app.celery_app worker --loglevel=info --pool=solo --concurrency=1 -Q celery
alembic upgrade head
alembic revision --autogenerate -m "迁移说明"
```

生产部署使用 `./manage.sh prod deploy|redeploy|restart`；离线打包使用 `./manage.sh offline package`。这些命令会构建产物或改变真实服务状态，只有用户明确要求相应操作时才可运行，不得用于普通代码验证。

## 验证要求

- 前端改动至少运行 `cd frontend && npm run test` 和 `npm run build`。优先使用 Node.js 20.19+；当前 Vitest 4 工具链不支持项目 Dockerfile 中的 Node 18，若遇到 engine 错误，应如实报告为环境限制，不得归因于业务代码。
- Vitest 当前覆盖 `frontend/src/**/__tests__/**/*.test.ts`，重点是标注坐标与裁剪工具。
- 后端安全回归位于 `backend/tests/`。在独立环境安装 `backend/requirements-test.txt` 后，从仓库根运行 `python -m unittest discover -s backend/tests -v`；使用临时 SQLite/目录，模型解析及任务投递由测试隔离，不替代 GPU/容器验收。
- 仓库没有 ESLint、Prettier、Ruff、Black 或其他 lint/format 命令；不要虚构检查结果或引入无关工具。
- 仓库当前没有 CI 配置，不能假定提交后会有远程检查兜底。
- 后端改动应按影响范围做导入、启动或相关 API 冒烟验证；数据库、Celery 或跨服务改动优先通过相应 Docker 服务验证。
- 若受 GPU、Docker、数据库或大模型依赖限制而无法完成验证，明确列出未运行的命令和原因。

## 代码与数据不变量

- TypeScript 开启 `strict`、`noUnusedLocals`、`noUnusedParameters`；保持 React 函数组件/Hooks 风格，匹配邻近文件的两空格、单引号和无分号习惯。
- 前端使用 Ant Design `zhCN`，面向用户的界面文案保持中文。
- Python 代码遵循现有 FastAPI 依赖注入和 SQLAlchemy Session 模式，使用四空格缩进，并匹配邻近文件的中文注释与文档字符串风格。
- 数据库模型变化必须同步 Schema、调用方，并创建对应 Alembic migration；容器启动会自动执行 `alembic upgrade head`。
- YOLO 检测标注格式为归一化的 `class_id x_center y_center width height`；分割标注为归一化多边形顶点。不得未经完整兼容性检查改变存储或导入导出格式。
- 权限模型为 `super_admin > project_admin > annotator`，项目还具有成员与任务分配权限；新增接口必须复用或补全相应鉴权。
- 训练/预标注任务留在默认 `celery` 队列；RKNN 转换必须路由到 `rknn` 队列并由独立 `rknn-worker` 消费。两个 worker 使用 solo pool，避免 CUDA/RKNN 多进程问题。
- Redis broker 与结果后端的 `visibility_timeout` 必须保持长于最长任务时限（当前为 48 小时），否则长训练会被重复投递。修改 Celery 配置、任务重试或超时时必须检查这一点。
- `backend/app/task_heartbeat.py`、各类长任务的心跳上报和后端启动时的孤儿任务清扫相互依赖。修改任务状态、训练循环、心跳 TTL 或启动清扫时，必须验证不会重复训练、误杀仍在运行的任务或长期占用 GPU。
- `backend/app/tasks/_db_task.py` 与 `rknn_conversion.py` 必须保持轻依赖，不得导入 torch 或 ultralytics，以保证 Python 3.10 的 RKNN worker 可加载。主后端与 RKNN worker 的 Python、torch、onnx 依赖不兼容，不得合并环境。
- `rknn_converter/yolo11_pt_to_rknn/yolo11_pt_to_rk_onnx/` 是原样收录的 Rockchip 修改版 Ultralytics 8.3.9。除非任务明确要求，不重构、不批量格式化该目录；修改时保留来源声明和 AGPL-3.0 合规信息。

## 安全边界

- `./manage.sh prod clean`、`./manage.sh test clean` 以及部署脚本中的清理选项会删除容器、数据卷和业务数据；未经用户明确授权不得运行。
- 不提交 `.env`、`.env.local`、`.env.prod`、`.credentials`、`.deploy_record`、`.test_env`、`.claude/`、生成的 `docker-compose.prod.yml`，或 `.initial_admin_password`、任何密钥、密码、本机路径。
- 不提交训练产物和校准数据：`models/trained_*.pt`、`models/*.rknn`、`models/*.onnx`、`models/calib/`。用户上传的私有模型 `models/uploads/` 不得提交。不要随意增删大型预训练权重；`models/` 中 n/s/m/l 权重是刻意纳入版本控制的项目资产。
- 不覆盖用户上传、标注、数据库卷、训练输出或备份。需要删除运行时数据时，先精确确认目标和恢复方式。
- 根项目及 vendored Ultralytics 组件采用 AGPL-3.0；新增第三方代码或依赖时检查许可证兼容性并保留必要声明。

## 提交规范

- 仅在用户明确要求时提交或推送。
- 提交信息必须使用中文，格式为“动词 + 对象 + 说明”，简洁描述改动目的，例如：`修复训练任务重复执行问题`。
- 不相关改动应拆分为不同提交；提交前复核 diff，确保不包含生成物、敏感文件或用户的无关修改。
