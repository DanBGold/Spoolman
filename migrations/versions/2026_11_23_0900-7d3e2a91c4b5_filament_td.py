"""filament transmission distance (TD).

Revision ID: 7d3e2a91c4b5
Revises: fe4970567bb3
Create Date: 2026-11-23 09:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7d3e2a91c4b5"
down_revision = "fe4970567bb3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable filament.td column; existing filaments simply have no TD."""
    op.add_column(
        "filament",
        sa.Column(
            "td",
            sa.Float(),
            nullable=True,
            comment="Transmission distance (HueForge TD), 0.0 = solid/opaque to 100.0 = transparent.",
        ),
    )


def downgrade() -> None:
    """Drop the filament.td column."""
    op.drop_column("filament", "td")
