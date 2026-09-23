"""AI assistant: access rules, the server tool registry, and the function-calling loop.

The provider call is stubbed. These tests assert that tools stay inside the run's plan, that the
loop honours its budgets, and that the model never gets a way to change an order.
"""

import uuid

import pytest
from optistock import assistant, tools
from optistock.config import settings
from optistock.db import session
from optistock.errors import DomainError
from optistock.models import AssistantRun, Item, Plan
from optistock.services import execute_job
from optistock.worker import claim
from pydantic import SecretStr
from sqlalchemy import select
from test_workflow import build_plan, post, seed


@pytest.fixture
def ai():
    config = settings()
    before = (config.openai_api_key, config.ai_max_tool_calls, config.ai_max_steps)
    config.openai_api_key = SecretStr("test-key")
    yield config
    config.openai_api_key, config.ai_max_tool_calls, config.ai_max_steps = before


def message(text="Готово."):
    return {
        "id": "resp_msg",
        "status": "completed",
        "model": "test-model",
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
    }


def function_call(name, arguments="{}", call_id="c1"):
    return {
        "id": "resp_call",
        "status": "completed",
        "model": "test-model",
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        "output": [{"type": "function_call", "call_id": call_id, "name": name, "arguments": arguments}],
    }


def scripted(monkeypatch, bodies):
    """Replace the provider call with a fixed script and record what the loop sent."""
    sent = []

    def fake(client, model, payload_input, use_tools):
        sent.append({"input": list(payload_input), "tools": use_tools})
        return bodies[min(len(sent) - 1, len(bodies) - 1)]

    monkeypatch.setattr(assistant, "call_responses", fake)
    return sent


def plan_context(client):
    plan_id = build_plan(client, seed())
    with session() as db:
        plan = db.scalar(select(Plan).where(Plan.id == uuid.UUID(plan_id)))
        assert plan.status == "ready"
    return plan_id


def ctx(plan_id):
    return {"plan_id": uuid.UUID(plan_id), "compare_calls": 0}


def test_assistant_requires_configuration_and_a_planning_role(client):
    plan_id = plan_context(client)
    settings().openai_api_key = SecretStr("")
    unconfigured = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id})
    assert unconfigured.status_code == 503 and unconfigured.json()["code"] == "ai_not_configured"
    settings().openai_api_key = SecretStr("test-key")
    try:
        viewer = client.post(
            "/api/v1/assistant/runs",
            json={"plan_id": plan_id},
            headers={"Authorization": "Bearer test-viewer", "Idempotency-Key": "viewer"},
        )
        assert viewer.status_code == 403
    finally:
        settings().openai_api_key = SecretStr("")


def test_status_advertises_the_tool_registry(client):
    status = client.get("/api/v1/assistant/status").json()
    assert status["function_calling"] is True
    assert {t["name"] for t in status["tools"]} == set(tools.REGISTRY)
    assert status["limits"]["max_tool_calls"] >= 1


def test_tools_stay_inside_the_plan_and_never_mutate_orders(client, ai):
    plan_id = plan_context(client)
    context = ctx(plan_id)
    summary = tools.get_plan_summary(context, {})
    assert summary["items_total"] == 2
    assert summary["order_quantity_by_supplier_and_unit"]

    found = tools.find_items(context, {"query": "001", "limit": 5})
    assert found["matched"] == 2 and found["items"][0]["code"] == "001_"
    assert tools.find_items(context, {"supplier": "iek"})["matched"] == 1

    detail = tools.explain_item(context, {"code": "001_"})
    assert detail["forecast_quantity"] > 0 and detail["projection_days"] > 0
    # Document numbers must never reach the model.
    assert all("document" not in row for row in detail["outlier_exclusions"])

    history = tools.sales_history(context, {"code": "001_"})
    assert history["raw_monthly_sales"] and len(history["seasonality_profile"]) == 12

    with pytest.raises(DomainError) as missing:
        tools.explain_item(context, {"code": "no-such-code"})
    assert missing.value.code == "item_outside_plan"

    with pytest.raises(DomainError) as scope:
        tools.compare_scenario(context, {"supplier": "iek"})
    assert scope.value.code == "scenario_scope"

    with pytest.raises(DomainError) as bad:
        tools.compare_scenario(context, {"lead_time_days": 9999})
    assert bad.value.code == "bad_tool_argument"

    comparison = tools.compare_scenario(ctx(plan_id), {"safety_days": 60})
    assert comparison["items_total"] == 2 and comparison["items_changed"] == 2
    assert comparison["compared_scenario"]["safety_days"] == 60
    assert all(float(row["delta"]) > 0 for row in comparison["top_changes"])
    # A hypothetical comparison leaves the stored plan untouched.
    with session() as db:
        stored = db.scalar(select(Plan).where(Plan.id == uuid.UUID(plan_id)))
        assert stored.parameters["safety_days"] == 14


def test_compare_scenario_has_a_per_run_budget(client, ai):
    context = ctx(plan_context(client))
    for _ in range(tools.COMPARE_CALL_BUDGET):
        tools.compare_scenario(context, {"safety_days": 20})
    with pytest.raises(DomainError) as exceeded:
        tools.compare_scenario(context, {"safety_days": 21})
    assert exceeded.value.code == "tool_budget"


def test_run_tool_rejects_unknown_names_and_malformed_arguments(client, ai):
    context = ctx(plan_context(client))
    assert tools.run_tool(context, "drop_orders", "{}") == (
        {"error": "unknown_tool", "message": "Инструмент недоступен"},
        False,
    )
    assert tools.run_tool(context, "find_items", "not json")[1] is False
    assert tools.run_tool(context, "find_items", "[1,2]")[1] is False
    assert tools.run_tool(context, "find_items", '{"x":"' + "a" * 9000 + '"}')[1] is False
    assert tools.run_tool(context, "find_items", '{"risk":"made_up"}') == (
        {"error": "bad_tool_argument", "message": "Недопустимое значение risk"},
        False,
    )
    payload, ok = tools.run_tool(context, "find_items", '{"limit": 3.0}')
    assert ok and payload["limit"] == 3


def test_loop_executes_tools_and_persists_answer_with_provenance(client, ai, monkeypatch):
    plan_id = plan_context(client)
    sent = scripted(
        monkeypatch,
        [
            function_call("get_plan_summary", "{}", "c1"),
            function_call("explain_item", '{"code": "001_"}', "c2"),
            message("Заказ обоснован прогнозом и страховым запасом."),
        ],
    )
    started = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id, "task": "risks"})
    assert started.status_code == 202, started.text
    execute_job(*claim())

    run = client.get(f"/api/v1/assistant/runs/{started.json()['run_id']}").json()
    assert run["status"] == "ready" and run["job"]["status"] == "succeeded"
    result = run["result"]
    assert result["answer"].startswith("Заказ обоснован")
    assert [c["name"] for c in result["tool_calls"]] == ["get_plan_summary", "explain_item"]
    assert all(c["ok"] for c in result["tool_calls"])
    assert result["usage"]["total_tokens"] == 45 and result["steps"] == 3
    # Verifiable numbers are stored beside the model's prose.
    assert result["facts"]["items_total"] == 2 and result["facts"]["limitations"]

    # The loop fed every tool result back and stopped offering tools once it had an answer.
    outputs = [i for i in sent[-1]["input"] if i.get("type") == "function_call_output"]
    assert len(outputs) == 2
    assert all(entry["tools"] for entry in sent[:-1])


def test_loop_stops_at_the_tool_call_budget_and_still_answers(client, ai, monkeypatch):
    plan_id = plan_context(client)
    ai.ai_max_tool_calls = 1
    ai.ai_max_steps = 3
    sent = scripted(
        monkeypatch,
        [
            function_call("get_plan_summary", "{}", "c1"),
            function_call("get_plan_summary", "{}", "c2"),
            function_call("get_plan_summary", "{}", "c3"),
            message("Ответ по собранным данным."),
        ],
    )
    started = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id})
    assert started.status_code == 202
    execute_job(*claim())
    result = client.get(f"/api/v1/assistant/runs/{started.json()['run_id']}").json()["result"]
    assert result["answer"] == "Ответ по собранным данным."
    refused = [c for c in result["tool_calls"] if c["error"] == "tool_budget"]
    assert len(result["tool_calls"]) == 3 and len(refused) == 2
    # The final turn is asked without tools so a capped run still produces an answer.
    assert sent[-1]["tools"] is False


def test_second_concurrent_request_is_rejected_then_the_hourly_limit_applies(client, ai, monkeypatch):
    plan_id = plan_context(client)
    scripted(monkeypatch, [message()])
    first = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id, "question": "Первый вопрос"})
    assert first.status_code == 202
    busy = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id, "question": "Второй вопрос"})
    assert busy.status_code == 429 and busy.json()["code"] == "ai_busy"
    execute_job(*claim())
    ai.ai_requests_per_hour = 1
    try:
        limited = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id, "question": "Третий вопрос"})
        assert limited.status_code == 429 and limited.json()["code"] == "ai_rate_limit"
    finally:
        ai.ai_requests_per_hour = 30


def test_results_are_private_to_their_author(client, ai, monkeypatch):
    plan_id = plan_context(client)
    scripted(monkeypatch, [message()])
    run_id = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id}).json()["run_id"]
    execute_job(*claim())
    other = client.get(
        f"/api/v1/assistant/runs/{run_id}", headers={"Authorization": "Bearer test-planner"}
    )
    assert other.status_code in (403, 404)


def test_item_scope_is_validated_before_any_provider_call(client, ai):
    plan_id = plan_context(client)
    with session() as db:
        foreign = db.scalar(select(Item.id).where(Item.dataset_id.is_not(None)))
    explain = post(client, "/api/v1/assistant/runs", {"plan_id": plan_id, "task": "explain"})
    assert explain.status_code == 422 and explain.json()["code"] == "item_required"
    outside = post(
        client,
        "/api/v1/assistant/runs",
        {"plan_id": plan_id, "task": "explain", "item_id": str(uuid.uuid4())},
    )
    assert outside.status_code == 422 and outside.json()["code"] == "item_outside_plan"
    assert foreign is not None
    with session() as db:
        assert db.scalar(select(AssistantRun.id)) is None
