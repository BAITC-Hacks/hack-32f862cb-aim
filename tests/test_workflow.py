import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal

import pytest
from optistock.db import session
from optistock.errors import LeaseLost
from optistock.models import Dataset, Item, Job, Recommendation, utcnow
from optistock.services import check_lease, execute_job
from optistock.worker import claim
from sqlalchemy import func, select
from test_planning import product


def seed():
    with session() as db, db.begin():
        dataset = Dataset(signature=uuid.uuid4().hex, as_of=date(2026, 9, 22), status="ready")
        db.add(dataset)
        db.flush()
        for supplier in ("iek", "systeme"):
            p = product()
            db.add(
                Item(
                    dataset_id=dataset.id,
                    supplier=supplier,
                    code="001_",
                    name="=formula",
                    unit="шт",
                    available=Decimal(0),
                    minimum=p.minimum,
                    multiple=p.multiple,
                    data=p.data,
                )
            )
        return str(dataset.id)


def post(client, path, body, key=None):
    return client.post(path, json=body, headers={"Idempotency-Key": key or uuid.uuid4().hex})


def build_plan(client, dataset_id):
    response = post(client, "/api/v1/plans", {"dataset_id": dataset_id})
    assert response.status_code == 202, response.text
    execute_job(*claim())
    return response.json()["plan_id"]


def make_order(client, plan_id):
    response = post(client, "/api/v1/orders", {"plan_id": plan_id})
    assert response.status_code == 201, response.text
    return response.json()["order_ids"][0]


def test_full_workflow_revision_approval_export_and_audit(client):
    dataset = seed()
    plan = build_plan(client, dataset)
    detail = client.get(f"/api/v1/plans/{plan}").json()
    assert detail["status"] == "ready" and detail["summary"]["reorder_items"] == 2
    order = make_order(client, plan)
    assert client.get(f"/api/v1/orders/{order}/export").status_code == 409
    draft = client.get(f"/api/v1/orders/{order}").json()
    change = {
        "revision": 1,
        "lines": [{"line_id": draft["lines"][0]["id"], "quantity": "1200", "reason": "Тестовый сценарий"}],
    }
    result = client.patch(f"/api/v1/orders/{order}", json=change, headers={"Idempotency-Key": "edit"})
    assert result.status_code == 200, result.text
    assert (
        client.patch(f"/api/v1/orders/{order}", json=change, headers={"Idempotency-Key": "stale"}).status_code
        == 409
    )
    approved = post(client, f"/api/v1/orders/{order}/approve", {"revision": 2}, "approve")
    assert approved.status_code == 200, approved.text
    assert (
        post(client, f"/api/v1/orders/{order}/approve", {"revision": 2}, "approve").json() == approved.json()
    )
    export = client.get(f"/api/v1/orders/{order}/export")
    assert export.status_code == 200 and "'=formula" in export.text
    assert "1200" in export.text
    assert any(
        e["action"] == "order.approve" for e in client.get(f"/api/v1/audit?entity_id={order}").json()["items"]
    )
    assert post(client, f"/api/v1/orders/{order}/cancel", {"revision": 3}).status_code == 200
    assert client.get(f"/api/v1/orders/{order}/export").status_code == 409


def test_authentication_and_role_cannot_be_claimed_by_header(client):
    assert client.get("/api/v1/datasets", headers={"Authorization": "Bearer bad"}).status_code == 401
    response = post(client, "/api/v1/plans", {"dataset_id": seed()}, "once")
    assert response.status_code == 202
    assert (
        client.post(
            "/api/v1/plans",
            json={"dataset_id": seed()},
            headers={"Authorization": "Bearer test-viewer", "X-User-Role": "admin", "Idempotency-Key": "x"},
        ).status_code
        == 403
    )


def test_idempotency_conflict_and_concurrent_same_key(client):
    dataset = seed()
    body = {"dataset_id": dataset}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: post(client, "/api/v1/plans", body, "same"), range(2)))
    assert all(r.status_code == 202 for r in responses)
    assert responses[0].json() == responses[1].json()
    conflict = post(
        client, "/api/v1/plans", {"dataset_id": dataset, "scenario": {"lead_time_days": 10}}, "same"
    )
    assert conflict.status_code == 409
    with session() as db:
        assert db.scalar(select(func.count()).select_from(Job)) == 1


def test_two_plans_cannot_double_approve_same_supply(client):
    dataset = seed()
    first = build_plan(client, dataset)
    second = build_plan(client, dataset)
    order1, order2 = make_order(client, first), make_order(client, second)
    assert post(client, f"/api/v1/orders/{order1}/approve", {"revision": 1}).status_code == 200
    response = post(client, f"/api/v1/orders/{order2}/approve", {"revision": 1})
    assert response.status_code == 409 and response.json()["code"] == "stale_plan"
    newer = build_plan(client, dataset)
    rows = client.get(f"/api/v1/plans/{newer}/recommendations").json()["items"]
    supplier = client.get(f"/api/v1/orders/{order1}").json()["supplier"]
    assert next(float(r["quantity"]) for r in rows if r["supplier"] == supplier) < 1200


def test_simultaneous_approvals_accept_only_one_plan(client):
    dataset = seed()
    orders = [make_order(client, build_plan(client, dataset)) for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda order: post(client, f"/api/v1/orders/{order}/approve", {"revision": 1}), orders)
        )
    assert sorted(r.status_code for r in responses) == [200, 409]


def test_expired_worker_cannot_publish_and_job_is_reclaimed(client):
    post(client, "/api/v1/plans", {"dataset_id": seed()})
    identifier, old_token = claim()
    with session() as db, db.begin():
        db.get(Job, identifier).lease_until = utcnow() - timedelta(seconds=1)
    same_id, new_token = claim()
    assert identifier == same_id and new_token != old_token
    with session() as db, db.begin(), pytest.raises(LeaseLost):
        check_lease(db, identifier, old_token)
    execute_job(identifier, new_token)
    with session() as db:
        assert db.get(Job, identifier).status == "succeeded"
        assert db.scalar(select(func.count()).select_from(Recommendation)) == 2


def test_invalid_xlsx_fails_before_a_job_is_created(client):
    response = client.post(
        "/api/v1/datasets/upload",
        data={"supplier": "iek", "as_of": "2026-09-22"},
        files=[("files", ("bad.xlsx", b"not a zip", "application/octet-stream"))],
        headers={"Idempotency-Key": "bad-file"},
    )
    assert response.status_code == 400
    with session() as db:
        assert db.scalar(select(func.count()).select_from(Job)) == 0


def test_failed_import_does_not_publish_partial_dataset(client):
    from optistock.models import SourceFile
    from optistock.worker import run_child

    with session() as db, db.begin():
        dataset = Dataset(signature=uuid.uuid4().hex, as_of=date(2026, 9, 22))
        db.add(dataset)
        db.flush()
        db.add(SourceFile(dataset_id=dataset.id, supplier="iek", name="missing.xlsx", sha256="0" * 64))
        db.add(Job(kind="import", resource_id=dataset.id))
        identifier = dataset.id
    for _ in range(3):
        run_child(*claim())
    with session() as db:
        assert db.get(Dataset, identifier).status == "failed"
        assert db.scalar(select(func.count()).select_from(Item)) == 0


def test_invalid_quantities_and_unknown_parameters_rejected(client):
    dataset = seed()
    assert (
        post(client, "/api/v1/plans", {"dataset_id": dataset, "scenario": {"lead_time_days": 0}}).status_code
        == 422
    )
    assert (
        post(
            client, "/api/v1/plans", {"dataset_id": dataset, "scenario": {"pretend_confidence": 0.99}}
        ).status_code
        == 422
    )
