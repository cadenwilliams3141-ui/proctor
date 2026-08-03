"""Proctor ingest service: receives .ibt uploads, parses, writes Neon.

POST /ingest       — multipart file + user_id → 202 + ingest_file_id, async parse
GET  /ingest/{id}  — status polling (pending|parsing|done|failed)
GET  /health       — uptime check
"""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.db import apply_migrations, connect
from app.ingest import process_file


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Bring the schema up to date before the first request.

    Idempotent: every migration is CREATE ... IF NOT EXISTS. A failure is logged
    and the service still starts — see db.apply_migrations for why.

    lifespan rather than @app.on_event("startup"): on_event is deprecated as of
    FastAPI 0.109 and this is the hook that keeps the schema in step with the
    code, so it should not be resting on an API scheduled for removal.
    """
    logging.basicConfig(level=logging.INFO)
    apply_migrations()
    yield


app = FastAPI(title="proctor-ingest", lifespan=lifespan)

# Single-user product, no auth yet; the UI runs on localhost + vercel.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "proctor-ingest"}


@app.post("/ingest", status_code=202)
async def ingest(
    background: BackgroundTasks,
    file: UploadFile,
    user_id: str = Form("caden"),
    force: bool = Form(False),
) -> dict:
    data = await file.read()
    sha = hashlib.sha256(data).hexdigest()
    filename = file.filename or "unknown.ibt"

    with connect() as conn:
        row = conn.execute(
            "SELECT id, status FROM ingest_files WHERE sha256=%s", (sha,)
        ).fetchone()
        if row is not None and row[1] != "failed" and not force:
            # Dedupe: same bytes already ingested (or in flight). force=true
            # reprocesses known bytes (e.g. after new analysis modules land).
            return {"ingest_file_id": row[0], "status": row[1], "duplicate": True}
        if row is not None:
            ingest_id = row[0]
            conn.execute(
                "UPDATE ingest_files SET status='pending', error_detail=NULL WHERE id=%s",
                (ingest_id,),
            )
        else:
            ingest_id = conn.execute(
                "INSERT INTO ingest_files (user_id, filename, sha256) VALUES (%s,%s,%s) RETURNING id",
                (user_id, filename, sha),
            ).fetchone()[0]

    background.add_task(process_file, ingest_id, filename, data, user_id)
    return {"ingest_file_id": ingest_id, "status": "pending", "duplicate": False}


@app.get("/ingest/{ingest_id}")
def ingest_status(ingest_id: int) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, filename, status, error_detail, uploaded_at, parsed_at
            FROM ingest_files WHERE id=%s
            """,
            (ingest_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown ingest id")
    return {
        "ingest_file_id": row[0],
        "filename": row[1],
        "status": row[2],
        "error_detail": row[3],
        "uploaded_at": row[4].isoformat() if row[4] else None,
        "parsed_at": row[5].isoformat() if row[5] else None,
    }
