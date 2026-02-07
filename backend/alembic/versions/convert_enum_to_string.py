"""convert enum to string

Revision ID: convert_enum_to_string
Revises: add_role_and_task_management
Create Date: 2026-02-03 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'convert_enum_to_string'
down_revision = 'add_role_and_task_management'
branch_labels = None
depends_on = None


def upgrade():
    # 检查数据库类型
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # PostgreSQL: 将枚举类型转换为字符串类型
        # 1. 先更新 project_users 表
        op.execute("""
            ALTER TABLE project_users 
            ALTER COLUMN role TYPE VARCHAR(50) 
            USING role::text
        """)
        
        # 2. 更新 users 表
        op.execute("""
            ALTER TABLE users 
            ALTER COLUMN role TYPE VARCHAR(50) 
            USING role::text
        """)
        
        # 3. 删除旧的枚举类型（如果不再被使用）
        # 注意：如果还有其他表使用这个枚举类型，需要先处理
        try:
            op.execute("DROP TYPE userrole")
        except Exception:
            pass  # 如果删除失败（可能还有其他依赖），忽略


def downgrade():
    # 恢复枚举类型
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # 重新创建枚举类型
        op.execute("CREATE TYPE userrole AS ENUM ('super_admin', 'project_admin', 'annotator')")
        
        # 转换回枚举类型
        op.execute("""
            ALTER TABLE users 
            ALTER COLUMN role TYPE userrole 
            USING role::userrole
        """)
        
        op.execute("""
            ALTER TABLE project_users 
            ALTER COLUMN role TYPE userrole 
            USING role::userrole
        """)
