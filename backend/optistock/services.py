import hashlib
import json
import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import defer

from optistock.config import settings
from optistock.db import session
from optistock.errors import DomainError, LeaseLost
from optistock.ingestion import parse_sources, store_file
from optistock.models import (
    AgentRun,
    AuditEvent,
    Credential,
    Dataset,
    Idempotency,
    Item,
    Job,
    OrderLine,
    Plan,
    PurchaseOrder,
    Recommendation,
    SourceFile,
    SupplierState,
    utcnow,
)
from optistock.planning import calculate
from optistock.schemas import Scenario


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def lock(db, scope):
    key = int.from_bytes(hashlib.sha256(scope.encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def mutate(db, actor, operation, key, payload, action):
    if not key or not 1 <= len(key) <= 128:
        raise DomainError("invalid_idempotency_key", "Нужен Idempotency-Key длиной 1–128 символов", 422)
    with db.begin():
        lock(db, f"{actor.id}:{operation}:{key}")
        existing = db.get(Idempotency, (actor.id, operation, key))
        fingerprint = digest(payload)
        if existing:
            if existing.payload_hash != fingerprint:
                raise DomainError("idempotency_conflict", "Этот ключ уже использован с другим запросом", 409)
            return existing.result
        result = action()
        db.add(
            Idempotency(
                actor_id=actor.id, operation=operation, key=key, payload_hash=fingerprint, result=result
            )
        )
        return result


def require(db, model, identifier, locked=False):
    statement = select(model).where(model.id == identifier)
    if locked:
        statement = statement.with_for_update()
    value = db.scalar(statement)
    if value is None:
        raise DomainError("not_found", "Объект не найден", 404)
    return value


def audit(db, actor, action, entity, details=None):
    db.add(
        AuditEvent(
            actor_id=actor.id if actor else None, action=action, entity_id=entity, details=details or {}
        )
    )


def sample_sources():
    result = []
    for supplier, directory in (("iek", "IEK"), ("systeme", "Systeme electric")):
        paths = sorted((settings().sample_root / directory).glob("*.xlsx"))
        if len(paths) != 6:
            raise DomainError("sample_files_missing", f"Ожидаются 6 тестовых XLSX в {directory}", 409)
        for path in paths:
            with path.open("rb") as stream:
                key = store_file(stream)
            result.append({"supplier": supplier, "name": path.name, "sha256": key})
    return result


def enqueue_import(db, actor, sources, as_of):
    signature = digest(
        {"sources": sorted(sources, key=lambda s: (s["supplier"], s["name"])), "as_of": as_of, "parser": "v1"}
    )
    lock(db, f"dataset:{signature}")
    dataset = db.scalar(select(Dataset).where(Dataset.signature == signature))
    if dataset:
        job = db.scalar(select(Job).where(Job.resource_id == dataset.id, Job.kind == "import"))
        return {"dataset_id": str(dataset.id), "job_id": str(job.id), "reused": True}
    dataset = Dataset(signature=signature, as_of=as_of)
    db.add(dataset)
    db.flush()
    for source in sources:
        db.add(SourceFile(dataset_id=dataset.id, **source))
    job = Job(kind="import", resource_id=dataset.id)
    db.add(job)
    db.flush()
    audit(db, actor, "dataset.import", dataset.id, {"file_count": len(sources)})
    return {"dataset_id": str(dataset.id), "job_id": str(job.id), "reused": False}


def enqueue_plan(db, actor, payload):
    dataset = require(db, Dataset, payload.dataset_id)
    if dataset.status != "ready":
        raise DomainError("dataset_not_ready", "Дождитесь успешного импорта", 409)
    plan = Plan(dataset_id=dataset.id, parameters=payload.scenario.model_dump(mode="json"))
    db.add(plan)
    db.flush()
    job = Job(kind="plan", resource_id=plan.id)
    db.add(job)
    db.flush()
    audit(db, actor, "plan.create", plan.id)
    return {"plan_id": str(plan.id), "job_id": str(job.id)}


def enqueue_agent(db, actor, payload):
    # Serialise identical active work across tabs and retries with different HTTP keys.
    fingerprint = digest(payload.model_dump(mode="json"))
    lock(db, f"agent:{actor.id}:{fingerprint}")
    active = db.execute(
        select(AgentRun, Plan, Job)
        .join(Plan, AgentRun.plan_id == Plan.id)
        .join(Job, (Job.resource_id == Plan.id) & (Job.kind == "plan"))
        .where(
            AgentRun.created_by == actor.id,
            Plan.dataset_id == payload.dataset_id,
            Plan.parameters == payload.scenario.model_dump(mode="json"),
            Job.status.in_(["queued", "running"]),
        )
    ).first()
    if active:
        run, plan, job = active
        return {"run_id": str(run.id), "plan_id": str(plan.id), "job_id": str(job.id), "reused": True}
    result = enqueue_plan(db, actor, payload)
    run = AgentRun(plan_id=uuid.UUID(result["plan_id"]), created_by=actor.id)
    db.add(run)
    db.flush()
    audit(db, actor, "agent.start", run.id, result)
    return {**result, "run_id": str(run.id), "reused": False}


def check_lease(db, identifier, token):
    job = require(db, Job, identifier, locked=True)
    if job.status != "running" or job.token != token or job.lease_until <= utcnow():
        raise LeaseLost()
    return job


def progress_job(identifier, token, **progress):
    with session() as db, db.begin():
        job = check_lease(db, identifier, token)
        job.progress = progress


def execute_job(identifier, token):
    with session() as db:
        job = require(db, Job, identifier)
        kind, resource_id = job.kind, job.resource_id
        if kind == "import":
            dataset = require(db, Dataset, resource_id)
            as_of = dataset.as_of
            files = db.scalars(
                select(SourceFile)
                .where(SourceFile.dataset_id == resource_id)
                .order_by(SourceFile.supplier, SourceFile.name)
            ).all()
            sources = [
                {"id": str(f.id), "name": f.name, "supplier": f.supplier, "sha256": f.sha256} for f in files
            ]
    if kind == "assistant":
        from optistock.assistant import execute_assistant

        return execute_assistant(identifier, token, resource_id)
    if kind == "import":
        parsed, kinds = parse_sources(sources, as_of, lambda **p: progress_job(identifier, token, **p))
        with session() as db, db.begin():
            job = check_lease(db, identifier, token)
            for offset in range(0, len(parsed), 100):
                db.add_all(
                    [
                        Item(
                            dataset_id=resource_id,
                            supplier=p.supplier,
                            code=p.code,
                            name=p.name,
                            unit=p.unit,
                            category=p.category,
                            minimum=p.minimum,
                            multiple=p.multiple,
                            available=p.available,
                            data=p.data,
                        )
                        for p in parsed[offset : offset + 100]
                    ]
                )
                db.flush()
            for row in kinds:
                db.get(SourceFile, uuid.UUID(row["id"])).kind = row["kind"]
            dataset = require(db, Dataset, resource_id)
            dataset.status = "ready"
            dataset.summary = {
                "items": len(parsed),
                "transaction_rows": sum(len(p.data["events"]) for p in parsed),
                "by_supplier": {
                    s: sum(p.supplier == s for p in parsed) for s in {p.supplier for p in parsed}
                },
                "files": len(sources),
                "test_data": True,
                "limitations": [
                    "Нет клиентского ID",
                    "Stockout оценивается по месячным снимкам",
                    "Часть запасов и условий заказа задаётся сценарием",
                ],
            }
            job.status, job.finished_at, job.progress = (
                "succeeded",
                utcnow(),
                {"stage": "done", "items": len(parsed)},
            )
    else:
        compute_plan(identifier, token, resource_id)


def compute_plan(identifier, token, plan_id):
    from optistock.agent import inspect_data, review_plan

    # Same lock order as approval. A consistent snapshot of approved commitments and revisions.
    with session() as db, db.begin():
        plan = require(db, Plan, plan_id)
        agent_run = db.scalar(select(AgentRun).where(AgentRun.plan_id == plan_id))
        dataset = require(db, Dataset, plan.dataset_id)
        scenario = Scenario.model_validate(plan.parameters)
        states = db.scalars(
            select(SupplierState).order_by(SupplierState.supplier).with_for_update(read=True)
        ).all()
        versions = {s.supplier: s.revision for s in states}
        commitments = defaultdict(list)
        rows = db.execute(
            select(OrderLine, PurchaseOrder, Item)
            .options(defer(Item.data))
            .join(PurchaseOrder, OrderLine.order_id == PurchaseOrder.id)
            .join(Item, OrderLine.item_id == Item.id)
            .where(PurchaseOrder.status == "approved")
        ).all()
        for line, order, item in rows:
            commitments[(item.supplier, item.code)].append(
                {"order_id": str(order.id), "eta": order.arrival_date.isoformat(), "q": str(line.quantity)}
            )
        statement = select(Item).where(Item.dataset_id == dataset.id).order_by(Item.id)
        if scenario.supplier:
            statement = statement.where(Item.supplier == scenario.supplier)
        if scenario.category is not None:
            statement = statement.where(Item.category == scenario.category)
        items = db.scalars(statement).all()
        as_of = dataset.as_of
    if not items:
        raise DomainError("empty_selection", "В выбранном наборе/категории нет товаров")
    quality = None
    if agent_run:
        progress_job(identifier, token, stage="validating", total=len(items))
        quality = inspect_data(items, as_of)
    results = []
    for i, item in enumerate(items):
        q, risk, arrival, explanation = calculate(
            item, as_of, scenario, commitments[(item.supplier, item.code)]
        )
        results.append(
            Recommendation(
                id=uuid.uuid4(),
                plan_id=plan_id,
                item_id=item.id,
                quantity=q,
                risk=risk,
                arrival_date=arrival,
                explanation=explanation,
            )
        )
        if i % 200 == 0:
            progress_job(identifier, token, stage="calculating", processed=i, total=len(items))
    report = None
    if agent_run:
        progress_job(identifier, token, stage="reviewing", processed=len(items), total=len(items))
        report = review_plan(items, results, as_of, scenario, commitments, quality)
    with session() as db, db.begin():
        job = check_lease(db, identifier, token)
        db.add_all(results)
        plan = require(db, Plan, plan_id)
        plan.status, plan.supply_versions = "ready", versions
        plan.summary = {
            "items": len(results),
            "reorder_items": sum(r.quantity > 0 for r in results),
            "critical_items": sum(r.risk == "critical" for r in results),
            "unforecastable_items": sum(r.risk == "insufficient_data" for r in results),
            "test_data": True,
        }
        if agent_run:
            actor = require(db, Credential, agent_run.created_by)
            if not actor.active or actor.role not in {"admin", "planner"}:
                raise DomainError("agent_permission_revoked", "Права запускающего пользователя изменены", 403)
            db.flush()
            orders = draft_orders(db, actor, plan_id)
            current_run = require(db, AgentRun, agent_run.id)
            current_run.report = {**report, **orders}
            current_run.finished_at = utcnow()
            audit(db, actor, "agent.complete", current_run.id, {"plan_id": str(plan_id), **orders})
        job.status, job.finished_at, job.progress = (
            "succeeded",
            utcnow(),
            {"stage": "done", "processed": len(results)},
        )


def draft_orders(db, actor, plan_id):
    plan = require(db, Plan, plan_id, locked=True)
    if plan.status != "ready":
        raise DomainError("plan_not_ready", "Расчёт ещё не готов", 409)
    existing = db.scalars(select(PurchaseOrder).where(PurchaseOrder.plan_id == plan_id)).all()
    if existing:
        return {"order_ids": [str(o.id) for o in existing]}
    rows = db.execute(
        select(Recommendation, Item)
        .options(defer(Item.data))
        .join(Item, Recommendation.item_id == Item.id)
        .where(Recommendation.plan_id == plan_id, Recommendation.quantity > 0)
    ).all()
    grouped = defaultdict(list)
    for recommendation, item in rows:
        grouped[item.supplier].append((recommendation, item))
    orders = []
    for supplier, group in sorted(grouped.items()):
        order = PurchaseOrder(
            plan_id=plan.id, supplier=supplier, arrival_date=group[0][0].arrival_date, created_by=actor.id
        )
        db.add(order)
        db.flush()
        db.add_all(
            [
                OrderLine(
                    order_id=order.id, item_id=i.id, recommended_quantity=r.quantity, quantity=r.quantity
                )
                for r, i in group
            ]
        )
        audit(db, actor, "order.draft", order.id, {"plan_id": str(plan_id)})
        orders.append(str(order.id))
    return {"order_ids": orders}


def edit_order(db, actor, identifier, payload):
    order = require(db, PurchaseOrder, identifier, locked=True)
    if order.status != "draft" or order.revision != payload.revision:
        raise DomainError("revision_conflict", "Заказ изменён или уже утверждён", 409)
    if len({line.line_id for line in payload.lines}) != len(payload.lines):
        raise DomainError("duplicate_lines", "Повторяющиеся строки заказа", 422)
    changes = []
    for change in payload.lines:
        line = require(db, OrderLine, change.line_id)
        if line.order_id != order.id:
            raise DomainError("wrong_order_line", "Строка не принадлежит заказу", 422)
        recommendation = db.scalar(
            select(Recommendation).where(
                Recommendation.plan_id == order.plan_id, Recommendation.item_id == line.item_id
            )
        )
        rounding = recommendation.explanation["rounding"]
        minimum, multiple, conversion = (Decimal(rounding[k]) for k in ("minimum", "multiple", "conversion"))
        purchase = change.quantity / conversion
        if purchase > 0 and (purchase < minimum or purchase % multiple != 0):
            raise DomainError(
                "order_constraints", "Количество не соответствует MOQ/кратности/единице закупки", 422
            )
        changes.append(
            {
                "line_id": str(line.id),
                "before": str(line.quantity),
                "after": str(change.quantity),
                "reason": change.reason,
            }
        )
        line.quantity, line.reason = change.quantity, change.reason
    order.revision += 1
    audit(db, actor, "order.edit", order.id, {"revision": order.revision, "changes": changes})
    return {"order_id": str(order.id), "revision": order.revision, "status": order.status}


def action_order(db, actor, identifier, revision, action):
    order = require(db, PurchaseOrder, identifier, locked=True)
    if order.revision != revision:
        raise DomainError("revision_conflict", "Ревизия заказа устарела", 409)
    state = db.scalar(select(SupplierState).where(SupplierState.supplier == order.supplier).with_for_update())
    if action == "approve":
        if order.status != "draft":
            raise DomainError("invalid_order_state", "Утвердить можно только черновик", 409)
        plan = require(db, Plan, order.plan_id)
        if plan.supply_versions.get(order.supplier) != state.revision:
            raise DomainError(
                "stale_plan", "Обязательства поставщику изменились: выполните новый расчёт", 409
            )
        lines = db.scalars(select(OrderLine).where(OrderLine.order_id == order.id)).all()
        if not any(line.quantity > 0 for line in lines):
            raise DomainError("empty_order", "В заказе нет положительных количеств", 422)
        order.status, order.approved_by, order.approved_at = "approved", actor.id, utcnow()
        state.revision += 1
    elif action == "cancel":
        if order.status == "cancelled":
            raise DomainError("invalid_order_state", "Заказ уже отменён", 409)
        if order.status == "approved":
            state.revision += 1
        order.status = "cancelled"
    order.revision += 1
    audit(db, actor, f"order.{action}", order.id, {"revision": order.revision})
    return {"order_id": str(order.id), "status": order.status, "revision": order.revision}
