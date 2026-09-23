"""Persistent procurement agent runs, using the existing fenced plan job."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "91f823ab4100"
down_revision = "0cdaac70ddf4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("plans.id"), nullable=False, unique=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("credentials.id"), nullable=False),
        sa.Column("report", postgresql.JSONB(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table("agent_runs")
