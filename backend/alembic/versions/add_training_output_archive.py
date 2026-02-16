"""add output_archive_path to training_tasks

Revision ID: add_training_output_archive
Revises: add_training_tasks
Create Date: 2026-02-16

"""
from alembic import op
import sqlalchemy as sa

revision = 'add_training_output_archive'
down_revision = 'add_training_tasks'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('training_tasks', sa.Column('output_archive_path', sa.String(length=500), nullable=True))


def downgrade():
    op.drop_column('training_tasks', 'output_archive_path')
