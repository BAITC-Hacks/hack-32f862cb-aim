from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from optistock.planning import calculate, cleaned_history
from optistock.schemas import Scenario


def product(available=0, incoming=None, sales=None, **extra):
    history = {f"2025-{m:02d}-01": 310 for m in range(1, 13)}
    history.update({f"2026-{m:02d}-01": 310 for m in range(1, 9)})
    return SimpleNamespace(
        available=available,
        minimum=Decimal("12"),
        multiple=Decimal("6"),
        unit="шт",
        data={
            "sales": sales if sales is not None else history,
            "stocks": {},
            "events": [],
            "incoming": incoming or [],
            **extra,
        },
    )


def test_late_incoming_does_not_erase_earlier_shortage():
    scenario = Scenario(lead_time_days=2, review_days=20, safety_days=0, use_trend=False)
    early = product(incoming=[{"eta": "2026-09-23", "q": 10000}])
    late = product(incoming=[{"eta": "2026-10-10", "q": 10000}])
    q_early, _, _, _ = calculate(early, date(2026, 9, 22), scenario)
    q_late, risk, _, explain = calculate(late, date(2026, 9, 22), scenario)
    assert q_early == 0
    assert q_late > 0 and risk == "critical"
    assert explain["pre_arrival_lost_sales"] > 0


def test_moq_multiple_and_cable_conversion():
    item = product(cable_reels=True)
    quantity, _, _, explanation = calculate(item, date(2026, 9, 22), Scenario())
    assert quantity >= Decimal(12 * 305)
    assert quantity % Decimal(6 * 305) == 0
    assert Decimal(explanation["purchase_quantity"]) * 305 == quantity


def test_incomplete_month_does_not_contaminate_forecast():
    item = product()
    before = calculate(item, date(2026, 9, 22), Scenario())
    item.data["sales"]["2026-09-01"] = 1e9
    after = calculate(item, date(2026, 9, 22), Scenario())
    assert before == after


def test_approved_commitments_reduce_new_orders():
    item = product()
    before = calculate(item, date(2026, 9, 22), Scenario())[0]
    after = calculate(item, date(2026, 9, 22), Scenario(), [{"eta": "2026-09-23", "q": "10000"}])[0]
    assert before > 0 and after == 0


def test_zero_snapshot_correction_is_labelled_and_switchable():
    item = product()
    item.data["sales"]["2026-08-01"] = 1
    item.data["stocks"]["2026-08-01"] = 0
    yes = calculate(item, date(2026, 9, 22), Scenario())[3]
    no = calculate(item, date(2026, 9, 22), Scenario(estimate_stockouts=False))[3]
    assert yes["stockout_adjustments"]
    assert not no["stockout_adjustments"]
    assert "stockout_is_estimated_from_monthly_snapshot" in yes["warnings"]


def test_document_outlier_requires_monthly_reconciliation():
    events = [{"date": f"2026-08-{d:02d}", "q": 10, "document": str(d)} for d in range(1, 21)]
    events.append({"date": "2026-08-21", "q": 5000, "document": "project"})
    data = {"sales": {"2026-08-01": 5200}, "stocks": {}, "events": events}
    corrected, exclusions, _, _ = cleaned_history(
        data, date(2026, 9, 22), Scenario(estimate_stockouts=False), [1] * 12
    )
    assert corrected["2026-08-01"] == 250
    assert exclusions[0]["document"] == "project"
    data["sales"]["2026-08-01"] = 7000
    corrected, exclusions, _, warnings = cleaned_history(data, date(2026, 9, 22), Scenario(), [1] * 12)
    assert not exclusions
    assert "transaction_month_mismatch_outlier_not_applied" in warnings


def test_deterministic_and_growth_increases_demand():
    item = product()
    base = calculate(item, date(2026, 9, 22), Scenario())
    assert base == calculate(item, date(2026, 9, 22), Scenario())
    high = calculate(item, date(2026, 9, 22), Scenario(growth_percent=50))
    assert high[3]["forecast_quantity"] > base[3]["forecast_quantity"]


def test_category_policy_changes_buffer_without_inventing_category_meaning():
    item = product()
    item.category = "7"
    base = calculate(item, date(2026, 9, 22), Scenario(safety_days=0))
    policy = calculate(item, date(2026, 9, 22), Scenario(safety_days=0, category_safety_days={"7": 30}))
    assert policy[0] > base[0]
    assert policy[3]["effective_safety_days"] == 30


def test_missing_history_is_not_reported_as_covered():
    quantity, risk, _, _ = calculate(product(sales={}), date(2026, 9, 22), Scenario())
    assert quantity == 0 and risk == "insufficient_data"


def test_sparse_demand_is_not_trimmed_to_zero_or_filled_as_stockout():
    sales = {f"2025-{m:02d}-01": 0 for m in range(1, 13)}
    sales["2025-12-01"] = 12
    item = product(sales=sales, stocks={p: 0 for p in sales})
    _, _, _, explanation = calculate(item, date(2026, 1, 1), Scenario())
    assert explanation["forecast_quantity"] > 0
    assert not explanation["stockout_adjustments"]
