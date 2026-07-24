"""Proctor ingest service: receives .ibt uploads, parses, writes Neon.

POST /ingest       — multipart file + user_id → 202 + ingest_file_id, async parse
GET  /ingest/{id}  — status polling (pending|parsing|done|failed)
GET  /health       — uptime check
"""

from __future__ import annotations

import hashlib

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.db import connect
from app.ingest import process_file

app = FastAPI(title="proctor-ingest")

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
) -> dict:
    data = await file.read()
    sha = hashlib.sha256(data).hexdigest()
    filename = file.filename or "unknown.ibt"

    with connect() as conn:
        row = conn.execute(
            "SELECT id, status FROM ingest_files WHERE sha256=%s", (sha,)
        ).fetchone()
        if row is not None and row[1] != "failed":
            # Dedupe: same bytes already ingested (or in flight).
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
