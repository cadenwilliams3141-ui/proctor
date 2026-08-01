/* ╔═══════════════════════════════════════════════════════════════════════╗
   ║  THE SWAP POINT — SWAPPED                                             ║
   ║                                                                       ║
   ║  Every screen in the redesign reads its data through this module and  ║
   ║  no other, and nothing else knows where the data came from.           ║
   ║                                                                       ║
   ║  It came from a synthetic generator while the redesign was built away ║
   ║  from the connectors. It now comes from Neon, through the routes      ║
   ║  under app/api. The generator has been deleted: with the connectors   ║
   ║  wired, a code path that can put plausible-but-invented telemetry on  ║
   ║  screen is a liability rather than a convenience.                     ║
   ║                                                                       ║
   ║  The shaping of DB rows into these payloads lives server-side in      ║
   ║  lib/proctor/server/, so the desktop and the phone read one set of    ║
   ║  numbers produced by one piece of code.                               ║
   ╚═══════════════════════════════════════════════════════════════════════╝ */

import type { IngestRow, SessionBundle, SessionRow, Trace } from "@/lib/proctor/types";

export type SourceKind = "neon";

/** The one source the app has. */
export const SOURCE: SourceKind = "neon";

/** True whenever the numbers on screen are synthetic — which is now never,
 *  because nothing synthetic is compiled into the app any more.
 *
 *  The "sample data" marker in the top bar and the phone banner still read
 *  this, and are deliberately left in place: they are the affordance that keeps
 *  a screen full of plausible telemetry from ever being mistaken for a real
 *  session, and they should be here waiting if a second source is ever added. */
export const IS_FIXTURE: boolean = false;

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

/** A failed read has to reach the screen as a sentence, not as an empty panel —
 *  the shell renders it verbatim under "This session could not be read". So the
 *  route's own error text is preferred over the bare status code. */
async function failure(res: Response, what: string): Promise<Error> {
  let detail = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) detail = body.error;
  } catch {
    // Not JSON — the status line is all there is to say.
  }
  return new Error(`${what}: ${detail}`);
}

const neonSource: DataSource = {
  async loadSession(sessionId) {
    // "latest" is resolved server-side to the newest ingested session: the
    // shell has to load something before the driver has picked anything.
    const res = await fetch(`/api/session/${sessionId}/data`);
    if (!res.ok) throw await failure(res, `session ${sessionId}`);
    return (await res.json()) as SessionBundle;
  },
  async loadTraces(sessionId, lapNumbers) {
    // The route caps at 4 laps per request, which is enough for the A/B
    // comparison plus a lookahead. Batch if that ever needs to grow.
    const res = await fetch(`/api/session/${sessionId}/traces?laps=${lapNumbers.join(",")}`);
    if (!res.ok) throw await failure(res, `traces ${lapNumbers.join(",")}`);
    const body = (await res.json()) as { traces: Trace[] };
    return body.traces ?? [];
  },
  async listSessions() {
    const res = await fetch(`/api/sessions`);
    if (!res.ok) throw await failure(res, "sessions");
    return (await res.json()) as SessionRow[];
  },
  async listIngest() {
    const res = await fetch(`/api/ingest`);
    if (!res.ok) throw await failure(res, "ingest queue");
    return (await res.json()) as IngestRow[];
  },
};

export const data: DataSource = neonSource;
