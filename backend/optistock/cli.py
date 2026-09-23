import argparse
import hashlib
import secrets

from sqlalchemy import select

from optistock.db import session
from optistock.models import Credential


def main():
    parser = argparse.ArgumentParser(prog="optistock")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-key", help="Create a scoped API key; shown once")
    create.add_argument("--name", required=True)
    create.add_argument("--role", choices=["viewer", "planner", "approver", "admin"], default="planner")
    revoke = commands.add_parser("revoke-key")
    revoke.add_argument("--name", required=True)
    args = parser.parse_args()
    with session() as db, db.begin():
        existing = db.scalar(select(Credential).where(Credential.name == args.name))
        if args.command == "create-key":
            if existing:
                parser.error("This name already exists; use a new credential name")
            if not 1 <= len(args.name) <= 80:
                parser.error("Name must have 1–80 characters")
            token = "opt_" + secrets.token_urlsafe(32)
            db.add(
                Credential(
                    name=args.name, role=args.role, token_hash=hashlib.sha256(token.encode()).hexdigest()
                )
            )
        else:
            if existing is None:
                parser.error("Credential not found")
            existing.active = False
    if args.command == "create-key":
        print(token)


if __name__ == "__main__":
    main()
