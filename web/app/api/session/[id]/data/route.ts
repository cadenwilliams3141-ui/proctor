import { NextResponse } from "next/server";

import { sql } from "@/lib/db";
import {
  absencesFrom,
  cornersFrom,
  eventPatternsFrom,
  eventsFrom,
  gripFrom,
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
  latestSessionId,
  sessionSummaries,
  traces,
  trackBoundary,
} from "@/lib/proctor/server/queries";
import type { Lap, MetricPayloads, SessionBundle, Trace } from "@/lib/proctor/types";

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
    const [lapRows, metricRows, traceList, boundaryRow] = await Promise.all([
      sql`
        SELECT lap_number, lap_time_s, is_valid, is_out_lap, incident_delta, is_anomalous
        FROM laps WHERE session_id = ${id}::bigint ORDER BY lap_number
      `,
      sql`
        SELECT metric_key, payload FROM session_metrics WHERE session_id = ${id}::bigint
      `,
      traces(id),
      trackBoundary(session.track_name),
    ]);

    const laps = lapRows as unknown as Lap[];
    const metrics = Object.fromEntries(
      (metricRows as unknown as { metric_key: string; payload: unknown }[]).map((m) => [
        m.metric_key,
        m.payload,
      ]),
    ) as MetricPayloads;

    const traceMap: Record<number, Trace> = {};
    for (const t of traceList) traceMap[t.lap_number] = t;

    // The shared distance grid. Every per-sample array in the bundle is this
    // long, which is what lets the ribbon, the map and the ledger index each
    // other by sample without ever resampling in the browser.
    const gridSize = traceList[0]?.grid_pct.length ?? 0;

    const map = mapFrom(metrics, gridSize);

    const bundle: SessionBundle = {
      session,
      laps,
      traces: traceMap,
      metrics,
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
      gridSize,
      map,
      absences: absencesFrom(metrics, session),
    };

    return NextResponse.json(bundle);
  });
}
