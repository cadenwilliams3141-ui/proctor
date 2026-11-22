/* Positions in the coaching engine's frame, mapped onto what a screen draws.
 *
 * The engine measures every pass in METRES from the start of its corner's
 * segment. The map and the traces are on the shared distance grid (gridSize
 * samples round the lap). These helpers are the only conversion between the
 * two, so a brake point drawn on the map and a brake point quoted in a
 * sentence can never disagree. Pure; unit-tested. */

import type { CoachData, CornerLapsData, CornerRuns, SegmentCorner, SegmentsData } from "@/lib/proctor/types";

/** Track metres for a position u metres into a corner's segment (wrapped). */
export function trackM(corner: SegmentCorner, u: number, lengthM: number): number {
  return (((corner.seg_start_m + u) % lengthM) + lengthM) % lengthM;
}

/** Grid sample index for track metres. */
export function gridIndex(m: number, lengthM: number, n: number): number {
  return Math.round(((((m % lengthM) + lengthM) % lengthM) / lengthM) * (n - 1));
}

/** The sample range of a whole segment on the grid; `to` may exceed n-1 for a
 *  segment that crosses the line (TrackMap and pathFor wrap it). */
export function segmentRange(corner: SegmentCorner, lengthM: number, n: number) {
  const from = gridIndex(corner.seg_start_m, lengthM, n);
  const span = Math.round(((corner.seg_end_m - corner.seg_start_m) / lengthM) * (n - 1));
  return { from, to: from + span };
}

/** The corner proper (typical brake point to typical full throttle) on the grid. */
export function cornerRange(
  corner: SegmentCorner,
  runs: CornerRuns | null | undefined,
  lengthM: number,
  n: number,
) {
  const apexU = (((corner.apex_m - corner.seg_start_m) % lengthM) + lengthM) % lengthM;
  const a = Math.max(0, (runs?.landmarks.brake_on ?? apexU - 100) - 10);
  const b = Math.min(corner.seg_end_m - corner.seg_start_m, (runs?.landmarks.full ?? apexU + 60) + 10);
  const from = gridIndex(trackM(corner, a, lengthM), lengthM, n);
  const span = Math.round(((b - a) / lengthM) * (n - 1));
  return { from, to: from + span };
}

export interface CornerBundle {
  corner: SegmentCorner;
  runs: CornerRuns | null;
  status: CoachData["corners"][number] | null;
  actions: CoachData["actions"];
}

/** Everything the screens need about one corner, in one lookup. */
export function cornerBundle(
  id: number,
  seg: SegmentsData | null,
  laps: CornerLapsData | null,
  coach: CoachData | null,
): CornerBundle | null {
  const corner = seg?.corners.find((c) => c.id === id);
  if (!corner) return null;
  return {
    corner,
    runs: laps?.corners.find((c) => c.id === id) ?? null,
    status: coach?.corners.find((c) => c.id === id) ?? null,
    actions: coach?.actions.filter((a) => a.corner === id) ?? [],
  };
}

/** Two real passes to overlay: the fastest usable pass, and the one that
 *  stands for the rest. With `shortLaps` (the passes an action says fell short)
 *  that is the median-time pass AMONG them, so the overlay shows the difference
 *  the action is about; otherwise the usable pass nearest the median time.
 *  Lap numbers, or null. */
export function typicalAndBest(
  runs: CornerRuns | null,
  shortLaps?: number[],
): { typical: number | null; best: number | null; fromShort: boolean } {
  if (!runs) return { typical: null, best: null, fromShort: false };
  const rows = runs.runs.lap
    .map((lap, i) => ({ lap, t: runs.runs.time_s[i], ok: runs.runs.usable[i] }))
    .filter((r) => r.ok && Number.isFinite(r.t));
  if (rows.length === 0) return { typical: null, best: null, fromShort: false };
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const best = sorted[0].lap;
  const nearestMedian = (pool: typeof rows) => {
    const ps = [...pool].sort((a, b) => a.t - b.t);
    const med = ps[Math.floor((ps.length - 1) / 2)].t;
    return pool.reduce((b, r) => (Math.abs(r.t - med) < Math.abs(b.t - med) ? r : b)).lap;
  };
  const short = shortLaps?.length ? rows.filter((r) => shortLaps.includes(r.lap) && r.lap !== best) : [];
  if (short.length) return { typical: nearestMedian(short), best, fromShort: true };
  return { typical: nearestMedian(rows), best, fromShort: false };
}

/** Names of the run-quality flags set on a pass, from the payload's own bits. */
export function flagNames(bits: Record<string, number>, flags: number): string[] {
  return Object.entries(bits)
    .filter(([, bit]) => (flags & bit) !== 0)
    .map(([name]) => name.replace(/_/g, " "));
}
