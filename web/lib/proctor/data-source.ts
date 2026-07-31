/* ╔═══════════════════════════════════════════════════════════════════════╗
   ║  THE SWAP POINT                                                       ║
   ║                                                                       ║
   ║  Every screen in the redesign reads its data through this module and  ║
   ║  no other. Nothing else in components/proctor/** imports the fixture,  ║
   ║  and nothing else knows whether the data came from Neon or from a     ║
   ║  generator.                                                           ║
   ║                                                                       ║
   ║  TO GO LIVE: implement `neonSource` below against the existing API    ║
   ║  routes and flip PROCTOR_DATA_SOURCE to "neon". No component changes. ║
   ║  See docs/REDESIGN-HANDOFF.md for the payload contract.               ║
   ╚═══════════════════════════════════════════════════════════════════════╝ */

import type { IngestRow, SessionBundle, SessionRow, Trace } from "@/lib/proctor/types";
import { generateSession } from "@/lib/proctor/fixture/generate";
import { isUsable } from "@/lib/proctor/types";

export type SourceKind = "fixture" | "neon";

/** Which source is live. `fixture` until the connectors are wired.
 *
 *  NEXT_PUBLIC_ is required because the analysis surface is a client component
 *  tree — the shared cursor, the ribbon and the live sweep all need pointer and
 *  rAF state that a server component cannot hold. */
export const SOURCE: SourceKind =
  (process.env.NEXT_PUBLIC_PROCTOR_DATA_SOURCE as SourceKind) ?? "fixture";

/** True whenever the numbers on screen are synthetic. The shell renders a
 *  persistent marker from this, because a screen full of plausible telemetry
 *  that is not from a real file is exactly the kind of thing the honesty rules
 *  exist to prevent — including when the audience is us. */
export const IS_FIXTURE = SOURCE === "fixture";

export interface DataSource {
  /** Everything a session's screens need, in one round trip. The corner ledger
   *  rides along rather than costing a second request. */
  loadSession(sessionId: string): Promise<SessionBundle>;
  /** Traces are large; they load lazily by lap number. */
  loadTraces(sessionId: string, lapNumbers: number[]): Promise<Trace[]>;
  /** Newest first. */
  listSessions(): Promise<SessionRow[]>;
  /** Files the watcher has sent that are not yet a readable session. */
  listIngest(): Promise<IngestRow[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture source — development only
// ─────────────────────────────────────────────────────────────────────────────

const fixtureSource: DataSource = {
  async loadSession() {
    return generateSession();
  },
  async loadTraces(_id, lapNumbers) {
    const bundle = generateSession();
    return lapNumbers.map((n) => bundle.traces[n]).filter(Boolean);
  },
  async listSessions() {
    const bundle = generateSession();
    const pace = bundle.laps.filter(isUsable).map((l) => l.lap_time_s as number);

    /* Only the first row is a real (fixture) session with traces behind it.
       The rest exist so the list has something to be a list of; they are not
       clickable through to analysis, and the "sample data" chip in the top bar
       covers all of them. */
    return [
      { ...bundle.session, pace },
      {
        ...bundle.session,
        id: "prior-spa",
        track_name: "Spa-Francorchamps",
        recorded_at: "2026-07-27T18:02:00.000Z",
        wear_masked: false,
        lap_count: 11,
        valid_laps: 9,
        best_lap_s: 139.084,
        pace: [141.9, 141.2, 140.6, 140.1, 139.8, 139.084, 139.4, 139.9, 140.4],
      },
      {
        ...bundle.session,
        id: "prior-monza",
        track_name: "Monza",
        session_type: "Qualify",
        recorded_at: "2026-07-25T20:40:00.000Z",
        wear_masked: false,
        lap_count: 5,
        valid_laps: 4,
        best_lap_s: 107.916,
        pace: [109.2, 108.4, 107.916, 108.3],
      },
      {
        ...bundle.session,
        id: "prior-roadatlanta",
        track_name: "Road Atlanta — Full",
        car_name: "Ferrari 296 GT3",
        session_type: "Race",
        recorded_at: "2026-07-22T19:12:00.000Z",
        wear_masked: true,
        lap_count: 21,
        valid_laps: 18,
        best_lap_s: 82.404,
        pace: [84.1, 83.4, 83.0, 82.7, 82.404, 82.6, 82.9, 83.2, 83.6, 84.0, 84.3],
      },
    ];
  },
  async listIngest() {
    return [
      {
        id: 3,
        filename: "porsche992cup_watkinsglen boot 2026-07-29 19-14-02.ibt",
        status: "done",
        error_detail: null,
        uploaded_at: "2026-07-29T19:31:00.000Z",
      },
      {
        id: 2,
        filename: "porsche992cup_watkinsglen boot 2026-07-29 18-02-55.ibt",
        status: "failed",
        error_detail:
          "no complete laps: file contains 1 session with 0 timed laps (all samples below 5 m/s)",
        uploaded_at: "2026-07-29T18:09:00.000Z",
      },
      {
        id: 1,
        filename: "ferrari296gt3_roadatlanta full 2026-07-22 19-12-40.ibt",
        status: "parsing",
        error_detail: null,
        uploaded_at: "2026-07-29T17:44:00.000Z",
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Neon source — implement these three methods to go live
// ─────────────────────────────────────────────────────────────────────────────

const neonSource: DataSource = {
  async loadSession(sessionId) {
    // GET /api/session/[id]/data already returns { session, laps, metrics }.
    // It must additionally return: corners[] (id, start_pct, apex_pct, end_pct,
    // radius_m, dir), traction, tire, events, map, and gridSize. See the
    // handoff doc — items 1-6 of "What the backend must supply".
    const res = await fetch(`/api/session/${sessionId}/data`);
    if (!res.ok) throw new Error(`session ${sessionId}: ${res.status}`);
    return (await res.json()) as SessionBundle;
  },
  async loadTraces(sessionId, lapNumbers) {
    // The existing route caps at 4 laps per request, which is enough for the
    // A/B comparison plus a lookahead. Batch if that ever needs to grow.
    const res = await fetch(
      `/api/session/${sessionId}/traces?laps=${lapNumbers.join(",")}`,
    );
    if (!res.ok) throw new Error(`traces ${lapNumbers}: ${res.status}`);
    const body = (await res.json()) as { traces: Trace[] };
    return body.traces ?? [];
  },
  async listSessions() {
    // New route. `pace` is the clean-lap times in lap order — the existing
    // home-page query already computes everything else it needs.
    const res = await fetch(`/api/sessions`);
    if (!res.ok) throw new Error(`sessions: ${res.status}`);
    return (await res.json()) as SessionRow[];
  },
  async listIngest() {
    // ingest_files WHERE status != 'done', plus the most recent few that are.
    const res = await fetch(`/api/ingest`);
    if (!res.ok) throw new Error(`ingest: ${res.status}`);
    return (await res.json()) as IngestRow[];
  },
};

export const data: DataSource = IS_FIXTURE ? fixtureSource : neonSource;
