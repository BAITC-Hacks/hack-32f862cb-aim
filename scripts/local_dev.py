"""Windows local stack using installed PostgreSQL binaries; no system service changes.

Run with .venv/Scripts/python scripts/local_dev.py. State and secrets live under var/.
Existing .env, databases, credentials, and listeners are never overwritten.
"""

import hashlib
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
VAR = ROOT / "var" / "local"
VAR.mkdir(parents=True, exist_ok=True)
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, creationflags=HIDDEN, **kwargs)


def listening(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


def background(name, args, port=None, cwd=ROOT):
    if port and listening(port):
        print(f"Port {port} already listening; existing process kept.")
        return
    pid_file = VAR / f"{name}.pid"
    if pid_file.exists():
        # psutil is intentionally not required. Windows tasklist verifies the saved PID.
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid_file.read_text().strip()}", "/FO", "CSV"],
                capture_output=True,
                creationflags=HIDDEN,
            )
            if b"python" in result.stdout.lower() and name == "worker":
                print("Worker already running.")
                return
    with (VAR / f"{name}.log").open("ab") as log:
        process = subprocess.Popen(
            [str(a) for a in args],
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            creationflags=HIDDEN,
            start_new_session=os.name != "nt",
        )
    pid_file.write_text(str(process.pid))
    print(f"Started {name}, PID {process.pid}.")


def main():
    sys.stdout.reconfigure(line_buffering=True)
    if os.name != "nt":
        raise SystemExit("Use docker compose on Linux/macOS. This helper uses Windows PostgreSQL binaries.")
    run([sys.executable, "scripts/configure.py"])
    config = dotenv_values(".env")
    url = config["OPTISTOCK_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if (
        parsed.hostname not in {"localhost", "127.0.0.1"}
        or parsed.port != 5435
        or parsed.username != "optistock"
    ):
        raise SystemExit("Existing .env uses another database. Kept unchanged; start that database manually.")
    installs = sorted(Path("C:/Program Files/PostgreSQL").glob("*/bin/initdb.exe"), reverse=True)
    if not installs:
        raise SystemExit("PostgreSQL binaries not found. Install PostgreSQL or use docker compose.")
    binaries = installs[0].parent
    cluster = VAR / "postgres"
    if not (cluster / "PG_VERSION").exists():
        if listening(5435):
            raise SystemExit("Port 5435 is occupied; will not initialise over an unknown server.")
        password_file = VAR / "init-password"
        password_file.write_text(parsed.password, encoding="utf-8")
        try:
            run(
                [
                    binaries / "initdb.exe",
                    "-D",
                    cluster,
                    "-U",
                    "optistock",
                    "-A",
                    "scram-sha-256",
                    "--pwfile",
                    password_file,
                    "--encoding=UTF8",
                    "--locale=C",
                ],
                stdout=subprocess.DEVNULL,
            )
        finally:
            password_file.unlink(missing_ok=True)
    if not listening(5435):
        run(
            [
                binaries / "pg_ctl.exe",
                "-D",
                cluster,
                "-l",
                VAR / "postgres.log",
                "-o",
                "-h 127.0.0.1 -p 5435",
                "-w",
                "start",
            ]
        )
    with psycopg.connect(
        url.replace("@localhost:", "@127.0.0.1:").rsplit("/", 1)[0] + "/postgres",
        autocommit=True,
        connect_timeout=5,
    ) as db:
        for name in ("optistock", "optistock_test"):
            if not db.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
                db.execute(sql.SQL("CREATE DATABASE {} OWNER optistock").format(sql.Identifier(name)))
    print("Database ready; applying migrations.")
    run([sys.executable, "-m", "alembic", "upgrade", "head"])
    print("Migrations ready; checking local credential.")
    key_path = VAR / "api-key"
    from optistock.db import session
    from optistock.models import Credential
    from sqlalchemy import select

    with session() as db, db.begin():
        credential = db.scalar(select(Credential).where(Credential.name == "Local procurement manager"))
        if credential is None:
            if key_path.exists():
                raise SystemExit("Saved key has no database credential; resolve manually before continuing.")
            key = "opt_" + secrets.token_urlsafe(32)
            db.add(
                Credential(
                    name="Local procurement manager",
                    role="admin",
                    token_hash=hashlib.sha256(key.encode()).hexdigest(),
                )
            )
            key_path.write_text(key, encoding="utf-8")
        elif (
            not key_path.exists()
            or hashlib.sha256(key_path.read_text().strip().encode()).hexdigest() != credential.token_hash
        ):
            raise SystemExit(
                "Local key and database credential do not match; existing credentials kept unchanged."
            )
    frontend_env = ROOT / "frontend" / ".env.local"
    if not frontend_env.exists():
        frontend_env.write_text(
            "VITE_LOCAL_WORKSPACE=1\nOPTISTOCK_LOCAL_KEY_FILE=../var/local/api-key\n", encoding="utf-8"
        )
    background(
        "api",
        [sys.executable, "-m", "uvicorn", "optistock.api:app", "--host", "127.0.0.1", "--port", "8000"],
        8000,
    )
    background("worker", [sys.executable, "-m", "optistock.worker"])
    node = shutil.which("node")
    if node and (ROOT / "frontend/node_modules/vite/bin/vite.js").exists():
        background(
            "frontend",
            [node, "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
            5173,
            ROOT / "frontend",
        )
    for _ in range(40):
        if listening(8000):
            break
        time.sleep(0.25)
    print(
        "Open http://127.0.0.1:5173/agent. Logs: var/local/. No secret is printed or bundled in the frontend."
    )


if __name__ == "__main__":
    main()
