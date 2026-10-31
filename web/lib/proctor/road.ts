/* The road and the lines on it, in the local metres frame.
 *
 * Shared by the racing-line view and the corner-by-corner view, so the two draw
 * the same road from the same numbers. Moved here unchanged from RacingLine.tsx;
 * the reasoning in each comment is still the reason.
 *
 * TWO DIFFERENT CLAIMS, KEPT APART: `TrackBoundary` is the racing surface — the
 * furthest out the sim's own PlayerTrackSurface flag still called the car on
 * track, accumulated over every session at the circuit. `TrackWidthData` is the
 * band between the driver's own lines this session. The first is the road; the
 * second is where the driver put the car on it. */

import { gpsToLocal, smoothRing, wrapIndex } from "@/lib/proctor/geometry";
import type { Trace, TrackBoundary, TrackWidthData } from "@/lib/proctor/types";

type Pt = { X: (v: number) => number; Y: (v: number) => number };

/** Edge coordinates for the MEASURED surface. NaN marks an unmeasured bin.
 *
 *  The boundary's arrays are deliberately sparse — a null is a stretch of road
 *  nothing has driven through yet — and that has to survive all the way to the
 *  path, because filling it in would draw a road narrowing to nothing on the
 *  centreline. */
export function boundaryEdge(
  tb: TrackBoundary,
  key: "left_m" | "right_m",
  exaggerate = 1,
  window = 1,
) {
  const n = tb.centre_x_m.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const off = smoothRing(tb[key], window);
  for (let i = 0; i < n; i++) {
    const d = off[i];
    if (d == null) {
      x[i] = NaN;
      y[i] = NaN;
      continue;
    }
    x[i] = tb.centre_x_m[i] + tb.normal_x[i] * d * exaggerate;
    y[i] = tb.centre_y_m[i] + tb.normal_y[i] * d * exaggerate;
  }
  return { x, y };
}

/** A filled ribbon that BREAKS at gaps instead of bridging them.
 *
 *  One `<path>` with several subpaths: each run of consecutive measured bins
 *  becomes its own closed shape, so an unmeasured stretch reads as a hole in
 *  the survey rather than as a piece of track that pinches shut. */
export function surfaceRibbon(
  p: Pt,
  outer: { x: number[]; y: number[] },
  inner: { x: number[]; y: number[] },
  from = 0,
  to = -1,
): string {
  const n = outer.x.length;
  const end = to < 0 ? n - 1 : to;
  const parts: string[] = [];
  let run: number[] = [];

  const flush = () => {
    if (run.length >= 2) {
      const fwd = run.map((k) => `${p.X(outer.x[k]).toFixed(1)} ${p.Y(outer.y[k]).toFixed(1)}`);
      const back = [...run]
        .reverse()
        .map((k) => `${p.X(inner.x[k]).toFixed(1)} ${p.Y(inner.y[k]).toFixed(1)}`);
      parts.push(`M ${fwd.join(" L ")} L ${back.join(" L ")} Z`);
    }
    run = [];
  };

  for (let i = from; i <= end; i++) {
    const k = wrapIndex(i, n);
    if (Number.isFinite(outer.x[k]) && Number.isFinite(inner.x[k])) run.push(k);
    else flush();
  }
  flush();
  return parts.join(" ");
}

/** Median of a sparse series, ignoring the gaps. */
export function medianOf(values: (number | null)[]): number {
  const seen = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (seen.length === 0) return 0;
  const sorted = [...seen].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The centreline of whichever source is driving the view. */
export function centreOf(tb: TrackBoundary | null, tw: TrackWidthData | null) {
  return tb
    ? { x: tb.centre_x_m, y: tb.centre_y_m, origin: tb.origin, n: tb.centre_x_m.length }
    : { x: tw!.centre_x_m, y: tw!.centre_y_m, origin: tw!.origin, n: tw!.centre_x_m.length };
}

/** A lap's own line, measured against whichever centreline is in play.
 *
 *  Rebuilt from its offset rather than drawn at its raw position: under
 *  exaggeration the road moves outward, and a line left at its true position
 *  would drift outside the road it was driven on. */
export function drivenAgainst(
  trace: Trace | null,
  centre: { x: number[]; y: number[]; origin: { lat: number; lon: number } },
  exaggerate = 1,
  window = 1,
) {
  if (!trace || trace.lat_gps.length === 0) return null;
  const raw = gpsToLocal(trace.lat_gps, trace.lon_gps, centre.origin);
  if (exaggerate === 1) return raw;

  const n = Math.min(raw.x.length, centre.x.length);
  const nx = new Array<number>(n);
  const ny = new Array<number>(n);
  const off: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    /* Normal to the centreline here, over the same chord the parser uses for
       its own (track_edges._TANGENT_HALF_CHORD), so the two agree about which
       way sideways points. Measured against real geometry this is the small
       term — widening the chord alone barely moves the sawtooth. What the eye
       is seeing comes from the offset below. */
    const a = (i - 6 + n) % n;
    const b = (i + 6) % n;
    const tx = centre.x[b] - centre.x[a];
    const ty = centre.y[b] - centre.y[a];
    const len = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / len;
    ny[i] = tx / len;
    off[i] = (raw.x[i] - centre.x[i]) * nx[i] + (raw.y[i] - centre.y[i]) * ny[i];
  }

  // Averaged before it is magnified, never after: see smoothRing.
  const settled = smoothRing(off, window);
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d = (settled[i] ?? 0) * exaggerate;
    x[i] = centre.x[i] + nx[i] * d;
    y[i] = centre.y[i] + ny[i] * d;
  }
  return { x, y };
}

/** Edge coordinates in metres: centre + normal * offset, both from the module.
 *
 *  `exaggerate` widens everything away from the centreline by a constant
 *  factor. At full-circuit scale a 3-metre band on a 4-kilometre lap is well
 *  under a pixel, so drawn honestly it is a hairline and the view says nothing.
 *  The multiplier makes it legible; the number is printed on screen beside it,
 *  and the corner view alongside is always at true scale so there is somewhere
 *  to read real metres. */
export function edges(
  tw: TrackWidthData,
  key: "left_m" | "right_m" | "p90_m" | "p10_m",
  exaggerate = 1,
  window = 1,
) {
  const n = tw.centre_x_m.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const off = smoothRing(tw[key], window);
  for (let i = 0; i < n; i++) {
    const d = (off[i] ?? 0) * exaggerate;
    x[i] = tw.centre_x_m[i] + tw.normal_x[i] * d;
    y[i] = tw.centre_y_m[i] + tw.normal_y[i] * d;
  }
  return { x, y };
}

export function ribbonPath(
  p: Pt,
  outer: { x: number[]; y: number[] },
  inner: { x: number[]; y: number[] },
  from = 0,
  to = -1,
  step = 2,
): string {
  const n = outer.x.length;
  const end = to < 0 ? n - 1 : to;
  const fwd: string[] = [];
  const back: string[] = [];
  for (let i = from; i <= end; i += step) {
    const k = wrapIndex(i, n);
    fwd.push(`${p.X(outer.x[k]).toFixed(1)} ${p.Y(outer.y[k]).toFixed(1)}`);
  }
  for (let i = end; i >= from; i -= step) {
    const k = wrapIndex(i, n);
    back.push(`${p.X(inner.x[k]).toFixed(1)} ${p.Y(inner.y[k]).toFixed(1)}`);
  }
  if (fwd.length === 0) return "";
  return `M ${fwd.join(" L ")} L ${back.join(" L ")} Z`;
}

export function linePath(
  p: Pt,
  line: { x: number[]; y: number[] },
  from = 0,
  to = -1,
  step = 2,
): string {
  const n = line.x.length;
  const end = to < 0 ? n - 1 : to;
  const pts: string[] = [];
  for (let i = from; i <= end; i += step) {
    const k = wrapIndex(i, n);
    pts.push(`${p.X(line.x[k]).toFixed(1)} ${p.Y(line.y[k]).toFixed(1)}`);
  }
  return pts.length ? `M ${pts.join(" L ")}` : "";
}
