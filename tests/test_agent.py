import uuid

import pytest
from optistock.db import session
from optistock.errors import DomainError, LeaseLost
from optistock.models import AgentRun, Credential, Item, PurchaseOrder, Recommendation
from optistock.services import execute_job
from optistock.worker import claim, fail
from sqlalchemy import func, select
from test_workflow import post, seed


def test_agent_groups_drafts_explains_all_lines_and_never_approves(client):
    dataset_id = seed()
    payload = {"dataset_id": dataset_id}
    started = post(client, "/api/v1/agent/runs", payload, "agent-once")
    assert started.status_code == 202, started.text
    result = started.json()
    assert post(client, "/api/v1/agent/runs", payload, "agent-once").json() == result
    duplicate = post(client, "/api/v1/agent/runs", payload).json()
    assert duplicate["run_id"] == result["run_id"] and duplicate["reused"]
    lease = claim()
    execute_job(*lease)
    run = client.get(f"/api/v1/agent/runs/{result['run_id']}").json()
    assert run["status"] == "succeeded"
    assert len(run["report"]["steps"]) == 5
    assert run["report"]["quality"]["items"] == 2
    assert run["report"]["summary"]["order_lines"] == 2
    assert len(run["report"]["order_ids"]) == 2
    for identifier in run["report"]["order_ids"]:
        order = client.get(f"/api/v1/orders/{identifier}").json()
        assert order["status"] == "draft" and len(order["lines"]) == 1
        assert client.get(f"/api/v1/orders/{identifier}/export").status_code == 409
    recommendations = client.get(f"/api/v1/plans/{result['plan_id']}/recommendations").json()["items"]
    for row in recommendations:
        exp = client.get(f"/api/v1/recommendations/{row['id']}").json()["explanation"]
        assert (
            exp["text"] and exp["daily_projection"] and float(exp["order_quantity"]) == float(row["quantity"])
        )
    with pytest.raises(LeaseLost):
        execute_job(*lease)
    with session() as db:
        assert db.scalar(select(func.count()).select_from(PurchaseOrder)) == 2
    assert len(client.get(f"/api/v1/agent/runs?dataset_id={dataset_id}").json()["items"]) == 1


def test_agent_cannot_be_started_by_viewer_or_given_an_approval_tool(client):
    payload = {"dataset_id": seed()}
    response = client.post(
        "/api/v1/agent/runs",
        json=payload,
        headers={"Authorization": "Bearer test-viewer", "Idempotency-Key": "viewer"},
    )
    assert response.status_code == 403
    assert post(client, "/api/v1/agent/runs", {**payload, "auto_approve": True}).status_code == 422


def test_agent_failed_validation_leaves_no_partial_drafts_and_can_retry(client):
    dataset_id = seed()
    with session() as db, db.begin():
        for item in db.scalars(select(Item)):
            item.data = {**item.data, "sales": {}}
    result = post(client, "/api/v1/agent/runs", {"dataset_id": dataset_id}).json()
    lease = claim()
    with pytest.raises(DomainError) as caught:
        execute_job(*lease)
    assert caught.value.code == "no_sales_history"
    fail(*lease, {"code": caught.value.code, "message": caught.value.message})
    assert client.get(f"/api/v1/agent/runs/{result['run_id']}").json()["status"] == "failed"
    with session() as db:
        assert db.scalar(select(func.count()).select_from(Recommendation)) == 0
        assert db.scalar(select(func.count()).select_from(PurchaseOrder)) == 0
    assert post(client, f"/api/v1/jobs/{result['job_id']}/retry", {}).status_code == 202


def test_revoked_planner_cannot_publish_agent_orders(client):
    result = post(client, "/api/v1/agent/runs", {"dataset_id": seed()}).json()
    lease = claim()
    with session() as db, db.begin():
        run = db.get(AgentRun, uuid.UUID(result["run_id"]))
        db.get(Credential, run.created_by).active = False
    with pytest.raises(DomainError, match="Права"):
        execute_job(*lease)
    with session() as db:
        assert db.scalar(select(func.count()).select_from(Recommendation)) == 0
        assert db.scalar(select(func.count()).select_from(PurchaseOrder)) == 0


def test_agent_counts_multi_product_documents_once_within_supplier(client):
    from copy import deepcopy

    dataset_id = seed()
    with session() as db, db.begin():
        items = db.scalars(select(Item)).all()
        for item in items:
            data = deepcopy(item.data)
            data["sales"]["2026-08-01"] = 5200
            data["events"] = [
                {"date": f"2026-08-{d:02d}", "q": 10, "document": str(d)} for d in range(1, 21)
            ] + [{"date": "2026-08-21", "q": 5000, "document": "shared-project"}]
            item.data = data
        item = items[0]
        db.add(
            Item(
                dataset_id=item.dataset_id,
                supplier=item.supplier,
                code="second-product",
                name="Second line in same document",
                unit=item.unit,
                available=0,
                minimum=1,
                multiple=1,
                data=deepcopy(item.data),
            )
        )
    result = post(client, "/api/v1/agent/runs", {"dataset_id": dataset_id}).json()
    execute_job(*claim())
    summary = client.get(f"/api/v1/agent/runs/{result['run_id']}").json()["report"]["summary"]
    assert summary["outlier_corrections"] == 3
    assert summary["excluded_documents"] == 2  # The same document number in two supplier scopes.
