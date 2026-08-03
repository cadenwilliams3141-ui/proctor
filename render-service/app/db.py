"""Neon connection helper. DATABASE_URL comes from the environment only."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import psycopg

log = logging.getLogger("proctor.db")

# migrations/ sits at the repo root, two levels above this file. The whole repo
# is deployed (the service imports proctor_parser from /parser), so it is there.
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


def connect() -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)


def apply_migrations() -> None:
    """Run every migrations/*.sql in name order, at service start.

    There was no runner before this: 001_init.sql was applied by hand, which
    worked exactly once and left the next migration with no way to arrive. That
    is a live hazard rather than an inconvenience — ingest now writes to a table
    002 creates, and a missing table inside a transaction poisons every
    statement after it, so a schema that silently lags the code would fail the
    telemetry write too.

    Every statement in these files is CREATE ... IF NOT EXISTS, so running them
    all on every boot is idempotent and needs no version ledger. If that ever
    stops being true, this needs a schema_migrations table before the migration
    that breaks it lands.
    """
    if not MIGRATIONS_DIR.is_dir():
        log.warning("no migrations directory at %s; schema left as-is", MIGRATIONS_DIR)
        return

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        log.warning("no .sql files in %s; schema left as-is", MIGRATIONS_DIR)
        return

    with connect() as conn:
        for path in files:
            try:
                conn.execute(path.read_text(encoding="utf-8"))
                log.info("migration applied: %s", path.name)
            except Exception as exc:  # noqa: BLE001 — one bad file must not stop boot
                # Reported, never swallowed: the service still starts, because
                # refusing to serve reads over a schema issue helps nobody, but
                # the reason is in the logs rather than surfacing later as a
                # confusing "relation does not exist" mid-ingest.
                log.error("migration FAILED: %s: %s", path.name, exc)
