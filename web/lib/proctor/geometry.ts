/* Shared SVG geometry. Six components draw the circuit at six different sizes;
 * all of them project through here so the map is the same shape everywhere. */

export interface Projection {
  X: (metresX: number) => number;
  Y: (metresY: number) => number;
}

/** Fit the circuit into a viewBox, preserving aspect ratio and centring it. */
export function project(
  xs: number[],
  ys: number[],
  w: number,
  h: number,
  pad: number,
): Projection {
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
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

export const wrapIndex = wrapAt;
