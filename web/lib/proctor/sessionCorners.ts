/* Every clean lap against the best one, corner by corner — the session's own
 * map of where time usually goes.
 *
 * The corner view reads ONE lap against the best. This reads all of them at
 * once, so the Report can say "Turn 5 is where your laps typically fall
 * behind" and colour the track by it. Same arithmetic as the ledger, run once
 * per clean lap; nothing here is modelled.
 *
 * Two figures per corner:
 *   typical  the MEDIAN of what the other clean laps lost (+) or gained (−)
 *            there against the best lap. A median, so one scruffy lap cannot
 *            paint a corner red on its own.
 *   quickest the most any clean lap GAINED there against the best lap (≤ 0),
 *            i.e. how far the best lap itself was off your own quickest pass
 *            through that corner.
 *
 * "Best corners combined" adds those gains to the best lap time: your best lap
 * with every corner taken at your own quickest pass through it this session.
 * It was never driven as one lap and is labelled so wherever it appears. The
 * straights between corners are left exactly as the best lap drove them — the
 * ledger keeps them in their own remainder and so does this. */

import { buildLedger } from "@/lib/proctor/ledger";
import type { Corner, Trace } from "@/lib/proctor/types";

export interface CornerTypical {
  id: number;
  /** Median seconds the other clean laps lost (+) or gained (−) here. */
  typical: number;
  /** Most any clean lap gained here against the best lap; 0 when none did. */
  quickest: number;
  /** Which lap that was, or null when no lap beat the best lap here. */
  quickestLap: number | null;
  /** Clean laps compared (the best lap itself is not one of them). */
  laps: number;
}

export interface SessionCorners {
  bestLap: number;
  corners: CornerTypical[];
  /** Best lap time plus every corner's quickest gain. */
  combined: number;
}

export function sessionCorners(
  corners: Corner[],
  traces: Record<number, Trace>,
  bestLap: number,
  cleanLaps: number[],
): SessionCorners | null {
  const best = traces[bestLap];
  if (!best || corners.length === 0) return null;
  const others = cleanLaps.filter((n) => n !== bestLap && traces[n]);
  if (others.length === 0) return null;

  const perCorner = new Map<number, { lap: number; d: number }[]>();
  for (const n of others) {
    const ledger = buildLedger(corners, best, traces[n]);
    for (const c of ledger.corners) {
      const list = perCorner.get(c.corner.id) ?? [];
      list.push({ lap: n, d: c.delta });
      perCorner.set(c.corner.id, list);
    }
  }

  const out: CornerTypical[] = corners.map((c) => {
    const list = perCorner.get(c.id) ?? [];
    const quickest = list.reduce((m, x) => (x.d < m.d ? x : m), { lap: -1, d: 0 });
    return {
      id: c.id,
      typical: median(list.map((x) => x.d)),
      quickest: quickest.d,
      quickestLap: quickest.lap >= 0 ? quickest.lap : null,
      laps: list.length,
    };
  });

  return {
    bestLap,
    corners: out,
    combined: best.lap_time_s + out.reduce((s, c) => s + c.quickest, 0),
  };
}

export function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
