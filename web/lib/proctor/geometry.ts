/* Shared SVG geometry. Six components draw the circuit at six different sizes;
 * all of them project through here so the map is the same shape everywhere. */

export interface Projection {
  X: (metresX: number) => number;
  Y: (metresY: number) => number;
}

/** Fit the circuit into a viewBox, preserving aspect ratio and centring it.
 *
 *  Non-finite samples are skipped. They are not stray values — they are the
 *  survey's own gaps, arriving as NaN pairs from the edge builders wherever no
 *  on-track sample has ever landed. Handing them to `Math.min` would answer NaN
 *  for the whole set and turn every projected coordinate into NaN, so a single
 *  unmeasured bin anywhere on the lap would blank the entire panel. Looping
 *  rather than spreading also keeps a few thousand samples off the argument
 *  list. */
export function project(
  xs: number[],
  ys: number[],
  w: number,
  h: number,
  pad: number,
): Projection {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Nothing finite to fit to. A unit box keeps the projection callable and the
  // panel empty, which is the honest outcome and not a crash.
  if (minX > maxX) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }
  const s = Math.min(
    (w - 2 * pad) / Math.max(maxX - minX, 1e-6),
    (h - 2 * pad) / Math.max(maxY - minY, 1e-6),
  );
  const ox = pad + (w - 2 * pad - (maxX - minX) * s) / 2;
  const oy = pad + (h - 2 * pad - (maxY - minY) * s) / 2;
  return {
    X: (x) => ox + (x - minX) * s,
    // SVG y grows downward; the circuit's does not.
    Y: (y) => h - oy - (y - minY) * s,
  };
}

const wrapAt = (i: number, n: number) => ((i % n) + n) % n;

/** Degrees of latitude per metre is ~constant; longitude shrinks by cos(lat). */
const M_PER_DEG = 111320;

/** GPS to the local metres frame the parser writes.
 *
 *  Identical to the projection in track_map.py, corners.py and
 *  track_width.py — deliberately, because the centreline, the fitted corner
 *  radii, the used-width band and any lap's own driven line all have to land on
 *  the same canvas. The origin comes from the track_width payload rather than
 *  being recomputed, so a lap the band was not built from still lines up. */
export function gpsToLocal(
  lat: number[],
  lon: number[],
  origin: { lat: number; lon: number },
): { x: number[]; y: number[] } {
  const scaleX = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  const n = Math.min(lat.length, lon.length);
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x[i] = (lon[i] - origin.lon) * scaleX;
    y[i] = (lat[i] - origin.lat) * M_PER_DEG;
  }
  return { x, y };
}

/** Fit a projection to several point sets at once.
 *
 *  A projection fitted to the centreline alone clips the band that hangs off
 *  either side of it, which is the one thing the racing-line view exists to
 *  show. */
export function projectAll(
  sets: { x: number[]; y: number[] }[],
  w: number,
  h: number,
  pad: number,
): Projection {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of sets) {
    xs.push(...s.x);
    ys.push(...s.y);
  }
  return project(xs.length ? xs : [0, 1], ys.length ? ys : [0, 1], w, h, pad);
}

/** An "M x y L x y ..." path over a sample range, wrapping across the line. */
export function pathFor(
  p: Projection,
  xs: number[],
  ys: number[],
  from: number,
  to: number,
  step: number,
): string {
  const n = xs.length;
  const pts: string[] = [];
  for (let i = from; i <= to; i += step) {
    const k = wrapAt(i, n);
    pts.push(`${p.X(xs[k]).toFixed(1)} ${p.Y(ys[k]).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
}

/** Length of that path in viewBox units — needed to drive stroke-dashoffset,
 *  because CSS cannot read a path's length and getTotalLength() would force a
 *  layout read on every render. */
export function pathLength(
  p: Projection,
  xs: number[],
  ys: number[],
  from: number,
  to: number,
  step: number,
): number {
  const n = xs.length;
  let len = 0;
  for (let i = from + step; i <= to; i += step) {
    const a = wrapAt(i - step, n);
    const b = wrapAt(i, n);
    len += Math.hypot(p.X(xs[b]) - p.X(xs[a]), p.Y(ys[b]) - p.Y(ys[a]));
  }
  return len;
}

/** "x,y x,y ..." for a <polyline>. */
export function polyline(
  values: number[],
  toX: (i: number, n: number) => number,
  toY: (v: number) => number,
): string {
  const n = values.length;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = `${toX(i, n).toFixed(1)},${toY(values[i]).toFixed(1)}`;
  }
  return out.join(" ");
}

/** A filled area anchored to a baseline — brake traces, delta fills. */
export function areaPath(
  values: number[],
  toX: (i: number, n: number) => number,
  toY: (v: number) => number,
  baseY: number,
): string {
  const n = values.length;
  if (n === 0) return "";
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(`${toX(i, n).toFixed(1)} ${toY(values[i]).toFixed(1)}`);
  }
  const x0 = toX(0, n).toFixed(1);
  const x1 = toX(n - 1, n).toFixed(1);
  return `M ${x0} ${baseY} L ${pts.join(" L ")} L ${x1} ${baseY} Z`;
}

/** Downsample a channel to `count` points, taking the extreme in each bucket so
 *  a 900-point trace keeps its peaks instead of averaging them away. A brake
 *  trace that loses its peak stops being a brake trace. */
export function resample(values: number[], count: number, keep: "max" | "min" | "mid" = "mid"): number[] {
  const n = values.length;
  if (n <= count) return values.slice();
  const out: number[] = new Array(count);
  const bucket = n / count;
  for (let i = 0; i < count; i++) {
    const s = Math.floor(i * bucket);
    const e = Math.min(n, Math.max(s + 1, Math.floor((i + 1) * bucket)));
    let v = values[s];
    for (let k = s; k < e; k++) {
      if (keep === "max") v = Math.max(v, values[k]);
      else if (keep === "min") v = Math.min(v, values[k]);
      else if (Math.abs(values[k]) > Math.abs(v)) v = values[k];
    }
    out[i] = v;
  }
  return out;
}

/** Min/max of several channels together — a shared scale. Two speed traces on
 *  independent scales hide the very thing the reader is looking for. */
export function sharedExtent(...series: number[][]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const v of s) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo === Infinity ? 0 : lo, hi === -Infinity ? 1 : hi];
}

/** Extent over a sample window, wrapping across the start/finish line. */
export function windowExtent(
  from: number,
  to: number,
  ...series: number[][]
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const n = s.length;
    for (let i = from; i <= to; i++) {
      const v = s[wrapAt(i, n)];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo === Infinity ? 0 : lo, hi === -Infinity ? 1 : hi];
}

/** Centred moving average over a lap-periodic series, in metres.
 *
 *  For OFFSETS, never for positions — the difference matters. The .ibt carries
 *  Lat/Lon as float32, which puts a floor of about 0.43 m on latitude and 0.71 m
 *  on longitude at typical circuit coordinates. An offset is the difference of
 *  two such positions, so it arrives with roughly 0.65 m of bin-to-bin noise
 *  that is quantisation, not driving. Drawn at true scale that is invisible.
 *  Multiplied by a width exaggeration it becomes several metres of sawtooth on
 *  every line and every road edge on the map.
 *
 *  So when the map magnifies the road it averages the offsets over a window
 *  that grows with the magnification, and the panel says it is doing so. A
 *  window of 1 is the identity, which is what the true-scale views use.
 *
 *  Non-finite entries are gaps in the survey: they are neither averaged into
 *  their neighbours nor filled in, so a hole stays exactly as wide as it was. */
export function smoothRing(values: (number | null)[], window: number): (number | null)[] {
  const n = values.length;
  if (window <= 1 || n === 0) return values.slice();
  const half = Math.floor(window / 2);
  const out: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (values[i] == null || !Number.isFinite(values[i] as number)) {
      out[i] = null;
      continue;
    }
    let sum = 0;
    let seen = 0;
    for (let d = -half; d <= half; d++) {
      const v = values[wrapAt(i + d, n)];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      seen++;
    }
    out[i] = seen ? sum / seen : values[i];
  }
  return out;
}

export const wrapIndex = wrapAt;
