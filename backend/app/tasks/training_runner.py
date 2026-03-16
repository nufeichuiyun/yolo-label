"""
训练子进程入口：在独立进程中运行 YOLO 训练，进程退出时自动释放全部内存。
供 train_model_task 通过 multiprocessing 调用。
"""
import json
import os
import sys


def run_training(
    task_id: str,
    data_yaml_path: str,
    output_project: str,
    base_model: str,
    epochs: int,
    imgsz: int,
    batch: int,
    workers: int,
    device: str,
) -> int:
    """
    在子进程中执行 YOLO 训练。进程退出时所有内存被 OS 回收。

    Returns:
        0 成功, 非 0 失败
    """
    try:
        from ultralytics import YOLO

        # 若 base_model 为文件名（非绝对路径）且 MODEL_DIR 中已存在，优先使用本地文件，避免无网络时下载失败
        model_path = base_model
        if not os.path.isabs(base_model):
            model_dir = os.getenv("MODEL_DIR", "./models")
            local_path = os.path.join(model_dir, base_model)
            if os.path.isfile(local_path):
                model_path = os.path.abspath(local_path)
                print(f"[training] 使用本地模型: {model_path}", flush=True)

        model = YOLO(model_path)

        # 进度回调：通过 Redis 和 DB 更新，供主进程/前端读取
        def _update_progress(current_epoch: int, progress_pct: int):
            try:
                from app.database import SessionLocal
                from app.models import TrainingTask

                _db = SessionLocal()
                try:
                    _t = _db.query(TrainingTask).filter(TrainingTask.task_id == task_id).first()
                    if _t:
                        _t.current_epoch = current_epoch
                        _t.progress = min(progress_pct, 95)
                        _db.commit()
                finally:
                    _db.close()
            except Exception as e:
                print(f"[training] 进度更新异常: {e}", flush=True)

        def _save_metrics_to_redis(metrics_dict: dict):
            try:
                import redis

                r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
                key = f"training_metrics:{task_id}"  # 与 training.py 中 TRAINING_METRICS_KEY_PREFIX 一致
                r.setex(key, 86400, json.dumps(metrics_dict))
            except Exception as e:
                print(f"[training] Redis 写入指标异常: {e}", flush=True)

        def on_fit_epoch_end(trainer):
            try:
                current = getattr(trainer, "epoch", 0) + 1
                total = getattr(trainer, "epochs", epochs)
                progress = int(5 + 90 * current / total)
                _update_progress(current, progress)

                metrics_dict = {"epoch": current, "progress": progress}
                tloss = getattr(trainer, "tloss", None)
                if tloss is not None:
                    try:
                        v = float(tloss.mean() if hasattr(tloss, "mean") else float(tloss))
                        metrics_dict["loss"] = round(v, 4)
                    except (TypeError, ValueError):
                        pass
                m = getattr(trainer, "metrics", None)
                if m is not None and isinstance(m, dict):
                    for key in ("metrics/mAP50(B)", "metrics/mAP50(S)", "map50"):
                        if key in m and m[key] is not None:
                            try:
                                metrics_dict["map50"] = round(float(m[key]), 4)
                                break
                            except (TypeError, ValueError):
                                pass
                    for key in ("metrics/mAP50-95(B)", "metrics/mAP50-95(S)", "map50-95"):
                        if key in m and m[key] is not None:
                            try:
                                metrics_dict["map50_95"] = round(float(m[key]), 4)
                                break
                            except (TypeError, ValueError):
                                pass
                lr_dict = getattr(trainer, "lr", None) or {}
                if lr_dict:
                    lr_vals = [v for v in lr_dict.values() if v is not None]
                    if lr_vals:
                        try:
                            metrics_dict["lr"] = round(float(lr_vals[0]), 6)
                        except (TypeError, ValueError):
                            pass
                _save_metrics_to_redis(metrics_dict)
            except Exception as e:
                print(f"[training] 回调异常: {e}", flush=True)

        _last_batch_progress = [0]

        def on_train_batch_end(trainer):
            try:
                epoch = getattr(trainer, "epoch", 0)
                batch_i = getattr(trainer, "batch_i", 0)
                nb = max(getattr(trainer, "nb", 1), 1)
                if batch_i % 50 == 0 or batch_i >= nb - 1:
                    batch_progress = (epoch * nb + batch_i + 1) / (epochs * nb) if epochs * nb > 0 else 0
                    progress = int(5 + 90 * batch_progress)
                    if progress > _last_batch_progress[0]:
                        _last_batch_progress[0] = progress
                        _update_progress(epoch + 1, progress)
            except Exception:
                pass

        model.add_callback("on_fit_epoch_end", on_fit_epoch_end)
        model.add_callback("on_train_batch_end", on_train_batch_end)

        model.train(
            data=data_yaml_path,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            workers=workers,
            project=output_project,
            name="train",
            exist_ok=True,
            verbose=True,
            device=device,
            amp=False,  # 禁用 AMP 检查，避免无网络时下载 yolo26n.pt 失败导致训练卡住
            patience=50,  # 连续 50 个 epoch 验证指标无提升则提前结束
        )
        return 0
    except Exception as e:
        print(f"[training] 子进程训练失败: {e}", flush=True)
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    # 命令行入口，供 multiprocessing 的 target 使用
    # 参数通过 sys.argv 或 环境变量传递，此处使用简单方式
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--data-yaml", required=True)
    parser.add_argument("--output-project", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=-1)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()

    sys.exit(
        run_training(
            task_id=args.task_id,
            data_yaml_path=args.data_yaml,
            output_project=args.output_project,
            base_model=args.base_model,
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            workers=args.workers,
            device=args.device,
        )
    )
