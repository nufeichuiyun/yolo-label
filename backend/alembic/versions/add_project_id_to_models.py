"""add project_id to models

Revision ID: add_project_id_to_models
Revises: add_ai_preannotation
Create Date: 2026-01-30 23:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_project_id_to_models'
down_revision = 'add_ai_preannotation'
branch_labels = None
depends_on = None


def upgrade():
    # 添加project_id列到models表
    op.add_column('models', sa.Column('project_id', sa.Integer(), nullable=True))
    
    # 添加外键约束
    op.create_foreign_key(
        'fk_models_project_id',
        'models', 'projects',
        ['project_id'], ['id'],
        ondelete='CASCADE'
    )
    
    # 创建索引
    op.create_index(op.f('ix_models_project_id'), 'models', ['project_id'], unique=False)
    
    # 将project_id设为非空（需要先设置默认值）
    # 注意：如果已有数据，需要先为现有记录设置project_id
    # 这里假设暂时允许NULL，后续可以手动更新数据后再设为非空
    # op.alter_column('models', 'project_id', nullable=False)


def downgrade():
    # 删除索引
    op.drop_index(op.f('ix_models_project_id'), table_name='models')
    
    # 删除外键约束
    op.drop_constraint('fk_models_project_id', 'models', type_='foreignkey')
    
    # 删除列
    op.drop_column('models', 'project_id')
