/* The reads. One SELECT per shape the app asks for, in one place.
 *
 * `sessions` and `/api/session/[id]` want the same session summary, so it is
 * written once and filtered by an optional id rather than duplicated and left
 * to drift.
 *
 * What counts as a "clean" lap is defined here, once, in SQL, and it is the
 * same predicate as `isUsable()` in lib/proctor/types.ts: valid, not an out
 * lap, not flagged anomalous, and actually timed. `valid_laps`, `best_lap_s`
 * and the pace sparkline all use it, so the sessions table cannot say "9 of 11"
 * beside a sparkline with a different number of points in it.
 */

import { sql } from "@/lib/db";
import type { SessionMeta, Trace } from "@/lib/proctor/types";

export interface SessionSummaryRow extends SessionMeta {
  /** Clean-lap times in lap order. Empty when nothing qualified. */
  pace: number[] | null;
}

/** Session summaries, newest first. Pass a session id for just that one. */
export async function sessionSummaries(id: string | null): Promise<SessionSummaryRow[]> {
  const rows = await sql`
    SELECT s.id, s.track_name, s.car_name, s.session_type, s.session_num,
           s.track_length_km, s.wear_masked, s.recorded_at, f.filename,
           count(l.id)::int AS lap_count,
           count(l.id) FILTER (
             WHERE l.is_valid AND NOT l.is_out_lap AND NOT l.is_anomalous
               AND l.lap_time_s IS NOT NULL
           )::int AS valid_laps,
           min(l.lap_time_s) FILTER (
             WHERE l.is_valid AND NOT l.is_out_lap AND NOT l.is_anomalous
           ) AS best_lap_s,
           array_remove(
             array_agg(
               CASE
                 WHEN l.is_valid AND NOT l.is_out_lap AND NOT l.is_anomalous
                   THEN l.lap_time_s
               END
               ORDER BY l.lap_number
             ),
             NULL
           ) AS pace
    FROM sessions s
    LEFT JOIN ingest_files f ON f.id = s.ingest_file_id
    LEFT JOIN laps l ON l.session_id = s.id
    WHERE (${id}::bigint IS NULL OR s.id = ${id}::bigint)
    GROUP BY s.id, f.filename
    ORDER BY s.recorded_at DESC NULLS LAST, s.id DESC
  `;
  return rows as unknown as SessionSummaryRow[];
}

/** The newest session's id, or null when nothing has been ingested yet. */
export async function latestSessionId(): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM sessions
    ORDER BY recorded_at DESC NULLS LAST, id DESC
    LIMIT 1
  `;
  const id = (rows as unknown as { id: number | string }[])[0]?.id;
  return id == null ? null : String(id);
}

/* Rounding is not cosmetic. lap_traces columns are REAL (float4); widened to a
   double on the way out, 0.3 serialises as 0.30000001192092896 and the JSON for
   one session triples in size for digits that are an artefact of the storage
   type, not a measurement. Each channel is cut to the precision it was recorded
   at — no more, and no less. */
const TRACE_DP: Record<string, number> = {
  grid_pct: 5,
  speed: 3,
  throttle: 4,
  brake: 4,
  brake_raw: 4,
  steer: 4,
  gear: 0,
  rpm: 0,
  lat_accel: 3,
  long_accel: 3,
  lat_gps: 7,
  lon_gps: 7,
  abs_active: 3,
};

function channel(v: unknown, dp: number): number[] {
  if (!Array.isArray(v)) return [];
  const f = 10 ** dp;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    const n = Number(v[i]);
    out[i] = Number.isFinite(n) ? Math.round(n * f) / f : 0;
  }
  return out;
}

type TraceRow = Record<string, unknown> & {
  lap_number: number;
  lap_time_s: number | null;
};

function toTrace(r: TraceRow): Trace {
  const ch = (k: string) => channel(r[k], TRACE_DP[k] ?? 4);
  return {
    lap_number: Number(r.lap_number),
    // A lap with no recorded time cannot anchor an elapsed-time curve; 0 makes
    // the ledger's scaling a no-op rather than producing a fabricated gap.
    lap_time_s: r.lap_time_s == null ? 0 : Number(r.lap_time_s),
    grid_pct: ch("grid_pct"),
    speed: ch("speed"),
    throttle: ch("throttle"),
    brake: ch("brake"),
    brake_raw: ch("brake_raw"),
    steer: ch("steer"),
    gear: ch("gear"),
    rpm: ch("rpm"),
    lat_accel: ch("lat_accel"),
    long_accel: ch("long_accel"),
    lat_gps: ch("lat_gps"),
    lon_gps: ch("lon_gps"),
    // null !== all-zero: a car without an ABS channel reports no channel, and
    // the ribbon leaves that lane out rather than drawing a flat line at zero.
    abs_active: r.abs_active == null ? null : ch("abs_active"),
  };
}

/** Distance-resampled traces for a session. Pass lap numbers to narrow it. */
export async function traces(sessionId: string, lapNumbers?: number[]): Promise<Trace[]> {
  const laps = lapNumbers ?? null;
  const rows = await sql`
    SELECT l.lap_number, l.lap_time_s,
           t.grid_pct, t.speed, t.throttle, t.brake, t.brake_raw, t.steer,
           t.gear, t.rpm, t.lat_accel, t.long_accel, t.lat_gps, t.lon_gps,
           t.abs_active
    FROM lap_traces t
    JOIN laps l ON l.id = t.lap_id
    WHERE l.session_id = ${sessionId}::bigint
      AND (${laps}::int[] IS NULL OR l.lap_number = ANY(${laps}::int[]))
    ORDER BY l.lap_number
  `;
  return (rows as unknown as TraceRow[]).map(toTrace);
}
