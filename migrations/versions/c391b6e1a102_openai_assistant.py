"""Durable, private OpenAI analysis requests."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c391b6e1a102"
down_revision = "91f823ab4100"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("jobs_kind_check", "jobs", type_="check")
    op.create_check_constraint("jobs_kind_check", "jobs", "kind IN ('import','plan','assistant')")
    op.create_table(
        "assistant_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("credentials.id"), nullable=False),
        sa.Column("plan_id", sa.Uuid(), sa.ForeignKey("plans.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("request", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.CheckConstraint("status IN ('queued','running','ready','failed')"),
    )
    op.create_index("ix_assistant_runs_actor_created", "assistant_runs", ["actor_id", "created_at"])


def downgrade():
    # Refuse a lossy downgrade while durable AI jobs exist.
    if op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM jobs WHERE kind='assistant')")).scalar():
        raise RuntimeError("Archive assistant jobs before downgrading this migration")
    op.drop_table("assistant_runs")
    op.drop_constraint("jobs_kind_check", "jobs", type_="check")
    op.create_check_constraint("jobs_kind_check", "jobs", "kind IN ('import','plan')")
