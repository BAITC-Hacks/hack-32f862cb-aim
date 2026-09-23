"""Generate local secrets without overwriting an existing installation."""

import os
import secrets
from pathlib import Path

path = Path(".env")
if path.exists():
    print(".env already exists; kept unchanged")
else:
    password = secrets.token_urlsafe(30)
    content = (
        f"POSTGRES_PASSWORD={secrets.token_urlsafe(30)}\n"
        f"OPTISTOCK_DB_PASSWORD={password}\n"
        f"OPTISTOCK_DATABASE_URL=postgresql+psycopg://optistock:{password}@localhost:5435/optistock\n"
        f"OPTISTOCK_TEST_DATABASE_URL=postgresql+psycopg://optistock:{password}@localhost:5435/optistock_test\n"
        "OPTISTOCK_STORAGE_ROOT=var/files\nOPTISTOCK_SAMPLE_ROOT=.\n"
    )
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    print("Created .env with generated local credentials")
