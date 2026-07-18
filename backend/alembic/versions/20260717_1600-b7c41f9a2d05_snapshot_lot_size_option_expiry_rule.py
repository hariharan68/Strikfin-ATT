"""snapshot lot_size freeze + instrument option_expiry_rule

Two instrument-master hardening columns:

• option_chain_snapshots.lot_size — the SEBI lot size IN EFFECT when the
  snapshot was captured. Freezing it keeps historical lot-scaled reads (GEX
  notional, "Show Lot") correct after a lot change; NULL rows (pre-column)
  fall back to the master on read (options_lab_service._lot_of), mirroring
  the future_price pattern.

• instruments.option_expiry_rule — OPTION expiry cadence, distinct from the
  monthly futures `expiry_rule`: WEEKLY_TUE (NIFTY/SENSEX) vs
  MONTHLY_LAST_THU (BANKNIFTY). Values are seeded by the startup upsert
  (app/instruments/seed.py), not by this migration.

Revision ID: b7c41f9a2d05
Revises: 20afea002e7e
Create Date: 2026-07-17 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b7c41f9a2d05'
down_revision: Union[str, None] = '20afea002e7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'option_chain_snapshots',
        sa.Column('lot_size', sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        'ck_ocs_lot_size',
        'option_chain_snapshots',
        'lot_size IS NULL OR lot_size > 0',
    )
    op.add_column(
        'instruments',
        sa.Column('option_expiry_rule', sa.String(length=40), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('instruments', 'option_expiry_rule')
    op.drop_constraint('ck_ocs_lot_size', 'option_chain_snapshots', type_='check')
    op.drop_column('option_chain_snapshots', 'lot_size')
