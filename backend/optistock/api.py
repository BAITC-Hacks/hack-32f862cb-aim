import csv
import hashlib
import io
import logging
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Header, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, defer
from starlette.exceptions import HTTPException as StarletteHTTPException

from optistock import __version__
from optistock.config import settings
from optistock.db import get_db, session
from optistock.errors import DomainError
from optistock.ingestion import store_file
from optistock.middleware import BodyLimitMiddleware
from optistock.models import (
    AgentRun,
    AuditEvent,
    Credential,
    Dataset,
    Item,
    Job,
    OrderLine,
    Plan,
    PurchaseOrder,
    Recommendation,
    SourceFile,
)
from optistock.schemas import CreatePlan, DraftOrders, EditOrder, OrderAction, SampleImport
from optistock.services import (
    action_order,
    audit,
    draft_orders,
    edit_order,
    enqueue_agent,
    enqueue_import,
    enqueue_plan,
    mutate,
    require,
    sample_sources,
)

log = logging.getLogger("optistock.api")
app = FastAPI(
    title="OptiStock API",
    version=__version__,
    description="Планирование закупок на тестовых данных IEK / Systeme Electric",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings().cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
)
bearer = HTTPBearer(auto_error=False)
app.add_middleware(BodyLimitMiddleware)
DB = Annotated[Session, Depends(get_db)]
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]


def principal(auth: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if auth is None or auth.scheme.lower() != "bearer" or len(auth.credentials) > 512:
        raise DomainError("unauthorized", "Требуется API-ключ", 401)
    hashed = hashlib.sha256(auth.credentials.encode()).hexdigest()
    with session() as db:
        actor = db.scalar(
            select(Credential).where(Credential.token_hash == hashed, Credential.active.is_(True))
        )
        if actor is None:
            raise DomainError("unauthorized", "Недействительный API-ключ", 401)
        return actor


def roles(*allowed):
    def guard(actor: Annotated[Credential, Depends(principal)]):
        if actor.role not in {*allowed, "admin"}:
            raise DomainError("forbidden", "Недостаточно прав", 403)
        return actor

    return guard


Reader = Annotated[Credential, Depends(principal)]
Planner = Annotated[Credential, Depends(roles("planner"))]
Approver = Annotated[Credential, Depends(roles("approver"))]


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > 50 * 1024 * 1024):
        return JSONResponse(
            status_code=413,
            content={
                "code": "request_too_large",
                "message": "Лимит запроса 50 МБ",
                "request_id": request.state.request_id,
            },
        )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


def error_response(request, code, message, status, details=None):
    return JSONResponse(
        status_code=status,
        content={
            "code": code,
            "message": message,
            "details": details or [],
            "request_id": getattr(request.state, "request_id", None),
        },
        headers={"WWW-Authenticate": "Bearer"} if status == 401 else None,
    )


@app.exception_handler(DomainError)
async def domain_error(request, error):
    return error_response(request, error.code, error.message, error.status)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    details = [{"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in error.errors()]
    return error_response(request, "validation_error", "Проверьте параметры запроса", 422, details)


@app.exception_handler(StarletteHTTPException)
async def http_error(request, error):
    return error_response(request, "http_error", str(error.detail), error.status_code)


@app.exception_handler(SQLAlchemyError)
async def database_error(request, error):
    log.error(
        "database_error request=%s type=%s", getattr(request.state, "request_id", None), type(error).__name__
    )
    return error_response(
        request,
        "database_unavailable",
        "Хранилище временно недоступно. Повторите запрос с тем же ключом.",
        503,
    )


@app.exception_handler(Exception)
async def internal_error(request, error):
    log.error(
        "internal_error request=%s type=%s", getattr(request.state, "request_id", None), type(error).__name__
    )
    return error_response(request, "internal_error", "Внутренняя ошибка", 500)


def view(entity, exclude=()):
    return {c.name: getattr(entity, c.name) for c in entity.__table__.columns if c.name not in exclude}


@app.get("/health/live", tags=["Health"])
def live():
    return {"status": "ok", "service": "OptiStock", "version": __version__}


@app.get("/health/ready", tags=["Health"])
def ready(db: DB):
    db.execute(text("SELECT version_num FROM alembic_version"))
    return {"status": "ready"}


@app.get("/api/v1/me", tags=["Access"])
def me(actor: Reader):
    return {"id": actor.id, "name": actor.name, "role": actor.role}


@app.post("/api/v1/datasets/sample", status_code=202, tags=["Import"])
def import_sample(payload: SampleImport, key: Key, actor: Planner, db: DB):
    sources = sample_sources()
    body = {**payload.model_dump(mode="json"), "sources": sources}
    return mutate(db, actor, "import", key, body, lambda: enqueue_import(db, actor, sources, payload.as_of))


@app.post("/api/v1/datasets/upload", status_code=202, tags=["Import"])
def upload_dataset(
    key: Key,
    actor: Planner,
    db: DB,
    supplier: Annotated[Literal["iek", "systeme"], Form()],
    as_of: Annotated[date, Form()],
    files: Annotated[list[UploadFile], File()],
):
    if not 1 <= len(files) <= 12:
        raise DomainError("file_count", "Допустимо от 1 до 12 файлов", 422)
    sources = []
    names = set()
    try:
        for upload in files:
            name = (upload.filename or "").replace("\\", "/").split("/")[-1]
            if not name.lower().endswith(".xlsx") or len(name) > 250 or name in names:
                raise DomainError("filename", "Ожидаются XLSX с уникальными именами до 250 символов", 422)
            names.add(name)
            sources.append({"supplier": supplier, "name": name, "sha256": store_file(upload.file)})
    finally:
        for upload in files:
            upload.file.close()
    return mutate(
        db,
        actor,
        "import",
        key,
        {"as_of": as_of.isoformat(), "sources": sources},
        lambda: enqueue_import(db, actor, sources, as_of),
    )


@app.get("/api/v1/datasets", tags=["Import"])
def datasets(db: DB, actor: Reader, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    return {
        "items": [
            view(d)
            for d in db.scalars(
                select(Dataset).order_by(Dataset.created_at.desc()).offset(offset).limit(limit)
            )
        ]
    }


@app.get("/api/v1/datasets/{identifier}", tags=["Import"])
def get_dataset(identifier: uuid.UUID, db: DB, actor: Reader):
    dataset = require(db, Dataset, identifier)
    return {
        **view(dataset),
        "files": [view(f) for f in db.scalars(select(SourceFile).where(SourceFile.dataset_id == identifier))],
    }


@app.get("/api/v1/jobs/{identifier}", tags=["Jobs"])
def job_status(identifier: uuid.UUID, db: DB, actor: Reader):
    return view(require(db, Job, identifier), exclude=("token",))


@app.post("/api/v1/jobs/{identifier}/retry", status_code=202, tags=["Jobs"])
def retry_job(identifier: uuid.UUID, key: Key, db: DB, actor: Planner):
    def retry():
        job = require(db, Job, identifier, locked=True)
        if job.status != "failed":
            raise DomainError(
                "job_not_failed", "Перезапустить можно только завершившуюся ошибкой задачу", 409
            )
        job.status, job.attempts, job.error, job.finished_at, job.token = "queued", 0, None, None, None
        db.get(Dataset if job.kind == "import" else Plan, job.resource_id).status = "queued"
        audit(db, actor, "job.retry", identifier)
        return {"job_id": str(identifier), "status": "queued"}

    return mutate(db, actor, f"retry:{identifier}", key, {}, retry)


@app.get("/api/v1/items", tags=["Catalog"])
def items(
    dataset_id: uuid.UUID,
    db: DB,
    actor: Reader,
    supplier: Literal["iek", "systeme"] | None = None,
    q: str | None = Query(None, max_length=100),
    category: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    conditions = [Item.dataset_id == dataset_id]
    if supplier:
        conditions.append(Item.supplier == supplier)
    if category:
        conditions.append(Item.category == category)
    if q:
        conditions.append(Item.name.icontains(q, autoescape=True) | Item.code.icontains(q, autoescape=True))
    total = db.scalar(select(func.count()).select_from(Item).where(*conditions))
    values = db.scalars(
        select(Item)
        .options(defer(Item.data))
        .where(*conditions)
        .order_by(Item.supplier, Item.code)
        .offset(offset)
        .limit(limit)
    )
    return {"total": total, "items": [view(i, exclude=("data",)) for i in values]}


@app.get("/api/v1/items/{identifier}", tags=["Catalog"])
def item_detail(identifier: uuid.UUID, db: DB, actor: Reader):
    item = require(db, Item, identifier)
    return {
        **view(item, exclude=("data",)),
        "data": {k: v for k, v in item.data.items() if k != "events"},
        "transaction_rows": len(item.data["events"]),
    }


@app.get("/api/v1/items/{identifier}/transactions", tags=["Catalog"])
def transactions(
    identifier: uuid.UUID,
    db: DB,
    actor: Reader,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    events = require(db, Item, identifier).data["events"]
    return {"total": len(events), "items": events[offset : offset + limit]}


@app.post("/api/v1/plans", status_code=202, tags=["Planning"])
def create_plan(payload: CreatePlan, key: Key, db: DB, actor: Planner):
    return mutate(
        db, actor, "plan", key, payload.model_dump(mode="json"), lambda: enqueue_plan(db, actor, payload)
    )


@app.get("/api/v1/plans", tags=["Planning"])
def plans(db: DB, actor: Reader, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    return {
        "items": [
            view(p)
            for p in db.scalars(select(Plan).order_by(Plan.created_at.desc()).offset(offset).limit(limit))
        ]
    }


@app.post("/api/v1/agent/runs", status_code=202, tags=["Procurement agent"])
def start_agent(payload: CreatePlan, key: Key, db: DB, actor: Planner):
    return mutate(
        db, actor, "agent", key, payload.model_dump(mode="json"), lambda: enqueue_agent(db, actor, payload)
    )


def agent_view(db, run):
    plan = require(db, Plan, run.plan_id)
    job = db.scalar(select(Job).where(Job.resource_id == plan.id, Job.kind == "plan"))
    return {
        **view(run),
        "dataset_id": plan.dataset_id,
        "status": job.status,
        "scenario": plan.parameters,
        "job": view(job, exclude=("token",)),
    }


@app.get("/api/v1/agent/runs", tags=["Procurement agent"])
def agent_runs(
    db: DB, actor: Reader, dataset_id: uuid.UUID | None = None, limit: int = Query(20, ge=1, le=100)
):
    query = select(AgentRun).join(Plan, AgentRun.plan_id == Plan.id)
    if dataset_id:
        query = query.where(Plan.dataset_id == dataset_id)
    runs = db.scalars(query.order_by(AgentRun.created_at.desc()).limit(limit)).all()
    return {"items": [agent_view(db, run) for run in runs]}


@app.get("/api/v1/agent/runs/{identifier}", tags=["Procurement agent"])
def get_agent_run(identifier: uuid.UUID, db: DB, actor: Reader):
    return agent_view(db, require(db, AgentRun, identifier))


@app.get("/api/v1/plans/{identifier}", tags=["Planning"])
def get_plan(identifier: uuid.UUID, db: DB, actor: Reader):
    return view(require(db, Plan, identifier))


@app.get("/api/v1/plans/{identifier}/recommendations", tags=["Planning"])
def recommendations(
    identifier: uuid.UUID,
    db: DB,
    actor: Reader,
    supplier: Literal["iek", "systeme"] | None = None,
    risk: Literal["critical", "reorder", "covered", "insufficient_data"] | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    require(db, Plan, identifier)
    conditions = [Recommendation.plan_id == identifier]
    if supplier:
        conditions.append(Item.supplier == supplier)
    if risk:
        conditions.append(Recommendation.risk == risk)
    base = (
        select(Recommendation, Item)
        .options(defer(Item.data))
        .join(Item, Recommendation.item_id == Item.id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.order_by(Recommendation.risk, Item.code).offset(offset).limit(limit))
    return {
        "total": total,
        "items": [
            {
                **view(r, exclude=("explanation",)),
                "code": i.code,
                "name": i.name,
                "supplier": i.supplier,
                "unit": i.unit,
                "warnings": r.explanation["warnings"],
                "reason": r.explanation["text"],
            }
            for r, i in rows
        ],
    }


@app.get("/api/v1/recommendations/{identifier}", tags=["Planning"])
def explain(identifier: uuid.UUID, db: DB, actor: Reader):
    return view(require(db, Recommendation, identifier))


@app.post("/api/v1/orders", status_code=201, tags=["Orders"])
def create_orders(payload: DraftOrders, key: Key, db: DB, actor: Planner):
    return mutate(
        db,
        actor,
        "orders",
        key,
        payload.model_dump(mode="json"),
        lambda: draft_orders(db, actor, payload.plan_id),
    )


@app.get("/api/v1/orders", tags=["Orders"])
def list_orders(db: DB, actor: Reader, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    return {
        "items": [
            view(o)
            for o in db.scalars(
                select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc()).offset(offset).limit(limit)
            )
        ]
    }


@app.get("/api/v1/orders/{identifier}", tags=["Orders"])
def order_detail(identifier: uuid.UUID, db: DB, actor: Reader):
    order = require(db, PurchaseOrder, identifier)
    lines = db.execute(
        select(OrderLine, Item)
        .join(Item, OrderLine.item_id == Item.id)
        .where(OrderLine.order_id == identifier)
        .order_by(Item.code)
    )
    return {
        **view(order),
        "lines": [
            {**view(line), "code": item.code, "name": item.name, "unit": item.unit} for line, item in lines
        ],
    }


@app.patch("/api/v1/orders/{identifier}", tags=["Orders"])
def patch_order(identifier: uuid.UUID, payload: EditOrder, key: Key, db: DB, actor: Planner):
    return mutate(
        db,
        actor,
        f"edit:{identifier}",
        key,
        payload.model_dump(mode="json"),
        lambda: edit_order(db, actor, identifier, payload),
    )


@app.post("/api/v1/orders/{identifier}/{action}", tags=["Orders"])
def change_order(
    identifier: uuid.UUID,
    action: Literal["approve", "cancel"],
    payload: OrderAction,
    key: Key,
    db: DB,
    actor: Approver,
):
    return mutate(
        db,
        actor,
        f"{action}:{identifier}",
        key,
        payload.model_dump(mode="json"),
        lambda: action_order(db, actor, identifier, payload.revision, action),
    )


def safe_csv(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value


@app.get("/api/v1/orders/{identifier}/export", tags=["Orders"])
def export_order(identifier: uuid.UUID, db: DB, actor: Reader):
    with db.begin():
        order = require(db, PurchaseOrder, identifier, locked=True)
        if order.status != "approved":
            raise DomainError("approval_required", "Экспорт доступен только для утверждённого заказа", 409)
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, delimiter=";")
        writer.writerow(
            [
                "order_id",
                "revision",
                "supplier",
                "code",
                "name",
                "stock_unit",
                "stock_quantity",
                "purchase_quantity",
                "arrival_date",
            ]
        )
        rows = db.execute(
            select(OrderLine, Item, Recommendation)
            .join(Item, OrderLine.item_id == Item.id)
            .join(
                Recommendation,
                (Recommendation.item_id == Item.id) & (Recommendation.plan_id == order.plan_id),
            )
            .where(OrderLine.order_id == order.id, OrderLine.quantity > 0)
            .order_by(Item.code)
        )
        from decimal import Decimal

        for line, item, recommendation in rows:
            factor = Decimal(recommendation.explanation["rounding"]["conversion"])
            writer.writerow(
                [
                    order.id,
                    order.revision,
                    item.supplier,
                    safe_csv(item.code),
                    safe_csv(item.name),
                    safe_csv(item.unit),
                    line.quantity,
                    line.quantity / factor,
                    order.arrival_date,
                ]
            )
        audit(db, actor, "order.export", order.id, {"revision": order.revision, "format": "csv"})
    return Response(
        buffer.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="optistock-{identifier}-r{order.revision}.csv"'
        },
    )


@app.get("/api/v1/audit", tags=["Audit"])
def audit_log(
    db: DB,
    actor: Reader,
    entity_id: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    statement = select(AuditEvent)
    if entity_id:
        statement = statement.where(AuditEvent.entity_id == entity_id)
    return {
        "items": [
            view(e)
            for e in db.scalars(statement.order_by(AuditEvent.created_at.desc()).offset(offset).limit(limit))
        ]
    }
