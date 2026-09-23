"""Evaluate imported case data against monthly mean and seasonal naive baselines."""

import json
from pathlib import Path

from optistock.backtest import evaluate
from optistock.db import session
from optistock.models import Dataset, Item
from sqlalchemy import select

with session() as db:
    dataset = db.scalar(select(Dataset).where(Dataset.status == "ready").order_by(Dataset.created_at.desc()))
    if dataset is None:
        raise SystemExit("Import the case data first: python scripts/jury_demo.py")
    items = db.scalars(
        select(Item).where(Item.dataset_id == dataset.id).order_by(Item.supplier, Item.code)
    ).all()
    as_of = dataset.as_of
report = evaluate(items, as_of)
path = Path("var/backtest.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
