"""兼容旧初始化入口，复用安全的管理员创建逻辑。"""
from init_db import init_db, create_admin


def init_db_simple():
    init_db()
    create_admin()


if __name__ == "__main__":
    init_db_simple()
