"""Procurement workflow agent. Tools produce numbers; all purchases require human approval.

This is an executable, deterministic agent workflow, not an LLM simulation. Its report
and supplier drafts publish atomically under the plan job lease and survive restarts.
"""

from collections import Counter, defaultdict

from optistock.errors import DomainError
from optistock.planning import calculate


def inspect_data(items, as_of):
    cutoff = as_of.replace(day=1).isoformat()
    with_history = sum(
        any(p < cutoff and q is not None for p, q in i.data.get("sales", {}).items()) for i in items
    )
    if not with_history:
        raise DomainError(
            "no_sales_history",
            "Нет завершённых месяцев продаж. Загрузите историю перед запуском агента.",
            422,
        )
    return {
        "items": len(items),
        "with_history": with_history,
        "without_history": len(items) - with_history,
        "with_current_inventory": sum(i.available is not None for i in items),
        "with_incoming": sum(bool(i.data.get("incoming")) for i in items),
        "with_transactions": sum(bool(i.data.get("events")) for i in items),
        "with_category": sum(i.category is not None for i in items),
        "suppliers": dict(Counter(i.supplier for i in items)),
        "as_of": as_of.isoformat(),
        "scope": "supplier_aggregate",
    }


def review_plan(items, results, as_of, scenario, commitments, quality):
    warnings = Counter()
    exceptions = []
    supplier_groups = defaultdict(
        lambda: {"items": 0, "order_lines": 0, "critical": 0, "quantities": defaultdict(float)}
    )
    corrected_documents = set()
    outlier_corrections = corrected_items = stockout_items = 0
    changes = []
    for item, result in zip(items, results, strict=True):
        exp = result.explanation
        warnings.update(set(exp["warnings"]))
        group = supplier_groups[item.supplier]
        group["items"] += 1
        group["order_lines"] += int(result.quantity > 0)
        group["critical"] += int(result.risk == "critical")
        group["quantities"][item.unit] += float(result.quantity)
        exclusions = exp["outlier_exclusions"]
        outlier_corrections += len(exclusions)
        corrected_documents.update((item.supplier, e["date"], e["document"]) for e in exclusions)
        corrected_items += bool(exclusions)
        stockout_items += bool(exp["stockout_adjustments"])
        if exclusions:
            raw = calculate(
                item,
                as_of,
                scenario.model_copy(update={"remove_outliers": False}),
                commitments[(item.supplier, item.code)],
            )
            changes.append(
                {
                    "item_id": str(item.id),
                    "code": item.code,
                    "supplier": item.supplier,
                    "unit": item.unit,
                    "without_cleaning": str(raw[0]),
                    "with_cleaning": str(result.quantity),
                    "documents": len(exclusions),
                }
            )
        reasons = []
        if result.risk == "insufficient_data":
            reasons.append("Нет истории для прогноза")
        if exp["pre_arrival_lost_sales"] > 0:
            reasons.append("Риск дефицита до прибытия заказа")
        if "current_inventory_is_assumed" in exp["warnings"]:
            reasons.append("Подтвердите текущий остаток")
        if "transaction_month_mismatch_outlier_not_applied" in exp["warnings"]:
            reasons.append("Продажи и документы не сходятся; всплеск сохранён")
        if reasons:
            exceptions.append(
                {
                    "item_id": str(item.id),
                    "recommendation_id": str(result.id),
                    "code": item.code,
                    "name": item.name,
                    "supplier": item.supplier,
                    "risk": result.risk,
                    "reasons": reasons,
                }
            )
    rank = {"insufficient_data": 0, "critical": 1, "reorder": 2, "covered": 3}
    exceptions.sort(key=lambda e: (rank[e["risk"]], e["supplier"], e["code"]))
    changes.sort(
        key=lambda c: (
            -abs(float(c["without_cleaning"]) - float(c["with_cleaning"])),
            c["supplier"],
            c["code"],
        )
    )
    return {
        "agent_version": "procurement-workflow-v2",
        "engine": "deterministic_tools",
        "decision": "review_required",
        "quality": quality,
        "summary": {
            "items": len(results),
            "order_lines": sum(r.quantity > 0 for r in results),
            "critical_items": sum(r.risk == "critical" for r in results),
            "excluded_documents": len(corrected_documents),
            "outlier_corrections": outlier_corrections,
            "outlier_items": corrected_items,
            "stockout_items": stockout_items,
            "exception_items": len(exceptions),
        },
        "suppliers": [
            {"supplier": s, **g, "quantities": {u: round(q, 4) for u, q in g["quantities"].items()}}
            for s, g in sorted(supplier_groups.items())
        ],
        "warnings": [{"code": code, "items": count} for code, count in warnings.most_common()],
        "exceptions": exceptions[:50],
        "exceptions_total": len(exceptions),
        "outlier_comparisons": changes[:20],
        "limitations": [
            "Исходные Excel — материалы кейса; актуальность рабочих остатков не подтверждена.",
            "Расчёт по поставщику: разрез по складам и клиентские ID в материалах отсутствуют.",
            "Потерянный спрос оценивается по месячным снимкам, сроки и страховой запас задаются сценарием.",
            "Агент создаёт черновики. Количества и допущения проверяет менеджер перед утверждением.",
        ],
        "steps": [
            {
                "key": "validate",
                "title": "Проверка данных",
                "detail": f"История продаж: {quality['with_history']} из {quality['items']} SKU. Текущий остаток: {quality['with_current_inventory']} SKU.",
            },
            {
                "key": "clean",
                "title": "Регулярный спрос",
                "detail": f"Скорректировано уникальных документов: {len(corrected_documents)}; поправок по товарам: {outlier_corrections}; товаров с оценкой потерянного спроса: {stockout_items}.",
            },
            {
                "key": "calculate",
                "title": "Расчёт пополнения",
                "detail": "Учтены сезонность, рост, остатки, даты поставок, утверждённые заказы и кратность.",
            },
            {
                "key": "review",
                "title": "Проверка рисков",
                "detail": f"Требуют внимания: {len(exceptions)} SKU. Каждая рекомендация содержит числовое объяснение.",
            },
            {
                "key": "draft",
                "title": "Заказы поставщикам",
                "detail": "Черновики подготовлены для проверки менеджером; автоматического утверждения и отправки нет.",
            },
        ],
    }
