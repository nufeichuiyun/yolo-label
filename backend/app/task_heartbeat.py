"""
任务心跳：运行中的任务定期向 Redis 写入短 TTL 心跳，供后端启动清扫判断任务是否"真的在跑"。

为什么需要它：worker 用 solo pool（单并发），训练/转换期间主进程被长任务完全阻塞，
此时 Celery 的 inspect/heartbeat 都不可靠（无法应答）。因此存活信号必须由"没被阻塞的
组件"主动写入——训练由独立子进程写，预标注在自身进度循环里写。后端重启时据此判断：
有心跳 = 真在跑（跳过），无心跳 = 上次异常残留的孤儿（清扫）。
"""
import logging
import os

HEARTBEAT_PREFIX = "task_alive:"
HEARTBEAT_TTL = 900  # 秒；运行中的任务须在此间隔内刷新心跳，否则视为已死


def _client():
    import redis

    return redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))


def mark_alive(key: str, ttl: int = HEARTBEAT_TTL) -> None:
    """运行中的任务定期调用，写入/续期短 TTL 心跳。失败静默，绝不影响任务本身。"""
    try:
        _client().setex(f"{HEARTBEAT_PREFIX}{key}", ttl, "1")
    except Exception:
        pass


def alive_keys(keys) -> set:
    """
    返回 keys 中仍存活（有心跳）的子集。
    Redis 不可达时返回空集合（按"无心跳"处理，与无任务在跑一致，交给清扫）。
    """
    keys = list(keys)
    if not keys:
        return set()
    try:
        c = _client()
        pipe = c.pipeline()
        for k in keys:
            pipe.exists(f"{HEARTBEAT_PREFIX}{k}")
        res = pipe.execute()
        return {k for k, exists in zip(keys, res) if exists}
    except Exception as e:
        logging.warning("查询任务心跳失败（按无心跳处理）: %s", e)
        return set()
