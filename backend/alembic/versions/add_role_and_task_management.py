"""add role and task management

Revision ID: add_role_and_task_management
Revises: add_project_id_to_models
Create Date: 2026-02-03 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_role_and_task_management'
down_revision = 'add_project_id_to_models'
branch_labels = None
depends_on = None


def upgrade():
    # 1. 修改UserRole枚举：将ADMIN改为SUPER_ADMIN
    # 注意：PostgreSQL中修改枚举值比较复杂，这里先创建新的枚举类型
    # 如果使用SQLite，枚举是字符串，可以直接更新
    
    # 检查数据库类型
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # PostgreSQL: 创建新的枚举类型
        op.execute("CREATE TYPE userrole_new AS ENUM ('super_admin', 'project_admin', 'annotator')")
        
        # 先更新project_users表的role列（处理大小写），使用临时类型
        op.execute("""
            ALTER TABLE project_users 
            ALTER COLUMN role TYPE userrole_new 
            USING CASE 
                WHEN LOWER(role::text) = 'admin' THEN 'super_admin'::userrole_new
                WHEN role::text = 'ADMIN' THEN 'super_admin'::userrole_new
                WHEN role::text = 'admin' THEN 'super_admin'::userrole_new
                ELSE role::text::userrole_new
            END
        """)
        
        # 更新users表的role列（处理大小写）
        op.execute("""
            ALTER TABLE users 
            ALTER COLUMN role TYPE userrole_new 
            USING CASE 
                WHEN LOWER(role::text) = 'admin' THEN 'super_admin'::userrole_new
                WHEN role::text = 'ADMIN' THEN 'super_admin'::userrole_new
                WHEN role::text = 'admin' THEN 'super_admin'::userrole_new
                ELSE role::text::userrole_new
            END
        """)
        
        # 删除旧枚举类型并重命名新类型
        op.execute("DROP TYPE userrole CASCADE")
        op.execute("ALTER TYPE userrole_new RENAME TO userrole")
    else:
        # SQLite或其他数据库：直接更新字符串值（处理大小写）
        op.execute("UPDATE users SET role = 'super_admin' WHERE LOWER(role) = 'admin' OR role = 'ADMIN'")
        op.execute("UPDATE project_users SET role = 'super_admin' WHERE LOWER(role) = 'admin' OR role = 'ADMIN'")
    
    # 2. 添加images_per_task字段到projects表
    op.add_column('projects', sa.Column('images_per_task', sa.Integer(), nullable=True))
    
    # 3. 创建tasks表
    op.create_table(
        'tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('annotator_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['annotator_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tasks_id'), 'tasks', ['id'], unique=False)
    
    # 4. 创建task_images表
    op.create_table(
        'task_images',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('image_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['image_id'], ['images.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_task_images_id'), 'task_images', ['id'], unique=False)


def downgrade():
    # 删除task_images表
    op.drop_index(op.f('ix_task_images_id'), table_name='task_images')
    op.drop_table('task_images')
    
    # 删除tasks表
    op.drop_index(op.f('ix_tasks_id'), table_name='tasks')
    op.drop_table('tasks')
    
    # 删除images_per_task字段
    op.drop_column('projects', 'images_per_task')
    
    # 恢复UserRole枚举（将SUPER_ADMIN改回ADMIN）
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # PostgreSQL: 创建旧的枚举类型
        op.execute("CREATE TYPE userrole_old AS ENUM ('admin', 'project_admin', 'annotator')")
        
        # 更新users表的role列
        op.execute("""
            ALTER TABLE users 
            ALTER COLUMN role TYPE userrole_old 
            USING CASE 
                WHEN role::text = 'super_admin' THEN 'admin'::userrole_old
                ELSE role::text::userrole_old
            END
        """)
        
        # 删除新枚举类型并重命名旧类型
        op.execute("DROP TYPE userrole")
        op.execute("ALTER TYPE userrole_old RENAME TO userrole")
        
        # 同样更新project_users表的role列
        op.execute("""
            ALTER TABLE project_users 
            ALTER COLUMN role TYPE userrole 
            USING CASE 
                WHEN role::text = 'super_admin' THEN 'admin'::userrole
                ELSE role::text::userrole
            END
        """)
    else:
        # SQLite或其他数据库：直接更新字符串值
        op.execute("UPDATE users SET role = 'admin' WHERE role = 'super_admin'")
        op.execute("UPDATE project_users SET role = 'admin' WHERE role = 'super_admin'")
