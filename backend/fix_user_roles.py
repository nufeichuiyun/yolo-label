"""
修复用户角色：将 'admin' 更新为 'super_admin'
"""
from app.database import SessionLocal
from app.models import User, UserRole
from sqlalchemy import text

def fix_user_roles():
    """修复用户角色值"""
    db = SessionLocal()
    try:
        # 检查数据库类型
        bind = db.bind
        dialect_name = bind.dialect.name
        
        print(f"数据库类型: {dialect_name}")
        
        if dialect_name == 'postgresql':
            # PostgreSQL: 直接更新枚举值
            db.execute(text("""
                UPDATE users 
                SET role = 'super_admin'::userrole 
                WHERE role::text = 'admin'
            """))
            db.execute(text("""
                UPDATE project_users 
                SET role = 'super_admin'::userrole 
                WHERE role::text = 'admin'
            """))
        else:
            # SQLite或其他数据库：直接更新字符串值
            db.execute(text("UPDATE users SET role = 'super_admin' WHERE role = 'admin'"))
            db.execute(text("UPDATE project_users SET role = 'super_admin' WHERE role = 'admin'"))
        
        db.commit()
        
        # 验证更新
        admin_users = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).all()
        print(f"已更新用户角色，当前超级管理员数量: {len(admin_users)}")
        
        # 显示所有用户
        all_users = db.query(User).all()
        print("\n所有用户:")
        for user in all_users:
            print(f"  - {user.username}: {user.role}")
        
        print("\n角色修复完成！")
    except Exception as e:
        print(f"修复失败: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    fix_user_roles()
