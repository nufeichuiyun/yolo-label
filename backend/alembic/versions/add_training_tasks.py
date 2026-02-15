"""add training_tasks table

Revision ID: add_training_tasks
Revises: convert_enum_to_string
Create Date: 2026-02-15 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_training_tasks'
down_revision = 'convert_enum_to_string'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'training_tasks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('base_model', sa.String(length=100), nullable=False),
        sa.Column('task_id', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True, server_default='pending'),
        sa.Column('progress', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('epochs', sa.Integer(), nullable=True, server_default='100'),
        sa.Column('current_epoch', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('train_images', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('val_images', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('output_model_path', sa.String(length=500), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id')
    )
    op.create_index(op.f('ix_training_tasks_id'), 'training_tasks', ['id'], unique=False)
    op.create_index(op.f('ix_training_tasks_task_id'), 'training_tasks', ['task_id'], unique=True)
    op.create_index(op.f('ix_training_tasks_project_id'), 'training_tasks', ['project_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_training_tasks_project_id'), table_name='training_tasks')
    op.drop_index(op.f('ix_training_tasks_task_id'), table_name='training_tasks')
    op.drop_index(op.f('ix_training_tasks_id'), table_name='training_tasks')
    op.drop_table('training_tasks')
