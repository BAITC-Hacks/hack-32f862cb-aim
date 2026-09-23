"""Rolling-origin monthly demand evaluation, grouped by supplier and stock unit.

Only earlier months, transactions, stock snapshots and completed seasonal years are
visible at each origin. Current inventory and future incoming are not forecast features.
Observed sales are the target, not unknowable demand lost during stockouts.
"""

import calendar
from collections import defaultdict
from datetime import date
from types import SimpleNamespace

from optistock.planning import calculate
from optistock.schemas import Scenario


def forecast_at_origin(item, origin, scenario):
    cutoff = origin.isoformat()
    data = {
        **item.data,
        "sales": {p: q for p, q in item.data.get("sales", {}).items() if p < cutoff},
        "stocks": {p: q for p, q in item.data.get("stocks", {}).items() if p < cutoff},
        "events": [e for e in item.data.get("events", []) if e["date"] < cutoff],
        "seasonality": [
            p for p in item.data.get("seasonality", []) if p.get("year", origin.year) < origin.year
        ],
        "incoming": [],
    }
    historical = SimpleNamespace(
        data=data, available=0, minimum=1, multiple=1, unit=item.unit, category=item.category
    )
    exp = calculate(historical, origin, scenario)[3]
    days = calendar.monthrange(origin.year, origin.month)[1]
    return sum(
        exp["daily_base"]
        * exp["seasonality"][origin.month - 1]
        * exp["annual_trend_ratio"] ** (day / 365)
        * (1 + scenario.growth_percent / 100)
        for day in range(days)
    )


def evaluate(items, as_of, months=3):
    groups = defaultdict(
        lambda: {
            "observations": 0,
            "actual": 0.0,
            "models": {
                name: {"absolute_error": 0.0, "signed_error": 0.0}
                for name in ("optistock", "mean_12", "seasonal_naive")
            },
        }
    )
    scenario = Scenario(growth_percent=0)
    skipped = 0
    origins = set()
    for item in items:
        sales = item.data.get("sales", {})
        periods = sorted(p for p in sales if p < as_of.replace(day=1).isoformat())[-months:]
        for period in periods:
            previous = sorted(p for p in sales if p < period and sales[p] is not None)[-12:]
            last_year = f"{int(period[:4]) - 1}{period[4:]}"
            actual = sales[period]
            if actual is None or actual < 0 or len(previous) < 12 or sales.get(last_year) is None:
                skipped += 1
                continue
            origins.add(period)
            predictions = {
                "optistock": forecast_at_origin(item, date.fromisoformat(period), scenario),
                "mean_12": sum(max(0, sales[p]) for p in previous) / len(previous),
                "seasonal_naive": max(0, sales[last_year]),
            }
            group = groups[(item.supplier, item.unit)]
            group["observations"] += 1
            group["actual"] += actual
            for name, predicted in predictions.items():
                group["models"][name]["absolute_error"] += abs(predicted - actual)
                group["models"][name]["signed_error"] += predicted - actual
    rows = []
    for (supplier, unit), group in sorted(groups.items()):
        rows.append(
            {
                "supplier": supplier,
                "unit": unit,
                "observations": group["observations"],
                "actual": round(group["actual"], 4),
                "models": {
                    name: {
                        "mae": round(metrics["absolute_error"] / group["observations"], 4),
                        "wape": round(metrics["absolute_error"] / group["actual"], 4)
                        if group["actual"]
                        else None,
                        "bias": round(metrics["signed_error"] / group["actual"], 4)
                        if group["actual"]
                        else None,
                    }
                    for name, metrics in group["models"].items()
                },
            }
        )
    return {
        "method": "rolling_origin_monthly_v1",
        "origins": sorted(origins),
        "groups": rows,
        "skipped_observations": skipped,
        "items": len(items),
        "limitations": [
            "Target is observed sales, not latent demand.",
            "Only rows with 12 prior observed months and a year-ago baseline are compared.",
            "Supplier monetary seasonality is an unverified unit proxy.",
            "This is historical model evaluation, not proof of financial savings.",
        ],
    }
