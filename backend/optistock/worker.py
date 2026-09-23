"""PostgreSQL durable jobs, bounded retries, renewable leases, and fenced publication."""

import argparse
import logging
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import timedelta

from sqlalchemy import or_, select, update

from optistock.config import settings
from optistock.db import session
from optistock.errors import DomainError, LeaseLost
from optistock.models import Dataset, Job, Plan, utcnow
from optistock.services import execute_job

log = logging.getLogger("optistock.worker")


def claim():
    with session() as db, db.begin():
        job = db.scalar(
            select(Job)
            .where(or_(Job.status == "queued", (Job.status == "running") & (Job.lease_until < utcnow())))
            .order_by(Job.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            return None
        resource = db.get(Dataset if job.kind == "import" else Plan, job.resource_id)
        if job.attempts >= settings().max_attempts:
            job.status, job.finished_at = "failed", utcnow()
            job.error = {
                "code": "attempts_exhausted",
                "message": "Исчерпаны попытки; задачу можно перезапустить",
            }
            resource.status = "failed"
            return None
        job.status, job.token = "running", uuid.uuid4()
        job.lease_until = utcnow() + timedelta(seconds=settings().lease_seconds)
        job.attempts += 1
        job.error = None
        resource.status = "running"
        return job.id, job.token


def renew(identifier, token):
    with session() as db, db.begin():
        return (
            db.scalar(
                update(Job)
                .where(
                    Job.id == identifier,
                    Job.token == token,
                    Job.status == "running",
                    Job.lease_until > utcnow(),
                )
                .values(lease_until=utcnow() + timedelta(seconds=settings().lease_seconds))
                .returning(Job.id)
            )
            is not None
        )


def fail(identifier, token, error, retry=False):
    with session() as db, db.begin():
        job = db.scalar(select(Job).where(Job.id == identifier).with_for_update())
        if job is None or job.token != token or job.status != "running":
            return
        job.status = "queued" if retry and job.attempts < settings().max_attempts else "failed"
        job.error = error
        job.lease_until = None
        if job.status == "failed":
            job.finished_at = utcnow()
        db.get(Dataset if job.kind == "import" else Plan, job.resource_id).status = job.status


def run_child(identifier, token):
    try:
        execute_job(identifier, token)
    except LeaseLost:
        log.warning("lease_lost job=%s", identifier)
    except DomainError as error:
        fail(identifier, token, {"code": error.code, "message": error.message})
    except Exception as error:
        log.error("job_failed job=%s error_type=%s", identifier, type(error).__name__)
        fail(
            identifier,
            token,
            {"code": "job_failed", "message": "Ошибка обработки. Задача будет повторена в пределах лимита."},
            retry=True,
        )


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", type=uuid.UUID)
    parser.add_argument("--token", type=uuid.UUID)
    args = parser.parse_args()
    if args.execute:
        run_child(args.execute, args.token)
        return
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    while not stop.is_set():
        try:
            claimed = claim()
            if claimed is None:
                stop.wait(1)
                continue
            identifier, token = claimed
            log.info("job_started job=%s", identifier)
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "optistock.worker",
                    "--execute",
                    str(identifier),
                    "--token",
                    str(token),
                ]
            )
            started = time.monotonic()
            try:
                while child.poll() is None:
                    if stop.wait(min(5, settings().lease_seconds / 3)):
                        break
                    if time.monotonic() - started > settings().job_timeout_seconds:
                        fail(
                            identifier,
                            token,
                            {"code": "job_timeout", "message": "Превышен лимит времени обработки"},
                            retry=True,
                        )
                        break
                    if not renew(identifier, token):
                        break
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                if child.returncode:
                    fail(
                        identifier,
                        token,
                        {"code": "worker_interrupted", "message": "Worker прерван; задача будет повторена"},
                        retry=True,
                    )
            log.info("job_finished job=%s", identifier)
        except Exception as error:
            log.error("worker_loop_error type=%s", type(error).__name__)
            stop.wait(5)


if __name__ == "__main__":
    main()
