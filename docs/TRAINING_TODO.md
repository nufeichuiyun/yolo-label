# 训练功能待办

## 已完成

### 实时显示训练输出状态（loss、mAP 等）✅

**实现**：在 `on_fit_epoch_end` 回调中采集 loss、mAP50、mAP50-95、学习率，写入 Redis；API 在获取任务状态时一并返回 `latest_metrics`；前端训练进度浮层实时展示。

**相关文件**：
- `backend/app/tasks/training.py` - 回调中采集并写入 Redis
- `backend/app/routers/training.py` - `_get_latest_metrics` 从 Redis 读取
- `backend/app/schemas.py` - `TrainingTaskMetrics`
- `frontend/src/pages/ProjectDetail.tsx` - 进度浮层展示指标

## 待实现

### WebSocket/SSE 流式推送训练日志（可选）

**需求**：接近终端的实时输出，如每个 batch 的 loss 等。

**实现思路**：使用 WebSocket 或 SSE 推送训练日志流。
