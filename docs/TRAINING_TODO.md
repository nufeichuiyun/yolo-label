# 训练功能待办

## 已完成

### 实时显示训练输出状态（loss、mAP 等）✅

**实现**：在 `on_fit_epoch_end` 回调中采集 loss、mAP50、mAP50-95、学习率，写入 Redis；API 在获取任务状态时一并返回 `latest_metrics`；前端训练进度浮层实时展示。

**相关文件**：
- `backend/app/tasks/training.py` - 回调中采集并写入 Redis
- `backend/app/routers/training.py` - `_get_latest_metrics` 从 Redis 读取
- `backend/app/schemas.py` - `TrainingTaskMetrics`
- `frontend/src/pages/ProjectDetail.tsx` - 进度浮层展示指标

### 训练后自动转换 RKNN（RK3588）及 PT+RKNN 打包下载 ✅

**实现**：训练表单可勾选「转换为 RKNN」（默认开启）。训练完成后，将验证集（不足时从训练集补足）复制为量化校准图，派发 `convert_to_rknn_task` 到独立 `rknn` 队列；由独立的 `rknn-worker` 容器（Python 3.10 + RKNN Toolkit2，与主环境隔离）执行 `PT→ONNX→RKNN(INT8)`，状态写入 `training_tasks` 新增字段，前端显示「RKNN 转换中/已转换」并提供「下载 PT+RKNN 包」。

**相关文件**：
- `rknn_converter/` - vendored 转换器 + `Dockerfile`（rknn-worker 镜像）
- `backend/app/tasks/rknn_conversion.py` - 转换任务（子进程调用转换器 CLI）
- `backend/app/tasks/_db_task.py` - 共享 `DatabaseTask`（torch-free，供 rknn-worker 安全导入）
- `backend/app/celery_app.py` - `rknn` 队列路由
- `backend/app/tasks/training.py` - 派发转换 + `collect_calibration_images` 准备校准图
- `backend/app/services/training_service.py` - `collect_calibration_images`
- `backend/app/routers/training.py` - `/download-bundle/{task_id}` 端点
- `backend/alembic/versions/add_rknn_conversion_fields.py` - 新增 `convert_to_rknn/rknn_status/output_rknn_path/rknn_error`
- `frontend/src/pages/ProjectDetail.tsx`、`frontend/src/api/training.ts` - 勾选框、状态标签、下载按钮

## 待实现

### WebSocket/SSE 流式推送训练日志（可选）

**需求**：接近终端的实时输出，如每个 batch 的 loss 等。

**实现思路**：使用 WebSocket 或 SSE 推送训练日志流。
