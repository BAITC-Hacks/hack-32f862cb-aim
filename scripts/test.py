"""Run migrations and integration tests against the dedicated PostgreSQL test database."""

import os
import subprocess
import sys

from dotenv import dotenv_values

values = dotenv_values(".env")
url = os.getenv("OPTISTOCK_TEST_DATABASE_URL", values.get("OPTISTOCK_TEST_DATABASE_URL", ""))
if not url or not url.rsplit("/", 1)[-1].split("?", 1)[0].endswith("_test"):
    raise SystemExit("Set OPTISTOCK_TEST_DATABASE_URL to a dedicated *_test database")
env = {**os.environ, "OPTISTOCK_DATABASE_URL": url, "OPTISTOCK_TEST_DATABASE_URL": url}
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True)
subprocess.run([sys.executable, "-m", "pytest", *sys.argv[1:]], env=env, check=True)
subprocess.run([sys.executable, "-m", "alembic", "check"], env=env, check=True)
