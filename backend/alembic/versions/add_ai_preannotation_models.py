"""add ai preannotation models

Revision ID: add_ai_preannotation
Revises: 
Create Date: 2026-01-30 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_ai_preannotation'
down_revision = None  # 根据实际情况修改
branch_labels = None
depends_on = None


def upgrade():
    # 创建models表
    op.create_table(
        'models',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('filepath', sa.String(length=500), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('model_type', sa.String(length=50), nullable=True, server_default='yolo11'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('class_names', sa.Text(), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_models_id'), 'models', ['id'], unique=False)
    op.create_index(op.f('ix_models_name'), 'models', ['name'], unique=False)

    # 创建pre_annotation_tasks表
    op.create_table(
        'pre_annotation_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True, server_default='pending'),
        sa.Column('progress', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('total_images', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('processed_images', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('selected_classes', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['model_id'], ['models.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id')
    )
    op.create_index(op.f('ix_pre_annotation_tasks_id'), 'pre_annotation_tasks', ['id'], unique=False)
    op.create_index(op.f('ix_pre_annotation_tasks_task_id'), 'pre_annotation_tasks', ['task_id'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_pre_annotation_tasks_task_id'), table_name='pre_annotation_tasks')
    op.drop_index(op.f('ix_pre_annotation_tasks_id'), table_name='pre_annotation_tasks')
    op.drop_table('pre_annotation_tasks')
    op.drop_index(op.f('ix_models_name'), table_name='models')
    op.drop_index(op.f('ix_models_id'), table_name='models')
    op.drop_table('models')
