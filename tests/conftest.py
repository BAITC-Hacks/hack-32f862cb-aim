import hashlib
import os

import pytest
from dotenv import dotenv_values
from optistock.config import settings
from optistock.db import engine, session
from optistock.models import Base, Credential, SupplierState
from sqlalchemy import text

values = dotenv_values(".env")
test_url = os.getenv("OPTISTOCK_TEST_DATABASE_URL", values.get("OPTISTOCK_TEST_DATABASE_URL", ""))
if not test_url or not test_url.rsplit("/", 1)[-1].split("?", 1)[0].endswith("_test"):
    raise RuntimeError("OPTISTOCK_TEST_DATABASE_URL must name a dedicated database ending in _test")
os.environ["OPTISTOCK_DATABASE_URL"] = test_url

settings.cache_clear()


@pytest.fixture(autouse=True)
def clean_database():
    with engine().begin() as connection:
        tables = ", ".join('"' + t.name + '"' for t in Base.metadata.sorted_tables)
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    with session() as db, db.begin():
        db.add_all([SupplierState(supplier="iek"), SupplierState(supplier="systeme")])
        for role in ("admin", "viewer", "planner", "approver"):
            db.add(
                Credential(
                    name=role, role=role, token_hash=hashlib.sha256(f"test-{role}".encode()).hexdigest()
                )
            )


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from optistock.api import app

    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer test-admin"
        yield client
