"""Exercise the running API against the provided sample files; no direct DB writes."""

import argparse
import json
import time
import uuid
from pathlib import Path

import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8000")
parser.add_argument("--key-file", type=Path, default=Path("var/admin.key"))
args = parser.parse_args()
token = args.key_file.read_text().strip()
client = httpx.Client(base_url=args.url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
started = time.monotonic()


def get(path):
    response = client.get(path)
    response.raise_for_status()
    return response.json()


def post(path, body, key=None):
    response = client.post(path, json=body, headers={"Idempotency-Key": key or uuid.uuid4().hex})
    response.raise_for_status()
    return response.json()


def wait(identifier):
    deadline, previous = time.monotonic() + 1000, None
    while time.monotonic() < deadline:
        job = get(f"/api/v1/jobs/{identifier}")
        state = (job["status"], job["progress"].get("stage"), job["progress"].get("file"))
        if state != previous:
            print("Job", identifier, state, flush=True)
            previous = state
        if job["status"] == "succeeded":
            return
        if job["status"] == "failed":
            raise RuntimeError(job["error"])
        time.sleep(2)
    raise TimeoutError("Job exceeded demo timeout")


get("/health/ready")
imported = post("/api/v1/datasets/sample", {"as_of": "2026-09-22"}, "demo-samples-v1")
wait(imported["job_id"])
dataset = get(f"/api/v1/datasets/{imported['dataset_id']}")
print("Imported", dataset["summary"], flush=True)
plan = post("/api/v1/plans", {"dataset_id": dataset["id"], "scenario": {"lead_time_days": 30}})
wait(plan["job_id"])
result = get(f"/api/v1/plans/{plan['plan_id']}")
orders = post("/api/v1/orders", {"plan_id": result["id"]})
exports = []
for identifier in orders["order_ids"]:
    order = get(f"/api/v1/orders/{identifier}")
    first = order["lines"][0]
    response = client.patch(
        f"/api/v1/orders/{identifier}",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={
            "revision": order["revision"],
            "lines": [
                {
                    "line_id": first["id"],
                    "quantity": first["quantity"],
                    "reason": "Проверено в демонстрационном сценарии",
                }
            ],
        },
    )
    response.raise_for_status()
    approved = post(f"/api/v1/orders/{identifier}/approve", {"revision": response.json()["revision"]})
    response = client.get(f"/api/v1/orders/{identifier}/export")
    response.raise_for_status()
    path = Path("var") / f"optistock-{order['supplier']}-{identifier}.csv"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(response.content)
    exports.append(
        {
            "order_id": identifier,
            "supplier": order["supplier"],
            "lines": len(order["lines"]),
            "revision": approved["revision"],
            "file": str(path),
        }
    )
summary = {
    "dataset_id": dataset["id"],
    "dataset": dataset["summary"],
    "plan_id": result["id"],
    "plan": result["summary"],
    "orders": exports,
    "elapsed_seconds": round(time.monotonic() - started, 1),
}
Path("var/demo-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps(summary, ensure_ascii=False, indent=2))
