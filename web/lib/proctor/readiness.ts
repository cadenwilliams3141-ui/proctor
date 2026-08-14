/* Can a comparison view draw, and if not, why not.
 *
 * Pulled out of the store so it is a pure function of what the session holds,
 * testable without React, and decided in exactly one place. Every analysis view
 * asks this and none of them re-derives it — the bug this replaces was four
 * views each testing `!bundle || !ledger || !traceA || !traceB` and rendering
 * one "Reading the session…" for all four conditions, so a session that could
 * never produce a ledger sat on a loading message forever.
 *
 * Three of the nine sessions in the database have no clean lap at all. For
 * those, "loading" was a promise the screen could not keep.
 */

import type { Trace } from "@/lib/proctor/types";

export type Readiness =
  | { state: "ready" }
  | { state: "loading" }
  | { state: "error"; reason: string }
  /** No lap in the session is clean enough to be a reference. */
  | { state: "no-reference"; reason: string }
  /** A reference exists, but nothing to measure it against. */
  | { state: "no-comparison"; reason: string }
  /** Laps were selected, but their traces are not in the bundle. */
  | { state: "no-traces"; reason: string };

export interface ReadinessInput {
  error: string | null;
  /** null while the bundle is in flight. */
  lapCount: number | null;
  referenceLap: number | null;
  lapA: number | null;
  lapB: number | null;
  traceA: Trace | null;
  traceB: Trace | null;
}

export function deriveReadiness(i: ReadinessInput): Readiness {
  if (i.error) return { state: "error", reason: i.error };
  if (i.lapCount == null) return { state: "loading" };

  if (i.referenceLap == null) {
    return {
      state: "no-reference",
      reason:
        i.lapCount === 0
          ? "This session has no completed laps, so there is no lap to measure anything against."
          : `None of this session's ${i.lapCount} ${
              i.lapCount === 1 ? "lap is" : "laps are"
            } clean enough to serve as a reference — every one is an out lap, an in lap, a partial lap or was flagged. Comparison needs one clean lap to measure against.`,
    };
  }

  // The reference exists but the opening selection has not been seated yet.
  if (i.lapA == null) return { state: "loading" };

  if (i.lapB == null) {
    return {
      state: "no-comparison",
      reason: `Lap ${i.referenceLap} is the only clean lap in this session, so there is nothing to compare it against. Pick a second lap from the rail — including a flagged one, which will be labelled as such — or drive more laps.`,
    };
  }

  if (!i.traceA || !i.traceB) {
    const missing = [
      !i.traceA ? `lap ${i.lapA}` : null,
      !i.traceB ? `lap ${i.lapB}` : null,
    ].filter(Boolean);
    return {
      state: "no-traces",
      reason: `No stored telemetry trace for ${missing.join(
        " or ",
      )}. The lap is recorded but its per-sample data was not saved, so nothing can be drawn against distance.`,
    };
  }

  return { state: "ready" };
}
