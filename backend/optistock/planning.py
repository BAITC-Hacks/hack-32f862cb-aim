"""Pure, deterministic demo planning. Every estimate is named in the persisted explanation."""

import calendar
import math
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_CEILING, Decimal
from statistics import median

from optistock.schemas import Scenario


def rounded(value):
    return round(float(value), 4)


def seasonal_profile(data, enabled):
    profiles = []
    if enabled:
        for row in data.get("seasonality", []):
            values = row["values"]
            average = sum(values) / 12
            if average > 0:
                profiles.append([v / average for v in values])
    if not profiles:
        return [1.0] * 12
    profile = [max(0.25, min(3.0, median(p[i] for p in profiles))) for i in range(12)]
    average = sum(profile) / 12
    return [p / average for p in profile]


def cleaned_history(data, as_of, scenario, profile):
    first_current = as_of.replace(day=1).isoformat()
    warnings = []
    history = {}
    for period, quantity in sorted(data.get("sales", {}).items()):
        if period >= first_current:
            continue  # Never extrapolate an incomplete month into a full observed month.
        if quantity is None:
            warnings.append(
                "blank_sales_assumed_zero" if scenario.blank_monthly_sales_as_zero else "blank_sales_excluded"
            )
            if not scenario.blank_monthly_sales_as_zero:
                continue
            quantity = 0
        history[period] = max(0.0, quantity)

    # Transaction rows are not added to monthly sales. Use them only to identify corrections
    # in months where both sources reconcile (same scope, sign convention, and coverage).
    documents = defaultdict(float)
    totals = defaultdict(float)
    for event in data.get("events", []):
        if event["date"] >= first_current:
            continue
        period = event["date"][:7] + "-01"
        totals[period] += event["q"]
        if event["q"] > 0:
            documents[(event["date"], event["document"])] += event["q"]
    exclusions = []
    if scenario.remove_outliers and len(documents) >= 8:
        values = list(documents.values())
        logs = [math.log1p(v) for v in values]
        center = median(logs)
        mad = median(abs(v - center) for v in logs)
        threshold = max(5 * median(values), math.expm1(center + 4.5 * 1.4826 * mad))
        large = [(k, v) for k, v in documents.items() if v > threshold]
        repeated_months = {key[0][:7] for key, _ in large}
        # Conservatively preserve repeated wholesale-sized demand, even without customer IDs.
        if len(repeated_months) < 3:
            for (day, doc), quantity in large:
                period = day[:7] + "-01"
                raw = data.get("sales", {}).get(period)
                if raw is None or abs(totals[period] - raw) > max(1, abs(raw) * 0.05):
                    warnings.append("transaction_month_mismatch_outlier_not_applied")
                    continue
                removed = min(history.get(period, 0), quantity - threshold)
                history[period] = max(0, history.get(period, 0) - removed)
                if removed:
                    exclusions.append(
                        {
                            "date": day,
                            "document": doc,
                            "original": rounded(quantity),
                            "removed": rounded(removed),
                            "method": "document_log_mad",
                        }
                    )
    corrections = []
    if history and scenario.estimate_stockouts:
        rates = [q / profile[date.fromisoformat(p).month - 1] for p, q in history.items()]
        expected_base = median(rates) if rates else 0
        for period, q in list(history.items()):
            if data.get("stocks", {}).get(period) == 0:
                expected = expected_base * profile[date.fromisoformat(period).month - 1]
                if expected > q:
                    history[period] = expected
                    corrections.append(
                        {"month": period, "added": rounded(expected - q), "method": "zero_snapshot_proxy"}
                    )
        if corrections:
            warnings.append("stockout_is_estimated_from_monthly_snapshot")
    return history, exclusions, corrections, warnings


def calculate(item, as_of: date, scenario: Scenario, commitments: list[dict] | None = None):
    data = item.data
    warnings = list(data.get("warnings", []))
    warnings.extend(
        ["test_dataset", "no_customer_id_document_level_outliers", "lead_time_and_safety_are_scenario_inputs"]
    )
    if data.get("seasonality") and scenario.use_seasonality:
        warnings.append("supplier_seasonality_is_an_unverified_unit_proxy")
    profile = seasonal_profile(data, scenario.use_seasonality)
    history, exclusions, corrections, history_warnings = cleaned_history(data, as_of, scenario, profile)
    warnings.extend(history_warnings)
    # Blank cells may fill gaps, but an entirely unobserved series is not evidence of zero demand.
    if not any(
        p < as_of.replace(day=1).isoformat() and q is not None for p, q in data.get("sales", {}).items()
    ):
        history = {}
    periods = sorted(history)[-12:]
    rates = [
        history[p]
        / calendar.monthrange(date.fromisoformat(p).year, date.fromisoformat(p).month)[1]
        / profile[date.fromisoformat(p).month - 1]
        for p in periods
    ]
    # A trimmed mean retains intermittent demand instead of collapsing sparse series to zero.
    trimmed = sorted(rates)
    if len(trimmed) >= 10 and sum(v > 0 for v in trimmed) >= 6:
        trimmed = trimmed[1:-1]
    daily_base = sum(trimmed) / len(trimmed) if trimmed else 0
    if len(periods) < 6:
        warnings.append("short_history")
    if not periods:
        warnings.append("no_monthly_sales_history")

    trend_ratio = 1.0
    ratios = []
    if scenario.use_trend:
        for length in (3, 6):
            recent = periods[-length:]
            previous = [f"{int(p[:4]) - 1}{p[4:]}" for p in recent]
            if len(recent) == length and all(p in history for p in previous):
                before = sum(history[p] for p in previous)
                if before > 0:
                    ratios.append(sum(history[p] for p in recent) / before)
        if len(ratios) == 2 and (ratios[0] - 1) * (ratios[1] - 1) > 0:
            trend_ratio = max(0.5, min(1.5, sum(ratios) / 2))

    inventory_source = "free_inventory_from_file"
    available = float(item.available) if item.available is not None else None
    if available is None:
        snapshots = [
            (d, q) for d, q in data.get("stocks", {}).items() if d <= as_of.isoformat() and q is not None
        ]
        if scenario.missing_inventory == "latest_snapshot" and snapshots:
            snapshot_date, available = max(snapshots)
            inventory_source = f"snapshot_proxy:{snapshot_date}"
        else:
            available, inventory_source = 0.0, "assumed_zero"
        warnings.append("current_inventory_is_assumed")
    if available < 0:
        warnings.append("negative_inventory_clamped_to_zero")
    available = max(0.0, available)

    conversion = float(scenario.cable_reel_meters) if data.get("cable_reels") else 1.0
    if conversion != 1:
        warnings.append("cable_reel_conversion_is_assumed")
    incoming = defaultdict(float)
    for shipment in data.get("incoming", []):
        eta = date.fromisoformat(shipment["eta"])
        if eta <= as_of:
            warnings.append("overdue_incoming_excluded")
        else:
            incoming[eta] += shipment["q"] * conversion
    for commitment in commitments or []:
        eta = date.fromisoformat(commitment["eta"])
        if eta <= as_of:
            warnings.append("overdue_commitment_excluded")
        else:
            incoming[eta] += float(commitment["q"])

    horizon = scenario.lead_time_days + scenario.review_days
    effective_safety_days = scenario.category_safety_days.get(
        getattr(item, "category", None), scenario.safety_days
    )
    daily = []
    for step in range(1, horizon + effective_safety_days + 1):
        day = as_of + timedelta(days=step)
        q = (
            daily_base
            * profile[day.month - 1]
            * (trend_ratio ** (step / 365))
            * (1 + scenario.growth_percent / 100)
        )
        daily.append({"date": day.isoformat(), "demand": q})
    safety = sum(row["demand"] for row in daily[horizon:])
    arrival = as_of + timedelta(days=scenario.lead_time_days)
    balance, pre_arrival_shortage, required, simulated = available, 0.0, 0.0, []
    for row in daily[:horizon]:
        day = date.fromisoformat(row["date"])
        balance += incoming.get(day, 0) - row["demand"]
        if day < arrival:
            pre_arrival_shortage += max(0.0, -balance)
            balance = max(0.0, balance)  # Lost sales before arrival are not ordered as backlog.
        else:
            required = max(required, -balance)
        simulated.append(
            {
                "date": row["date"],
                "demand": rounded(row["demand"]),
                "incoming": rounded(incoming.get(day, 0)),
                "balance_without_new_order": rounded(balance),
            }
        )
    required = max(required, safety - balance, 0.0)
    minimum = Decimal(str(item.minimum or scenario.default_minimum))
    multiple = Decimal(str(item.multiple or scenario.default_multiple))
    if item.minimum is None or item.multiple is None:
        warnings.append("default_order_constraint_used")
    factor = Decimal(str(conversion))
    purchase_quantity = Decimal("0")
    if required > 1e-8:
        purchase_quantity = (max(Decimal(str(required)) / factor, minimum) / multiple).to_integral_value(
            rounding=ROUND_CEILING
        ) * multiple
    quantity = (purchase_quantity * factor).quantize(Decimal("0.0001"))
    if not periods:
        quantity, purchase_quantity = Decimal("0"), Decimal("0")
    risk = (
        "insufficient_data"
        if not periods
        else "critical"
        if pre_arrival_shortage > 1e-8
        else "reorder"
        if quantity > 0
        else "covered"
    )
    explanation = {
        "model": "robust-seasonal-v1",
        "as_of": as_of.isoformat(),
        "scenario": scenario.model_dump(mode="json"),
        "scope": "supplier_aggregate_test_scenario",
        "inventory": rounded(available),
        "inventory_source": inventory_source,
        "daily_base": rounded(daily_base),
        "annual_trend_ratio": rounded(trend_ratio),
        "seasonality": [rounded(v) for v in profile],
        "forecast_quantity": rounded(sum(r["demand"] for r in daily[:horizon])),
        "safety_stock": rounded(safety),
        "effective_safety_days": effective_safety_days,
        "raw_order_quantity": rounded(required),
        "order_quantity": str(quantity),
        "purchase_quantity": str(purchase_quantity),
        "rounding": {"minimum": str(minimum), "multiple": str(multiple), "conversion": str(factor)},
        "pre_arrival_lost_sales": rounded(pre_arrival_shortage),
        "commitments": commitments or [],
        "outlier_exclusions": exclusions,
        "stockout_adjustments": corrections,
        "cleaned_monthly_sales": [{"month": p, "quantity": rounded(q)} for p, q in sorted(history.items())],
        "daily_projection": simulated,
        "warnings": sorted(set(warnings)),
        "sources": data.get("sources", {}),
        "text": f"Заказ {quantity} {item.unit}; прогноз {rounded(sum(r['demand'] for r in daily[:horizon]))}, "
        f"страховой запас {rounded(safety)}, начальный запас {rounded(available)}. "
        f"Поступления учитываются по датам. Возможный дефицит до новой поставки: {rounded(pre_arrival_shortage)}. "
        "Расчёт на тестовых данных с сохранёнными допущениями.",
    }
    return quantity, risk, arrival, explanation
