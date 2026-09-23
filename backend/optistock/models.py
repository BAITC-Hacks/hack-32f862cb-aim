import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Entity:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Credential(Entity, Base):
    __tablename__ = "credentials"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(default=True)
    __table_args__ = (CheckConstraint("role IN ('viewer','planner','approver','admin')"),)


class Dataset(Entity, Base):
    __tablename__ = "datasets"
    signature: Mapped[str] = mapped_column(String(64), unique=True)
    as_of: Mapped[date]
    status: Mapped[str] = mapped_column(String(20), default="queued")
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)


class SourceFile(Entity, Base):
    __tablename__ = "source_files"
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"), index=True)
    name: Mapped[str] = mapped_column(String(250))
    supplier: Mapped[str] = mapped_column(String(20))
    sha256: Mapped[str] = mapped_column(String(64))
    # Content-addressed immutable files; user names never become disk paths.
    kind: Mapped[str] = mapped_column(String(30), default="pending")


class Item(Entity, Base):
    __tablename__ = "items"
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"))
    supplier: Mapped[str] = mapped_column(String(20))
    code: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(30), default="шт")
    category: Mapped[str | None] = mapped_column(String(80))
    minimum: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    multiple: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    available: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    # Immutable, versioned, source-referenced time series belonging to this SKU snapshot.
    data: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (
        UniqueConstraint("dataset_id", "supplier", "code"),
        Index("ix_items_catalog", "dataset_id", "supplier", "category"),
        CheckConstraint("minimum IS NULL OR minimum > 0"),
        CheckConstraint("multiple IS NULL OR multiple > 0"),
    )


class SupplierState(Base):
    __tablename__ = "supplier_states"
    supplier: Mapped[str] = mapped_column(String(20), primary_key=True)
    revision: Mapped[int] = mapped_column(default=0)


class Plan(Entity, Base):
    __tablename__ = "plans"
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"), index=True)
    parameters: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    supply_versions: Mapped[dict] = mapped_column(JSONB, default=dict)
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    algorithm_version: Mapped[str] = mapped_column(String(40), default="robust-seasonal-v1")


class Recommendation(Entity, Base):
    __tablename__ = "recommendations"
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id"))
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    risk: Mapped[str] = mapped_column(String(20))
    arrival_date: Mapped[date]
    explanation: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (
        UniqueConstraint("plan_id", "item_id"),
        CheckConstraint("quantity >= 0"),
        Index("ix_recommendations_plan_risk", "plan_id", "risk"),
    )


class AgentRun(Entity, Base):
    __tablename__ = "agent_runs"
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id"), unique=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("credentials.id"))
    report: Mapped[dict] = mapped_column(JSONB, default=dict)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Entity, Base):
    __tablename__ = "jobs"
    kind: Mapped[str] = mapped_column(String(20))
    resource_id: Mapped[uuid.UUID]
    status: Mapped[str] = mapped_column(String(20), default="queued")
    attempts: Mapped[int] = mapped_column(default=0)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token: Mapped[uuid.UUID | None]
    progress: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[dict | None] = mapped_column(JSONB)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','succeeded','failed')"),
        CheckConstraint("kind IN ('import','plan')"),
        Index("ix_jobs_poll", "status", "lease_until", "created_at"),
    )


class PurchaseOrder(Entity, Base):
    __tablename__ = "purchase_orders"
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id"))
    supplier: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    revision: Mapped[int] = mapped_column(default=1)
    arrival_date: Mapped[date]
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("credentials.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credentials.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("plan_id", "supplier"),
        CheckConstraint("status IN ('draft','approved','cancelled')"),
    )


class OrderLine(Entity, Base):
    __tablename__ = "order_lines"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"))
    recommended_quantity: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    reason: Mapped[str | None] = mapped_column(String(1000))
    __table_args__ = (UniqueConstraint("order_id", "item_id"), CheckConstraint("quantity >= 0"))


class Idempotency(Base):
    __tablename__ = "idempotency"
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("credentials.id"), primary_key=True)
    operation: Mapped[str] = mapped_column(String(120), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEvent(Entity, Base):
    __tablename__ = "audit_events"
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credentials.id"))
    action: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
