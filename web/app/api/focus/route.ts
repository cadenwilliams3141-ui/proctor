import { NextResponse } from "next/server";

import { sql } from "@/lib/db";
import { coach } from "@/lib/proctor/coach";
import { focusBaseline, parseFocusRequest, type DriverFocus } from "@/lib/proctor/focus";
import { guarded } from "@/lib/proctor/server/respond";
import {
  balanceFrom,
  drivingAspectsFrom,
  hardwareFrom,
  inputResponseFrom,
  reportCardFrom,
  trackWidthFrom,
  trailBrakingFrom,
} from "@/lib/proctor/server/shape";
import type { MetricPayloads } from "@/lib/proctor/types";

/* The driver's focus: the one suggestion they chose to work on.
 *
 * The first route in the app that WRITES. It writes user state, never
 * telemetry (no route may carry telemetry through Vercel — see CLAUDE.md), and
 * it accepts as little as it can: a session number, a rule key and the corner
 * numbers. Everything saved is re-derived HERE from the stored session, so a
 * browser can choose which suggestion to pin but cannot hand the server
 * numbers to keep. The site has no login; that was accepted for this row on
 * 2026-11-25 (Decisions log). */

export const dynamic = "force-dynamic";

const MAX_NAME = 200;
const MAX_BODY_BYTES = 4096;

function names(req: Request): { car: string; track: string } | null {
  const u = new URL(req.url);
  const car = u.searchParams.get("car");
  const track = u.searchParams.get("track");
  if (!car || !track || car.length > MAX_NAME || track.length > MAX_NAME) return null;
  return { car, track };
}

function toFocus(r: Record<string, unknown>): DriverFocus {
  return {
    id: Number(r.id),
    car_name: String(r.car_name),
    track_name: String(r.track_name),
    aspect: r.aspect as DriverFocus["aspect"],
    rule_key: r.rule_key as DriverFocus["rule_key"],
    title: String(r.title),
    baseline_session_id: r.baseline_session_id == null ? null : Number(r.baseline_session_id),
    baseline: (typeof r.baseline === "string" ? JSON.parse(r.baseline) : r.baseline) as DriverFocus["baseline"],
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/** The active focus for a car at a track, or null. */
export async function GET(req: Request) {
  return guarded(async () => {
    const n = names(req);
    if (!n) return NextResponse.json({ error: "car and track are required" }, { status: 400 });
    const rows = (await sql`
      SELECT id, car_name, track_name, aspect, rule_key, title, baseline_session_id, baseline, created_at
      FROM driver_focus
      WHERE car_name = ${n.car} AND track_name = ${n.track} AND cleared_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `) as Record<string, unknown>[];
    return NextResponse.json({ focus: rows[0] ? toFocus(rows[0]) : null });
  });
}

/** Pin a suggestion from a session as the focus for that session's car and track. */
export async function POST(req: Request) {
  return guarded(async () => {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "request too large" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "expected JSON" }, { status: 400 });
    }
    const parsed = parseFocusRequest(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const [session] = (await sql`
      SELECT id, car_name, track_name, recorded_at FROM sessions WHERE id = ${parsed.sessionId}::bigint
    `) as Record<string, unknown>[];
    if (!session) return NextResponse.json({ error: `session ${parsed.sessionId} not found` }, { status: 404 });
    if (!session.car_name || !session.track_name) {
      return NextResponse.json(
        { error: "this session does not name its car and track, so a focus could not be found again" },
        { status: 422 },
      );
    }

    const metricRows = (await sql`
      SELECT metric_key, payload FROM session_metrics WHERE session_id = ${parsed.sessionId}::bigint
    `) as { metric_key: string; payload: unknown }[];
    const m = Object.fromEntries(metricRows.map((r) => [r.metric_key, r.payload])) as MetricPayloads;
    const da = drivingAspectsFrom(m);
    if (!da) return NextResponse.json({ error: "this session has no aspect timing; re-ingest it first" }, { status: 422 });
    const tb = trailBrakingFrom(m);
    const report = coach({
      drivingAspects: da,
      trailBraking: tb,
      inputResponse: inputResponseFrom(m),
      hardware: hardwareFrom(m),
      reportCard: reportCardFrom(m),
      balance: balanceFrom(m),
      trackWidth: trackWidthFrom(m),
    });
    const want = parsed.corners.join(",");
    const s = report.suggestions.find((x) => x.key === parsed.key && x.corners.join(",") === want);
    if (!s) return NextResponse.json({ error: "that suggestion is not in this session's coaching" }, { status: 404 });

    const recorded = session.recorded_at instanceof Date ? session.recorded_at.toISOString() : (session.recorded_at as string | null);
    const baseline = focusBaseline(s, da, tb, recorded);
    const car = String(session.car_name);
    const track = String(session.track_name);

    // One active focus per car and track: the old one is kept, marked cleared.
    await sql`
      UPDATE driver_focus SET cleared_at = now()
      WHERE car_name = ${car} AND track_name = ${track} AND cleared_at IS NULL
    `;
    const [row] = (await sql`
      INSERT INTO driver_focus (car_name, track_name, aspect, rule_key, title, baseline_session_id, baseline)
      VALUES (${car}, ${track}, ${s.aspect}, ${s.key}, ${s.title}, ${parsed.sessionId}::bigint, ${JSON.stringify(baseline)}::jsonb)
      RETURNING id, car_name, track_name, aspect, rule_key, title, baseline_session_id, baseline, created_at
    `) as Record<string, unknown>[];
    return NextResponse.json({ focus: toFocus(row) });
  });
}

/** Clear the focus for a car and track. The row stays, marked cleared. */
export async function DELETE(req: Request) {
  return guarded(async () => {
    const n = names(req);
    if (!n) return NextResponse.json({ error: "car and track are required" }, { status: 400 });
    await sql`
      UPDATE driver_focus SET cleared_at = now()
      WHERE car_name = ${n.car} AND track_name = ${n.track} AND cleared_at IS NULL
    `;
    return NextResponse.json({ focus: null });
  });
}
