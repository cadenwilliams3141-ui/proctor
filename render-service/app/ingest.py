"""Ingest pipeline: file bytes → parse (the hub) → normalized rows in Neon.

Runs as a FastAPI background task after /ingest returns 202. Any failure
lands in ingest_files.status='failed' with error_detail — a file is never
left silently unprocessed.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from proctor_parser import parse_ibt
from proctor_parser.analysis import compute_all
from proctor_parser.session import ParsedSession

from app.db import connect
from app.track_boundary import merge_session

# iRacing filenames end in 'YYYY-MM-DD HH-MM-SS'. This is rig wall-clock
# time; the .ibt itself carries no reliable absolute timestamp.
FILENAME_TS = re.compile(r"(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})")

log = logging.getLogger("proctor.ingest")

# Column order matches migrations/001_init.sql lap_traces.
TRACE_COLUMNS = (
    "grid_pct", "speed", "throttle", "brake", "brake_raw", "steer", "gear",
    "rpm", "lat_accel", "long_accel", "lat_gps", "lon_gps", "abs_active",
)


def recorded_at_from_filename(name: str) -> datetime | None:
    m = FILENAME_TS.search(name)
    if not m:
        return None
    date, hh, mm, ss = m.groups()
    return datetime.fromisoformat(f"{date}T{hh}:{mm}:{ss}").replace(tzinfo=timezone.utc)


def _write_session(conn, ingest_id: int, user_id: str, ps: ParsedSession) -> int:
    meta = ps.meta
    session_id = conn.execute(
        """
        INSERT INTO sessions (user_id, ingest_file_id, track_name, car_name,
            session_type, session_num, track_length_km, car_redline_rpm,
            wear_masked, tick_rate, recorded_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
        """,
        (user_id, ingest_id, meta.track_name, meta.car_name, meta.session_type,
         meta.session_num, meta.track_length_km, meta.car_redline_rpm,
         meta.wear_masked, meta.tick_rate, meta.recorded_at),
    ).fetchone()[0]

    lap_ids = []
    for lap in ps.laps:
        lap_id = conn.execute(
            """
            INSERT INTO laps (session_id, lap_number, lap_time_s, is_valid,
                is_out_lap, incident_delta, is_anomalous)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (session_id, lap.lap_number, lap.lap_time_s, lap.is_valid,
             lap.is_out_lap, lap.incident_delta, lap.is_anomalous),
        ).fetchone()[0]
        lap_ids.append(lap_id)

    # Traces go in via COPY, never row-by-row INSERT.
    cols = ", ".join(TRACE_COLUMNS)
    with conn.cursor() as cur:
        with cur.copy(f"COPY lap_traces (lap_id, {cols}) FROM STDIN") as copy:
            for lap_id, lap in zip(lap_ids, ps.laps):
                row = [lap_id]
                for col in TRACE_COLUMNS:
                    row.append([float(v) for v in lap.grid[col]])
                copy.write_row(row)

    metrics = compute_all(ps)
    for key, payload in metrics.items():
        conn.execute(
            """
            INSERT INTO session_metrics (session_id, metric_key, payload)
            VALUES (%s,%s,%s)
            ON CONFLICT (session_id, metric_key) DO UPDATE SET payload = EXCLUDED.payload
            """,
            (session_id, key, Jsonb(payload)),
        )

    # The one thing this session learned that outlives it: everything else here
    # describes one outing, but the racing surface belongs to the track, so it
    # is merged into a per-track boundary that every future session at the same
    # circuit reads and widens.
    #
    # In a SAVEPOINT of its own. The laps and traces above are why the file was
    # uploaded; the boundary is a bonus. If merging it fails the session must
    # still land, and in Postgres a failed statement poisons the rest of the
    # transaction unless it is rolled back to a savepoint.
    try:
        with conn.transaction():
            merge_session(conn, user_id, ingest_id, meta.track_name,
                          meta.track_length_km, metrics.get("track_edges"))
    except Exception as exc:  # noqa: BLE001 — never sink the telemetry write
        log.error("track boundary not updated for %s: %s", meta.track_name, exc)
    return session_id


def process_file(ingest_id: int, filename: str, data: bytes, user_id: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "UPDATE ingest_files SET status='parsing' WHERE id=%s", (ingest_id,)
        )
        sessions = parse_ibt(data, recorded_at=recorded_at_from_filename(filename))
        # One transaction per file: a failure leaves zero partial telemetry,
        # and re-processing never duplicates sessions.
        with conn.transaction():
            conn.execute(
                "DELETE FROM sessions WHERE ingest_file_id=%s", (ingest_id,)
            )
            for ps in sessions:
                _write_session(conn, ingest_id, user_id, ps)
        conn.execute(
            "UPDATE ingest_files SET status='done', parsed_at=now(), error_detail=NULL WHERE id=%s",
            (ingest_id,),
        )
    except Exception as exc:  # noqa: BLE001 — status must always land somewhere
        detail = f"{type(exc).__name__}: {exc}"[:2000]
        try:
            conn.execute(
                "UPDATE ingest_files SET status='failed', error_detail=%s WHERE id=%s",
                (detail, ingest_id),
            )
        except Exception:
            pass
    finally:
        conn.close()
