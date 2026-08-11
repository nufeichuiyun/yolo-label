"""reconcile task schema created by legacy bootstrap paths

Revision ID: reconcile_task_schema
Revises: add_user_token_version
Create Date: 2026-08-11

Older installations sometimes used ``Base.metadata.create_all()`` and were then
stamped at Alembic head. Those databases are valid but can miss constraints that
the migration-built schema contains. This revision only adds missing structure;
it never drops task or project data.
"""
from alembic import op
import sqlalchemy as sa


revision = 'reconcile_task_schema'
down_revision = 'add_user_token_version'
branch_labels = None
depends_on = None


TASK_TABLES = (
    ('pre_annotation_tasks', 'legacy-preannotation-'),
    ('training_tasks', 'legacy-training-'),
)


def _has_unique_task_id(inspector, table_name):
    return any(
        constraint.get('column_names') == ['task_id']
        for constraint in inspector.get_unique_constraints(table_name)
    )


def upgrade():
    bind = op.get_bind()

    for table_name, legacy_prefix in TASK_TABLES:
        inspector = sa.inspect(bind)
        columns = {column['name']: column for column in inspector.get_columns(table_name)}
        if columns['task_id']['nullable']:
            table = sa.table(
                table_name,
                sa.column('id', sa.Integer()),
                sa.column('task_id', sa.String(length=255)),
            )
            op.execute(
                table.update()
                .where(table.c.task_id.is_(None))
                .values(task_id=sa.literal(legacy_prefix) + sa.cast(table.c.id, sa.String()))
            )
            op.alter_column(
                table_name,
                'task_id',
                existing_type=sa.String(length=255),
                nullable=False,
            )

        inspector = sa.inspect(bind)
        if not _has_unique_task_id(inspector, table_name):
            op.create_unique_constraint(f'uq_{table_name}_task_id', table_name, ['task_id'])

    inspector = sa.inspect(bind)
    training_indexes = {index['name'] for index in inspector.get_indexes('training_tasks')}
    if 'ix_training_tasks_project_id' not in training_indexes:
        op.create_index('ix_training_tasks_project_id', 'training_tasks', ['project_id'], unique=False)


def downgrade():
    # This is a compatibility repair for multiple historical bootstrap paths.
    # Avoid weakening or dropping structures that may predate this revision.
    pass
