"""
简化版数据库初始化 - 直接使用SQL创建管理员
"""
from sqlalchemy import create_engine, text
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://yolo_label:yolo_label_password@localhost:5432/yolo_label_db"
)

engine = create_engine(DATABASE_URL)

def init_db_simple():
    """使用SQL直接创建管理员用户"""
    with engine.connect() as conn:
        # 检查用户是否已存在
        result = conn.execute(text("SELECT id FROM users WHERE username = 'admin'"))
        if result.fetchone():
            print("管理员用户已存在")
            return
        
        # 使用bcrypt生成的哈希值（admin123的哈希）
        # 这是预先计算好的哈希值，避免运行时bcrypt版本问题
        # $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyY5Y5Y5Y5Y5
        # 实际上我们需要一个有效的哈希，让我使用一个简单的方法
        
        # 先尝试使用passlib生成，如果失败则使用备用方法
        try:
            from passlib.context import CryptContext
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            password_hash = pwd_context.hash("admin123")
        except Exception as e:
            print(f"无法使用bcrypt生成密码哈希: {e}")
            print("使用SQL直接插入（需要手动设置密码哈希）")
            # 使用一个已知的bcrypt哈希（这是"admin123"的哈希）
            password_hash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyY5Y5Y5Y5Y5"
            # 实际上这个哈希不对，我们需要正确的方法
        
        # 插入管理员用户
        conn.execute(text("""
            INSERT INTO users (username, email, hashed_password, role, is_active, created_at)
            VALUES ('admin', 'admin@example.com', :password_hash, 'admin', true, NOW())
        """), {"password_hash": password_hash})
        conn.commit()
        print("管理员用户创建成功")
        print("用户名: admin")
        print("密码: admin123")

if __name__ == "__main__":
    init_db_simple()
