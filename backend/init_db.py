"""
初始化数据库和创建默认管理员用户
"""
import os
from pathlib import Path
from app.database import engine, SessionLocal
from app.models import Base, User, UserRole
import bcrypt
from app.security_config import get_initial_admin_password, get_secret_key

def init_db():
    """创建数据库表"""
    Base.metadata.create_all(bind=engine)
    print("数据库表创建成功")

def create_admin():
    """创建默认管理员用户（支持通过 ADMIN_PASSWORD 环境变量设置密码）"""
    db = SessionLocal()
    created_password_file = None
    committed = False
    try:
        # 检查是否已存在管理员
        admin = db.query(User).filter(User.username == "admin").first()
        if admin:
            print("管理员用户已存在")
            return
        
        get_secret_key()
        password, generated = get_initial_admin_password()
        if generated:
            # 不写容器日志，供主机管理员读取；不覆盖未领取的凭据。
            password_file = Path(__file__).resolve().parent / ".initial_admin_password"
            fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created_password_file = password_file
            with os.fdopen(fd, "w") as stream:
                stream.write(password + "\n")
        password_bytes = password.encode('utf-8')
        salt = bcrypt.gensalt(rounds=12)
        password_hash = bcrypt.hashpw(password_bytes, salt).decode('utf-8')
        
        # 创建默认超级管理员
        admin = User(
            username="admin",
            email="admin@example.com",
            hashed_password=password_hash,
            role=UserRole.SUPER_ADMIN,
            is_active=True
        )
        db.add(admin)
        db.commit()
        committed = True
        print("默认管理员用户创建成功")
        print(f"用户名: admin")
        if generated:
            print("随机初始密码已写入 /app/.initial_admin_password；请由主机管理员读取、妥善保存后删除该文件")
        else:
            print("密码: 使用 ADMIN_PASSWORD 配置（开发/测试未配置时为 admin123）")
    except Exception:
        db.rollback()
        if created_password_file is not None and not committed:
            created_password_file.unlink(missing_ok=True)
        print("创建管理员失败，请检查数据库及安全配置；未更改已有管理员")
        raise RuntimeError("管理员初始化失败") from None
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
    create_admin()
