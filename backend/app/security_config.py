"""认证启动配置；仅依赖标准库，RKNN worker 也可安全导入。"""
import os
import secrets
from typing import Mapping, Optional, Tuple

DEVELOPMENT_SECRET = "change-this-secret-key-in-production"
_PLACEHOLDER_KEYS = {
    DEVELOPMENT_SECRET, "your-secret-key", "your-secret-key-here",
    "your-secret-key-change-in-production", "change-me", "changeme", "secret",
}


def is_development(environ: Optional[Mapping[str, str]] = None) -> bool:
    env = os.environ if environ is None else environ
    mode = env.get("YOLO_LABEL_ENV", "production").strip().lower()
    if mode not in {"production", "development", "test"}:
        raise RuntimeError("YOLO_LABEL_ENV 必须是 production、development 或 test")
    return mode in {"development", "test"}


def get_secret_key(environ: Optional[Mapping[str, str]] = None) -> str:
    env = os.environ if environ is None else environ
    development = is_development(env)
    key = env.get("SECRET_KEY", "")
    if development:
        return key or DEVELOPMENT_SECRET
    if len(key.strip()) < 32 or key.strip().lower() in _PLACEHOLDER_KEYS:
        # 不在错误中包含用户提供的密钥。
        raise RuntimeError("生产环境 SECRET_KEY 必须设置为至少 32 字符的独立随机密钥，不能使用示例值")
    return key


def get_initial_admin_password(
    environ: Optional[Mapping[str, str]] = None,
) -> Tuple[str, bool]:
    """只应在确认管理员尚不存在后调用；返回密码和是否随机生成。"""
    env = os.environ if environ is None else environ
    development = is_development(env)
    password = env.get("ADMIN_PASSWORD", "")
    if password:
        if not development and password.lower() in {"admin123", "admin", "password", "changeme"}:
            raise RuntimeError("生产环境 ADMIN_PASSWORD 不能使用已知默认密码")
        return password, False
    if development:
        return "admin123", False
    return secrets.token_urlsafe(24), True


if __name__ == "__main__":
    get_secret_key()
