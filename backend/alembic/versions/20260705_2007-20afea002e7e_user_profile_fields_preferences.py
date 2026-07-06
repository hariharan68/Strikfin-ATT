"""user profile fields + preferences

Adds profile columns (phone, state, auth_provider) to `users` and a
`user_preferences` table (1:1 with users) for Settings-page state:
theme, show_chart_tooltip, call_put_scheme.

NOTE: autogenerate also surfaced a lot of unrelated pre-existing ORM/DB drift
(server defaults, FK re-adds, a users.email unique/index mismatch). That noise
has been intentionally removed — this migration only applies the profile +
preferences changes.

Revision ID: 20afea002e7e
Revises: 359a6ec8421d
Create Date: 2026-07-05 20:07:37.613102
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.models  # for app.db.models.UTCDateTime()

# revision identifiers, used by Alembic.
revision: str = '20afea002e7e'
down_revision: Union[str, None] = '359a6ec8421d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New profile columns on users.
    op.add_column('users', sa.Column('phone', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('state', sa.String(length=64), nullable=True))
    op.add_column(
        'users',
        sa.Column('auth_provider', sa.String(length=20),
                  server_default=sa.text("'email'"), nullable=False),
    )

    # Per-user UI preferences (1:1 with users).
    op.create_table(
        'user_preferences',
        sa.Column('user_id', sa.BIGINT(), nullable=False),
        sa.Column('theme', sa.String(length=20), nullable=True),
        sa.Column('show_chart_tooltip', sa.Boolean(),
                  server_default=sa.text('true'), nullable=False),
        sa.Column('call_put_scheme', sa.String(length=16),
                  server_default=sa.text("'classic'"), nullable=False),
        sa.Column('created_at', app.db.models.UTCDateTime(), nullable=False),
        sa.Column('updated_at', app.db.models.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('user_preferences')
    op.drop_column('users', 'auth_provider')
    op.drop_column('users', 'state')
    op.drop_column('users', 'phone')
