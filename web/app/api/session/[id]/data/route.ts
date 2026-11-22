import { NextResponse } from "next/server";

import { sql } from "@/lib/db";
import {
  absencesFrom,
  coachFrom,
  cornerLapsFrom,
  segmentsFrom,
  watchFrom,
  cornersFrom,
  eventPatternsFrom,
  eventsFrom,
  gripFrom,
  contactPatchFrom,
  hardwareFrom,
  inputResponseFrom,
  mapFrom,
  stintFrom,
  tireFrom,
  trackBoundaryFrom,
  trackEdgesFrom,
  trackWidthFrom,
  tractionFrom,
} from "@/lib/proctor/server/shape";
import { guarded } from "@/lib/proctor/server/respond";
import {
  lapRows,
  latestSessionId,
  sessionSummaries,
  traces,
  trackBoundary,
} from "@/lib/proctor/server/queries";
import { isUsable, type Lap, type MetricPayloads, type SessionBundle, type Trace } from "@/lib/proctor/types";

/* Everything a session's screens need, in one round trip.
 *
 * The session, its laps and its metric blocks come straight out of Neon. The
 * rest of the bundle is the same data reshaped for the analysis surface — see
 * lib/proctor/server/shape.ts, which is also where the honesty rules about
 * absent modules and the estimated g-g boundary are enforced.
 *
 * `id` may be the literal "latest", which the app opens on: the desktop shell
 * loads a session before the driver has picked one, and the newest ingest is
 * the one they just drove. */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;

  return guarded(async () => {
    let id: string | null = raw;
    if (raw === "latest") {
      id = await latestSessionId();
      if (id == null) {
        return NextResponse.json(
          { error: "no sessions have been ingested yet" },
          { status: 404 },
        );
      }
    } else if (!/^\d+$/.test(raw)) {
      return NextResponse.json({ error: `not a session id: ${raw}` }, { status: 400 });
    }

    const [summary] = await sessionSummaries(id);
    if (!summary) {
      return NextResponse.json({ error: `session ${id} not found` }, { status: 404 });
    }
    const { pace: _pace, ...session } = summary;

    // The boundary is keyed by TRACK, not by session — it is the one thing in
    // this bundle that outlives the outing being looked at.
    const [laps, metricRows, boundaryRow] = await Promise.all([
      lapRows(id),
      sql`
        SELECT metric_key, payload FROM session_metrics WHERE session_id = ${id}::bigint
      `,
      trackBoundary(session.track_name),
    ]);

    const metrics = Object.fromEntries(
      (metricRows as unknown as { metric_key: string; payload: unknown }[]).map((m) => [
        m.metric_key,
        m.payload,
      ]),
    ) as MetricPayloads;

    /* Only the opening pair's traces ride in the bundle: the reference lap and
       the slowest clean lap, the same pair the store seats on load. Every lap's
       trace used to come along — 1.5 MB of a 1.9 MB bundle at 18 laps, and a
       long race would have gone past Vercel's response limit. The rest load
       on demand through /traces, four at a time. */
    const traceList = await traces(id, openingPair(laps));
    const traceMap: Record<number, Trace> = {};
    for (const t of traceList) traceMap[t.lap_number] = t;

    // The shared distance grid. Every per-sample array in the bundle is this
    // long, which is what lets the ribbon, the map and the ledger index each
    // other by sample without ever resampling in the browser.
    const gridSize = traceList[0]?.grid_pct.length ?? metricGridSize(metrics);

    const map = mapFrom(metrics, gridSize);

    const bundle: SessionBundle = {
      session,
      laps,
      traces: traceMap,
      corners: cornersFrom(metrics, map),
      traction: tractionFrom(metrics),
      tire: tireFrom(metrics, gridSize),
      events: eventsFrom(metrics),
      eventPatterns: eventPatternsFrom(metrics),
      grip: gripFrom(metrics),
      inputResponse: inputResponseFrom(metrics),
      stint: stintFrom(metrics),
      trackWidth: trackWidthFrom(metrics),
      trackBoundary: trackBoundaryFrom(boundaryRow),
      trackEdges: trackEdgesFrom(metrics),
      hardware: hardwareFrom(metrics),
      contactPatch: contactPatchFrom(metrics),
      gridSize,
      map,
      absences: absencesFrom(metrics, session),
      segments: segmentsFrom(metrics),
      cornerLaps: cornerLapsFrom(metrics),
      coach: coachFrom(metrics),
      watch: watchFrom(metrics),
    };

    return NextResponse.json(bundle);
  });
}

/** Reference lap (fastest clean) and the slowest other clean lap. */
function openingPair(laps: Lap[]): number[] {
  const clean = laps.filter(isUsable).sort((a, b) => (a.lap_time_s ?? 0) - (b.lap_time_s ?? 0));
  if (clean.length === 0) return laps.slice(0, 1).map((l) => l.lap_number);
  const ref = clean[0].lap_number;
  const worst = clean.length > 1 ? clean[clean.length - 1].lap_number : null;
  return worst == null ? [ref] : [ref, worst];
}

/** The grid length from a module payload, when no trace came along. */
function metricGridSize(metrics: MetricPayloads): number {
  const m = metrics.track_map as { x_m?: unknown[] } | undefined;
  return Array.isArray(m?.x_m) ? m!.x_m.length : 0;
}

