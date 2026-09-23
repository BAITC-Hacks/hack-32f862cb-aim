"""Server-side tool registry for the OpenAI assistant.

Every tool is a fixed Python function with a validated JSON schema. The model never supplies SQL,
Python, URLs or shell input: it may only pick a tool name and arguments, which are re-validated here
against the plan the run was created for. Quantities always come from the deterministic planning
core, never from the model.
"""

import json
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import defer

from optistock.db import session
from optistock.errors import DomainError
from optistock.models import Dataset, Item, Plan, PurchaseOrder, Recommendation
from optistock.planning import calculate
from optistock.schemas import Scenario

MAX_ARGUMENT_BYTES = 8000
MAX_FIND_RESULTS = 25
MAX_HISTORY_MONTHS = 36
MAX_COMPARE_ROWS = 15
COMPARE_CALL_BUDGET = 2

RISKS = ("critical", "insufficient_data", "reorder", "covered")


def _text(value, limit):
    return str(value)[:limit]


def _fact_row(item, quantity, risk, explanation):
    """Verifiable numbers for one SKU. No customer identifiers and no document numbers."""
    return {
        "code": item.code,
        "name": _text(item.name, 200),
        "supplier": item.supplier,
        "unit": item.unit,
        "category": item.category,
        "risk": risk,
        "order_quantity": str(quantity),
        "forecast_quantity": explanation["forecast_quantity"],
        "safety_stock": explanation["safety_stock"],
        "inventory": explanation["inventory"],
        "inventory_source": explanation["inventory_source"],
        "daily_base": explanation["daily_base"],
        "annual_trend_ratio": explanation["annual_trend_ratio"],
        "pre_arrival_lost_sales": explanation["pre_arrival_lost_sales"],
        "effective_safety_days": explanation["effective_safety_days"],
        "rounding": explanation["rounding"],
        "outlier_count": len(explanation["outlier_exclusions"]),
        "outlier_removed": round(sum(e["removed"] for e in explanation["outlier_exclusions"]), 4),
        "stockout_added": round(sum(e["added"] for e in explanation["stockout_adjustments"]), 4),
        "incoming_in_horizon": round(sum(e["incoming"] for e in explanation["daily_projection"]), 4),
        "warnings": explanation["warnings"],
    }


def _plan_context(db, plan_id):
    plan = db.scalar(select(Plan).where(Plan.id == plan_id))
    if plan is None:
        raise DomainError("not_found", "План не найден", 404)
    dataset = db.scalar(select(Dataset).where(Dataset.id == plan.dataset_id))
    return plan, dataset


def _resolve_item(db, plan, code):
    """Look a SKU up strictly inside the plan the run belongs to."""
    row = db.execute(
        select(Recommendation, Item)
        .join(Item, Recommendation.item_id == Item.id)
        .where(Recommendation.plan_id == plan.id, Item.code == code)
    ).first()
    if row is None:
        raise DomainError("item_outside_plan", f"Товар {_text(code, 40)} отсутствует в этом плане", 422)
    return row


# --- tools -----------------------------------------------------------------------------------


def get_plan_summary(ctx, _args):
    with session() as db:
        plan, dataset = _plan_context(db, ctx["plan_id"])
        counts = {risk: 0 for risk in RISKS}
        totals = {}
        rows = db.execute(
            select(Recommendation.risk, Recommendation.quantity, Item.supplier, Item.unit)
            .join(Item, Recommendation.item_id == Item.id)
            .where(Recommendation.plan_id == plan.id)
        ).all()
        for risk, quantity, supplier, unit in rows:
            counts[risk] = counts.get(risk, 0) + 1
            totals.setdefault((supplier, unit), Decimal("0"))
            totals[(supplier, unit)] += quantity
        orders = db.scalars(select(PurchaseOrder).where(PurchaseOrder.plan_id == plan.id)).all()
        return {
            "plan_id": str(plan.id),
            "as_of": dataset.as_of.isoformat(),
            "algorithm_version": plan.algorithm_version,
            "scenario": plan.parameters,
            "items_total": len(rows),
            "risk_counts": counts,
            "order_quantity_by_supplier_and_unit": [
                {"supplier": s, "unit": u, "quantity": str(q)} for (s, u), q in sorted(totals.items())
            ],
            "drafts": [
                {"order_id": str(o.id), "supplier": o.supplier, "status": o.status, "revision": o.revision}
                for o in orders
            ],
            "dataset_limitations": (dataset.summary or {}).get("limitations", []),
            "note": "Количества рассчитаны детерминированным ядром сервера, а не моделью.",
        }


def find_items(ctx, args):
    query = _text(args.get("query") or "", 80).strip().lower()
    risk = args.get("risk")
    supplier = args.get("supplier")
    limit = min(int(args.get("limit") or 10), MAX_FIND_RESULTS)
    if risk is not None and risk not in RISKS:
        raise DomainError("bad_tool_argument", "Недопустимое значение risk", 422)
    if supplier is not None and supplier not in ("iek", "systeme"):
        raise DomainError("bad_tool_argument", "Недопустимое значение supplier", 422)
    with session() as db:
        plan, _ = _plan_context(db, ctx["plan_id"])
        statement = (
            select(Recommendation, Item)
            .options(defer(Item.data))
            .join(Item, Recommendation.item_id == Item.id)
            .where(Recommendation.plan_id == plan.id)
        )
        if risk:
            statement = statement.where(Recommendation.risk == risk)
        if supplier:
            statement = statement.where(Item.supplier == supplier)
        if query:
            pattern = f"%{query}%"
            statement = statement.where(Item.code.ilike(pattern) | Item.name.ilike(pattern))
        statement = statement.order_by(Recommendation.quantity.desc(), Item.code).limit(limit)
        rows = db.execute(statement).all()
        return {
            "matched": len(rows),
            "limit": limit,
            "items": [
                {
                    "code": item.code,
                    "name": _text(item.name, 160),
                    "supplier": item.supplier,
                    "unit": item.unit,
                    "risk": rec.risk,
                    "order_quantity": str(rec.quantity),
                }
                for rec, item in rows
            ],
            "note": "Показаны только товары выбранного плана.",
        }


def explain_item(ctx, args):
    code = _text(args.get("code") or "", 100).strip()
    if not code:
        raise DomainError("bad_tool_argument", "Нужен код товара", 422)
    with session() as db:
        plan, _ = _plan_context(db, ctx["plan_id"])
        rec, item = _resolve_item(db, plan, code)
        facts = _fact_row(item, rec.quantity, rec.risk, rec.explanation)
        projection = rec.explanation["daily_projection"]
        return {
            **facts,
            "arrival_date": rec.arrival_date.isoformat(),
            "text": rec.explanation["text"],
            # Document numbers are deliberately omitted; only dates and amounts are shared.
            "outlier_exclusions": [
                {"date": e["date"], "removed": e["removed"], "method": e["method"]}
                for e in rec.explanation["outlier_exclusions"][:10]
            ],
            "stockout_adjustments": rec.explanation["stockout_adjustments"][:10],
            "commitments": [
                {"eta": c["eta"], "quantity": c["q"]} for c in rec.explanation.get("commitments", [])[:10]
            ],
            "projection_first_days": projection[:10],
            "projection_days": len(projection),
        }


def sales_history(ctx, args):
    code = _text(args.get("code") or "", 100).strip()
    if not code:
        raise DomainError("bad_tool_argument", "Нужен код товара", 422)
    with session() as db:
        plan, _ = _plan_context(db, ctx["plan_id"])
        rec, item = _resolve_item(db, plan, code)
        explanation = rec.explanation
        return {
            "code": item.code,
            "unit": item.unit,
            "raw_monthly_sales": explanation["raw_monthly_sales"][-MAX_HISTORY_MONTHS:],
            "cleaned_monthly_sales": explanation["cleaned_monthly_sales"][-MAX_HISTORY_MONTHS:],
            "seasonality_profile": explanation["seasonality"],
            "annual_trend_ratio": explanation["annual_trend_ratio"],
            "warnings": explanation["warnings"],
            "note": "Ряды без клиентских идентификаторов и номеров документов.",
        }


def compare_scenario(ctx, args):
    if ctx["compare_calls"] >= COMPARE_CALL_BUDGET:
        raise DomainError("tool_budget", "Лимит сравнений сценария в одном запросе исчерпан", 429)
    ctx["compare_calls"] += 1
    with session() as db:
        plan, dataset = _plan_context(db, ctx["plan_id"])
        base = dict(plan.parameters)
        overrides = {k: v for k, v in args.items() if v is not None}
        # Scope stays exactly the source plan's: a comparison may not silently widen the SKU set.
        for locked in ("supplier", "category"):
            if locked in overrides and overrides[locked] != base.get(locked):
                raise DomainError("scenario_scope", "Поставщик и категория сравнения неизменны", 422)
        try:
            scenario = Scenario.model_validate({**base, **overrides})
        except ValueError:
            raise DomainError("bad_tool_argument", "Параметры сценария вне допустимых границ", 422) from None
        rows = db.execute(
            select(Recommendation, Item)
            .join(Item, Recommendation.item_id == Item.id)
            .where(Recommendation.plan_id == plan.id)
            .order_by(Item.supplier, Item.code)
        ).all()
        as_of = dataset.as_of
    totals, risk_before, risk_after, changed = {}, {}, {}, []
    for rec, item in rows:
        quantity, risk, _, explanation = calculate(
            item, as_of, scenario, rec.explanation.get("commitments", [])
        )
        key = (item.supplier, item.unit)
        totals.setdefault(key, {"before": Decimal("0"), "after": Decimal("0")})
        totals[key]["before"] += rec.quantity
        totals[key]["after"] += quantity
        risk_before[rec.risk] = risk_before.get(rec.risk, 0) + 1
        risk_after[risk] = risk_after.get(risk, 0) + 1
        if quantity != rec.quantity:
            changed.append(
                {
                    "code": item.code,
                    "unit": item.unit,
                    "supplier": item.supplier,
                    "risk_before": rec.risk,
                    "risk_after": risk,
                    "before": str(rec.quantity),
                    "after": str(quantity),
                    "delta": str(quantity - rec.quantity),
                    "forecast_quantity_after": explanation["forecast_quantity"],
                }
            )
    changed.sort(key=lambda r: -abs(float(r["delta"])))
    return {
        "base_scenario": base,
        "compared_scenario": scenario.model_dump(mode="json"),
        "items_total": len(rows),
        "items_changed": len(changed),
        "risk_before": risk_before,
        "risk_after": risk_after,
        "order_quantity_by_supplier_and_unit": [
            {"supplier": s, "unit": u, "before": str(v["before"]), "after": str(v["after"])}
            for (s, u), v in sorted(totals.items())
        ],
        "top_changes": changed[:MAX_COMPARE_ROWS],
        "note": "Гипотетический расчёт. Активный план, заказы и обязательства не изменены.",
    }


REGISTRY = {
    "get_plan_summary": get_plan_summary,
    "find_items": find_items,
    "explain_item": explain_item,
    "sales_history": sales_history,
    "compare_scenario": compare_scenario,
}

SCENARIO_NUMBERS = {
    "lead_time_days": (1, 180, "Срок поставки в днях"),
    "review_days": (1, 90, "Период до следующего пересмотра заказа, дни"),
    "safety_days": (0, 90, "Страховое покрытие в днях"),
    "growth_percent": (-50, 200, "Прогноз прироста в процентах"),
}

DEFINITIONS = [
    {
        "type": "function",
        "name": "get_plan_summary",
        "description": "Сводка сохранённого плана: сценарий, счётчики риска, суммы заказа по поставщику "
        "и единице измерения, черновики и ограничения набора данных.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "type": "function",
        "name": "find_items",
        "description": "Найти товары внутри этого плана по части кода или наименования, "
        "с необязательным фильтром по риску и поставщику.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Часть кода или наименования"},
                "risk": {"type": "string", "enum": list(RISKS)},
                "supplier": {"type": "string", "enum": ["iek", "systeme"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_FIND_RESULTS},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "explain_item",
        "description": "Числовое разложение рекомендации по одному товару плана: прогноз, страховой "
        "запас, запас, поступления, исключённые всплески, поправки stockout и округление.",
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Код товара из этого плана"}},
            "required": ["code"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "sales_history",
        "description": "Исходный и очищенный месячные ряды продаж товара, сезонный профиль и тренд. "
        "Без клиентских идентификаторов и номеров документов.",
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Код товара из этого плана"}},
            "required": ["code"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "compare_scenario",
        "description": "Пересчитать те же товары расчётным ядром сервера с изменёнными параметрами "
        "и вернуть сравнение before/after. Не меняет активный план и заказы.",
        "parameters": {
            "type": "object",
            "properties": {
                name: {"type": "number", "minimum": low, "maximum": high, "description": text}
                for name, (low, high, text) in SCENARIO_NUMBERS.items()
            }
            | {
                "remove_outliers": {"type": "boolean"},
                "estimate_stockouts": {"type": "boolean"},
                "use_seasonality": {"type": "boolean"},
                "use_trend": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
    },
]


def run_tool(ctx, name, raw_arguments):
    """Validate and execute one model-selected tool. Returns (payload, ok)."""
    if name not in REGISTRY:
        return {"error": "unknown_tool", "message": "Инструмент недоступен"}, False
    raw = raw_arguments or "{}"
    if len(raw.encode()) > MAX_ARGUMENT_BYTES:
        return {"error": "arguments_too_large", "message": "Слишком длинные аргументы"}, False
    try:
        args = json.loads(raw)
    except ValueError:
        return {"error": "invalid_arguments", "message": "Аргументы не являются JSON-объектом"}, False
    if not isinstance(args, dict):
        return {"error": "invalid_arguments", "message": "Ожидается объект аргументов"}, False
    # Coerce the integer-valued scenario knobs the schema exposes as numbers.
    for key in ("lead_time_days", "review_days", "safety_days", "limit"):
        if isinstance(args.get(key), float) and args[key].is_integer():
            args[key] = int(args[key])
    try:
        return REGISTRY[name](ctx, args), True
    except DomainError as error:
        return {"error": error.code, "message": error.message}, False
