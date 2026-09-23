from datetime import date
from pathlib import Path

import pytest
from optistock.ingestion import parse_sources
from optistock.services import sample_sources


@pytest.mark.skipif(not Path("IEK").exists(), reason="Original hackathon fixtures not present")
def test_all_twelve_original_workbooks_import_without_silent_row_loss():
    sources = [{**s, "id": str(i)} for i, s in enumerate(sample_sources())]
    items, kinds = parse_sources(sources, date(2026, 9, 22))
    assert len(kinds) == 12
    assert len(items) == 3909
    assert len({(p.supplier, p.code) for p in items}) == len(items)
    assert sum(len(p.data["events"]) for p in items) == 248884
    assert sum(len(p.data.get("skipped_transaction_rows", [])) for p in items) == 31
    assert sum(bool(p.data["sales"]) for p in items) == 3017
    assert any(p.data.get("raw_invalid_moq") for p in items)
    assert any(p.available is not None for p in items if p.supplier == "systeme")
    assert any(p.data["incoming"] for p in items if p.supplier == "iek")
