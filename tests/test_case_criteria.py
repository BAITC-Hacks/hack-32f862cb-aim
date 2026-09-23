"""Controlled factor tests for the five requirements in LOGISTICS_CASE.md."""

from copy import deepcopy
from datetime import date

from optistock.planning import calculate
from optistock.schemas import Scenario
from test_planning import product

AS_OF = date(2026, 9, 1)
BASE = Scenario(lead_time_days=1, review_days=30, safety_days=0, estimate_stockouts=False, use_trend=False)


def test_sales_stock_incoming_category_and_growth_each_change_order():
    item = product()
    baseline = calculate(item, AS_OF, BASE)[0]
    more_sales = product(sales={k: v * 2 for k, v in item.data["sales"].items()})
    assert calculate(more_sales, AS_OF, BASE)[0] > baseline
    assert calculate(product(available=100), AS_OF, BASE)[0] < baseline
    incoming = product(incoming=[{"eta": "2026-09-02", "q": 100}])
    assert calculate(incoming, AS_OF, BASE)[0] < baseline
    item.category = "electrical"
    assert (
        calculate(item, AS_OF, BASE.model_copy(update={"category_safety_days": {"electrical": 20}}))[0]
        > baseline
    )
    assert calculate(item, AS_OF, BASE.model_copy(update={"growth_percent": 50}))[0] > baseline


def test_seasonality_and_sustained_growth_change_forecast():
    item = product(seasonality=[{"year": 2025, "values": [1] * 8 + [3, 3, 1, 1]}])
    seasonal = calculate(item, AS_OF, BASE)[3]
    flat = calculate(item, AS_OF, BASE.model_copy(update={"use_seasonality": False}))[3]
    assert seasonal["forecast_quantity"] > flat["forecast_quantity"] * 1.5
    item = product()
    item.data["sales"].update({f"2026-{m:02d}-01": 465 for m in range(1, 9)})
    trend = calculate(item, AS_OF, BASE.model_copy(update={"use_trend": True}))[3]
    no_trend = calculate(item, AS_OF, BASE)[3]
    assert trend["annual_trend_ratio"] == 1.5
    assert trend["forecast_quantity"] > no_trend["forecast_quantity"]


def test_stockout_correction_increases_demand_and_order():
    item = product()
    # Several lost-demand months avoid hiding the effect behind the robust mean trim.
    for month in (6, 7, 8):
        item.data["sales"][f"2026-{month:02d}-01"] = 0
        item.data["stocks"][f"2026-{month:02d}-01"] = 0
    raw = calculate(item, AS_OF, BASE)
    corrected = calculate(item, AS_OF, BASE.model_copy(update={"estimate_stockouts": True}))
    assert corrected[0] > raw[0]
    assert corrected[3]["forecast_quantity"] > raw[3]["forecast_quantity"]
    assert len(corrected[3]["stockout_adjustments"]) == 3


def test_one_off_project_sale_does_not_distort_regular_order():
    sales = {f"2026-{m:02d}-01": 200 for m in range(1, 9)}
    events = [
        {"date": f"2026-{m:02d}-{d:02d}", "q": 10, "document": f"{m}-{d}"}
        for m in range(1, 9)
        for d in range(1, 21)
    ]
    item = product(sales=sales, events=events)
    normal = calculate(item, AS_OF, BASE)[0]
    spike = deepcopy(item)
    spike.data["sales"]["2026-08-01"] += 5000
    spike.data["events"].append({"date": "2026-08-21", "q": 5000, "document": "one-off-project"})
    clean = calculate(spike, AS_OF, BASE)
    raw = calculate(spike, AS_OF, BASE.model_copy(update={"remove_outliers": False}))
    assert abs(clean[0] - normal) / normal < 0.1
    assert raw[0] > normal * 2
    assert clean[3]["outlier_exclusions"][0]["document"] == "one-off-project"


def test_repeated_wholesale_demand_is_preserved():
    item = product(sales={f"2026-{m:02d}-01": 200 for m in range(1, 9)})
    item.data["events"] = [
        {"date": f"2026-{m:02d}-{d:02d}", "q": 10, "document": f"{m}-{d}"}
        for m in range(1, 9)
        for d in range(1, 21)
    ]
    for month in (6, 7, 8):
        item.data["sales"][f"2026-{month:02d}-01"] += 5000
        item.data["events"].append(
            {"date": f"2026-{month:02d}-21", "q": 5000, "document": f"regular-{month}"}
        )
    assert not calculate(item, AS_OF, BASE)[3]["outlier_exclusions"]


def short_history_with_one_document(spike_months=(8,)):
    """Six observed months of steady demand, plus a single large project document."""
    sales = {f"2026-{m:02d}-01": 10 for m in range(3, 9)}
    events = []
    for month in spike_months:
        sales[f"2026-{month:02d}-01"] += 5000
        events.append({"date": f"2026-{month:02d}-21", "q": 5000, "document": f"project-{month}"})
    return product(sales=sales, events=events)


def test_one_off_document_on_a_short_history_does_not_inflate_the_regular_order():
    baseline = calculate(product(sales={f"2026-{m:02d}-01": 10 for m in range(3, 9)}), AS_OF, BASE)[0]
    item = short_history_with_one_document()
    clean, _, _, explanation = calculate(item, AS_OF, BASE)
    raw = calculate(item, AS_OF, BASE.model_copy(update={"remove_outliers": False}))[0]
    # Fewer than eight documents used to disable outlier handling entirely.
    assert explanation["outlier_exclusions"][0]["method"] == "monthly_median_fallback"
    assert raw > baseline * 10
    assert clean <= baseline * 2


def test_short_history_fallback_preserves_repeated_wholesale_demand():
    item = short_history_with_one_document(spike_months=(6, 7, 8))
    assert not calculate(item, AS_OF, BASE)[3]["outlier_exclusions"]


def test_too_short_history_reports_insufficient_data_instead_of_guessing():
    sales = {"2026-07-01": 10, "2026-08-01": 5010}
    item = product(sales=sales, events=[{"date": "2026-08-21", "q": 5000, "document": "project"}])
    explanation = calculate(item, AS_OF, BASE)[3]
    assert not explanation["outlier_exclusions"]
    assert "insufficient_history_for_outlier_detection" in explanation["warnings"]
    assert "short_history" in explanation["warnings"]
