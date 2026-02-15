# 训练功能待办

## 待实现

### 实时显示训练输出状态（loss、mAP 等）

**需求**：在训练过程中实时展示更详细的训练指标，如 loss、mAP、学习率等。

**实现思路**：
- 短期：在 ultralytics 的 `on_train_epoch_end` 等回调中捕获 loss、mAP，存入数据库或 Redis，前端轮询展示
- 长期：使用 WebSocket/SSE 流式推送训练日志，实现接近终端的实时输出

**相关文件**：
- `backend/app/tasks/training.py` - 训练任务，需在回调中收集指标
- `backend/app/models.py` - 可考虑扩展 TrainingTask 表存储指标
- 前端训练进度浮层 - 展示指标
