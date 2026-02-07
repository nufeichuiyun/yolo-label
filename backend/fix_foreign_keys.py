"""
修复数据库外键约束，添加CASCADE删除
"""
from sqlalchemy import text
from app.database import engine

def fix_foreign_keys():
    """修复外键约束，添加CASCADE删除"""
    with engine.connect() as conn:
        # 开始事务
        trans = conn.begin()
        try:
            # 删除旧的外键约束
            print("删除旧的外键约束...")
            conn.execute(text("""
                ALTER TABLE categories 
                DROP CONSTRAINT IF EXISTS categories_project_id_fkey;
            """))
            
            conn.execute(text("""
                ALTER TABLE images 
                DROP CONSTRAINT IF EXISTS images_project_id_fkey;
            """))
            
            conn.execute(text("""
                ALTER TABLE project_users 
                DROP CONSTRAINT IF EXISTS project_users_project_id_fkey;
            """))
            
            # 添加新的外键约束（带CASCADE）
            print("添加新的外键约束（CASCADE）...")
            conn.execute(text("""
                ALTER TABLE categories 
                ADD CONSTRAINT categories_project_id_fkey 
                FOREIGN KEY (project_id) 
                REFERENCES projects(id) 
                ON DELETE CASCADE;
            """))
            
            conn.execute(text("""
                ALTER TABLE images 
                ADD CONSTRAINT images_project_id_fkey 
                FOREIGN KEY (project_id) 
                REFERENCES projects(id) 
                ON DELETE CASCADE;
            """))
            
            conn.execute(text("""
                ALTER TABLE project_users 
                ADD CONSTRAINT project_users_project_id_fkey 
                FOREIGN KEY (project_id) 
                REFERENCES projects(id) 
                ON DELETE CASCADE;
            """))
            
            # 提交事务
            trans.commit()
            print("✅ 外键约束修复成功！")
        except Exception as e:
            trans.rollback()
            print(f"❌ 修复失败: {e}")
            raise

if __name__ == "__main__":
    fix_foreign_keys()
