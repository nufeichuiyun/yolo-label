"""add token version to users

Revision ID: add_user_token_version
Revises: add_rknn_conversion_fields
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa


revision = 'add_user_token_version'
down_revision = 'add_rknn_conversion_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column('token_version', sa.Integer(), nullable=False, server_default='0')
    )


def downgrade():
    op.drop_column('users', 'token_version')
