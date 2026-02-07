"""
初始化数据库和创建默认管理员用户
"""
import os
from app.database import engine, SessionLocal
from app.models import Base, User, UserRole
import bcrypt

def init_db():
    """创建数据库表"""
    Base.metadata.create_all(bind=engine)
    print("数据库表创建成功")

def create_admin():
    """创建默认管理员用户（支持通过 ADMIN_PASSWORD 环境变量设置密码）"""
    db = SessionLocal()
    try:
        # 检查是否已存在管理员
        admin = db.query(User).filter(User.username == "admin").first()
        if admin:
            print("管理员用户已存在")
            return
        
        # 从环境变量读取密码，默认为 admin123
        password = os.environ.get("ADMIN_PASSWORD", "admin123")
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
        print("默认管理员用户创建成功")
        print(f"用户名: admin")
        print(f"密码: {'******' if password != 'admin123' else 'admin123'}")
    except Exception as e:
        print(f"创建管理员失败: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
    create_admin()
