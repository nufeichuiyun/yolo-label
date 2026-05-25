"""add rknn conversion fields to training_tasks

Revision ID: add_rknn_conversion_fields
Revises: add_training_output_archive
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = 'add_rknn_conversion_fields'
down_revision = 'add_training_output_archive'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('training_tasks', sa.Column('convert_to_rknn', sa.Boolean(), nullable=True, server_default=sa.false()))
    op.add_column('training_tasks', sa.Column('rknn_status', sa.String(length=50), nullable=True))
    op.add_column('training_tasks', sa.Column('output_rknn_path', sa.String(length=500), nullable=True))
    op.add_column('training_tasks', sa.Column('rknn_error', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('training_tasks', 'rknn_error')
    op.drop_column('training_tasks', 'output_rknn_path')
    op.drop_column('training_tasks', 'rknn_status')
    op.drop_column('training_tasks', 'convert_to_rknn')
