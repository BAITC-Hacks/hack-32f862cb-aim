from copy import deepcopy
from datetime import date

from optistock.backtest import evaluate, forecast_at_origin
from optistock.schemas import Scenario
from test_planning import product


def test_backtest_cannot_observe_target_future_transactions_or_seasonality():
    item = product()
    item.category = None
    origin = date(2026, 7, 1)
    before = forecast_at_origin(item, origin, Scenario())
    future = deepcopy(item)
    future.available = 1e9
    future.data["sales"]["2026-07-01"] = 1e9
    future.data["sales"]["2026-08-01"] = 1e9
    future.data["events"] = [{"date": "2026-07-12", "q": 1e9, "document": "future"}]
    future.data["seasonality"] = [{"year": 2026, "values": [1e9] + [0] * 11}]
    future.data["stocks"]["2026-07-01"] = 0
    assert forecast_at_origin(future, origin, Scenario()) == before


def test_backtest_compares_same_observations_and_handles_zero_denominator():
    item = product(
        sales={f"{year}-{month:02d}-01": 0 for year in (2024, 2025, 2026) for month in range(1, 13)}
    )
    item.category, item.supplier = None, "iek"
    result = evaluate([item], date(2026, 9, 22))
    assert result["origins"] == ["2026-06-01", "2026-07-01", "2026-08-01"]
    group = result["groups"][0]
    assert group["observations"] == 3
    assert all(m["mae"] == 0 and m["wape"] is None for m in group["models"].values())
