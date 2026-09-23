"""Exercise actual HTTP import -> agent -> persistent supplier drafts. No approvals."""

import argparse
import json
import time
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--key-file", default="var/local/api-key")
    args = parser.parse_args()
    key = Path(args.key_file).read_text().strip()
    with httpx.Client(base_url=args.base, headers={"Authorization": f"Bearer {key}"}, timeout=60) as client:

        def post(path, payload, key):
            response = client.post(path, json=payload, headers={"Idempotency-Key": key})
            response.raise_for_status()
            return response.json()

        def wait(identifier):
            previous = None
            for _ in range(1200):
                response = client.get(f"/jobs/{identifier}")
                response.raise_for_status()
                job = response.json()
                stage = (job["status"], job["progress"].get("stage"))
                if stage != previous:
                    print(json.dumps({"status": job["status"], "progress": job["progress"]}), flush=True)
                    previous = stage
                if job["status"] == "failed":
                    raise RuntimeError(job["error"])
                if job["status"] == "succeeded":
                    return
                time.sleep(1)
            raise TimeoutError("Worker did not finish within 20 minutes")

        started = time.monotonic()
        dataset = post("/datasets/sample", {"as_of": "2026-09-22"}, "jury-source-files-v1")
        wait(dataset["job_id"])
        agent = post("/agent/runs", {"dataset_id": dataset["dataset_id"], "scenario": {}}, "jury-agent-v1")
        wait(agent["job_id"])
        run = client.get(f"/agent/runs/{agent['run_id']}").json()
        output = Path("var/jury-agent-report.json")
        output.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {
                    "run_id": run["id"],
                    "summary": run["report"]["summary"],
                    "orders": run["report"]["order_ids"],
                    "elapsed_seconds": round(time.monotonic() - started, 1),
                    "report": str(output),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
