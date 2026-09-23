from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Supplier = Literal["iek", "systeme"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scenario(StrictModel):
    supplier: Supplier | None = None
    category: str | None = Field(default=None, max_length=80)
    lead_time_days: int = Field(default=30, ge=1, le=180)
    review_days: int = Field(default=30, ge=1, le=90)
    safety_days: int = Field(default=14, ge=0, le=90)
    category_safety_days: dict[str, Annotated[int, Field(ge=0, le=90)]] = Field(
        default_factory=dict, max_length=50
    )
    growth_percent: float = Field(default=0, ge=-50, le=200, allow_inf_nan=False)
    remove_outliers: bool = True
    estimate_stockouts: bool = True
    use_seasonality: bool = True
    use_trend: bool = True
    # Explicit demo assumptions, saved on every plan and in every explanation.
    blank_monthly_sales_as_zero: bool = True
    missing_inventory: Literal["latest_snapshot", "zero"] = "latest_snapshot"
    default_minimum: Decimal = Field(default=Decimal("1"), gt=0, le=1000000, decimal_places=4)
    default_multiple: Decimal = Field(default=Decimal("1"), gt=0, le=1000000, decimal_places=4)
    cable_reel_meters: Decimal = Field(default=Decimal("305"), gt=0, le=10000, decimal_places=4)


class CreatePlan(StrictModel):
    dataset_id: UUID
    scenario: Scenario = Field(default_factory=Scenario)


class SampleImport(StrictModel):
    as_of: date = date(2026, 9, 22)


class DraftOrders(StrictModel):
    plan_id: UUID


class LineChange(StrictModel):
    line_id: UUID
    quantity: Decimal = Field(ge=0, le=1000000000, decimal_places=4)
    reason: str = Field(min_length=3, max_length=1000)


class EditOrder(StrictModel):
    revision: int = Field(ge=1)
    lines: list[LineChange] = Field(min_length=1, max_length=5000)


class OrderAction(StrictModel):
    revision: int = Field(ge=1)
