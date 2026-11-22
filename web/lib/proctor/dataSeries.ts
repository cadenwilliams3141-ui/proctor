/* One lap as the Data workspace reads it: time, distance and every channel,
 * whatever the lap was stored as.
 *
 * Full-rate samples (lap_samples) are the real thing: every tick, a true time
 * axis read off the sim's clock, distance from the line in metres, ~37
 * channels. Sessions ingested before full-rate storage only have the 1000-point
 * distance grid; for those, time is rebuilt from speed (lib/proctor/timebase)
 * and the series says so in `source`, so a screen can label which one it drew.
 *
 * Also here: the units a driver reads (km/h, g, %, degrees) and the math
 * channels a MoTeC user expects. Pure; unit-tested. */

import type { LapSamples } from "@/lib/proctor/samples";
import { buildTimebase } from "@/lib/proctor/timebase";
import type { Trace } from "@/lib/proctor/types";

export interface LapSeries {
  lap: number;
  source: "samples" | "grid";
  n: number;
  /** seconds since the start/finish crossing */
  t: Float64Array;
  /** metres from the line */
  d: Float64Array;
  ch: Record<string, Float64Array>;
}

export function fromSamples(s: LapSamples): LapSeries {
  const { t, d, ...rest } = s.ch;
  return { lap: s.lap, source: "samples", n: s.n, t, d, ch: rest };
}

const GRID_KEYS = ["speed", "throttle", "brake", "brake_raw", "steer", "gear", "rpm", "lat_accel", "long_accel", "lat_gps", "lon_gps"] as const;

export function fromTrace(trace: Trace, lengthM: number): LapSeries {
  const n = trace.speed.length;
  const tb = buildTimebase(trace);
  const ch: Record<string, Float64Array> = {};
  for (const k of GRID_KEYS) {
    const v = (trace as unknown as Record<string, number[] | undefined>)[k];
    if (Array.isArray(v) && v.length === n) ch[k] = Float64Array.from(v);
  }
  if (trace.abs_active) ch.abs_active = Float64Array.from(trace.abs_active);
  return {
    lap: trace.lap_number,
    source: "grid",
    n,
    t: Float64Array.from(tb.elapsed),
    d: Float64Array.from(trace.grid_pct, (p) => p * lengthM),
    ch,
  };
}

/** Linear interpolation of ys at x along increasing xs (held at the ends). */
export function interpAt(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const f = span > 0 ? (x - xs[lo]) / span : 0;
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/** Index of the last sample with xs[i] <= x. */
export function indexAt(xs: Float64Array, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0) return 0;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

const G = 9.81;
const DEG = 180 / Math.PI;

export interface ChannelDef {
  key: string;
  label: string;
  unit: string;
  /** decimals for the readout */
  dp: number;
  /** stored channels it needs; math channels need more than one */
  needs: string[];
  /** compute the display series; `ref` is the reference lap for deltas */
  compute: (s: LapSeries, ref: LapSeries | null) => Float64Array | null;
  math?: boolean;
}

const scaled = (key: string, k: number) => (s: LapSeries) => {
  const v = s.ch[key];
  return v ? v.map((x) => x * k) : null;
};

/** Every channel the workspace can draw, in the order the picker lists them. */
export const CHANNELS: ChannelDef[] = [
  {
    key: "delta", label: "Time delta", unit: "s", dp: 3, needs: [], math: true,
    // Time lost (+) or gained (-) against the reference lap at the same place.
    compute: (s, ref) => {
      if (!ref) return null;
      const out = new Float64Array(s.n);
      for (let i = 0; i < s.n; i++) out[i] = s.t[i] - interpAt(ref.d, ref.t, s.d[i]);
      return out;
    },
  },
  { key: "speed", label: "Speed", unit: "km/h", dp: 1, needs: ["speed"], compute: scaled("speed", 3.6) },
  { key: "throttle", label: "Throttle", unit: "%", dp: 0, needs: ["throttle"], compute: scaled("throttle", 100) },
  { key: "brake_raw", label: "Brake pedal", unit: "%", dp: 0, needs: ["brake_raw"], compute: scaled("brake_raw", 100) },
  { key: "brake", label: "Brake applied", unit: "%", dp: 0, needs: ["brake"], compute: scaled("brake", 100) },
  { key: "steer", label: "Steering", unit: "°", dp: 1, needs: ["steer"], compute: scaled("steer", DEG) },
  { key: "gear", label: "Gear", unit: "", dp: 0, needs: ["gear"], compute: (s) => s.ch.gear ?? null },
  { key: "rpm", label: "RPM", unit: "rpm", dp: 0, needs: ["rpm"], compute: (s) => s.ch.rpm ?? null },
  { key: "lat_g", label: "Lateral g", unit: "g", dp: 2, needs: ["lat_accel"], compute: scaled("lat_accel", 1 / G) },
  { key: "long_g", label: "Longitudinal g", unit: "g", dp: 2, needs: ["long_accel"], compute: scaled("long_accel", 1 / G) },
  {
    key: "combined_g", label: "Combined g", unit: "g", dp: 2, needs: ["lat_accel", "long_accel"], math: true,
    compute: (s) => {
      const a = s.ch.lat_accel, b = s.ch.long_accel;
      return a && b ? a.map((x, i) => Math.hypot(x, b[i]) / G) : null;
    },
  },
  { key: "vert_g", label: "Vertical g", unit: "g", dp: 2, needs: ["vert_accel"], compute: scaled("vert_accel", -1 / G) },
  { key: "yaw_rate", label: "Yaw rate", unit: "°/s", dp: 1, needs: ["yaw_rate"], compute: scaled("yaw_rate", DEG) },
  {
    key: "beta", label: "Body slip angle", unit: "°", dp: 1, needs: ["vel_x", "vel_y"], math: true,
    // Where the car points against where it goes: atan2(vy, vx).
    compute: (s) => {
      const vx = s.ch.vel_x, vy = s.ch.vel_y;
      return vx && vy ? vx.map((x, i) => (Math.abs(x) > 3 ? Math.atan2(vy[i], Math.abs(x)) * DEG : 0)) : null;
    },
  },
  ...(["lf", "rf", "lr", "rr"] as const).map(
    (w): ChannelDef => ({
      key: `slip_${w}`, label: `Slip ratio ${w.toUpperCase()}`, unit: "%", dp: 1, needs: [`${w}_speed`, "speed"], math: true,
      // Wheel against ground: below zero is a wheel slower than the car (locking).
      compute: (s) => {
        const ws = s.ch[`${w}_speed`], v = s.ch.speed;
        return ws && v ? ws.map((x, i) => (v[i] > 5 ? (x / v[i] - 1) * 100 : 0)) : null;
      },
    }),
  ),
  {
    key: "overlap", label: "Brake–throttle overlap", unit: "%", dp: 0, needs: ["throttle", "brake_raw"], math: true,
    compute: (s) => {
      const a = s.ch.throttle, b = s.ch.brake_raw;
      return a && b ? a.map((x, i) => Math.min(x, b[i]) * 100) : null;
    },
  },
  { key: "abs_active", label: "ABS active", unit: "", dp: 0, needs: ["abs_active"], compute: (s) => s.ch.abs_active ?? null },
  { key: "steer_torque", label: "Column torque", unit: "N·m", dp: 1, needs: ["steer_torque"], compute: (s) => s.ch.steer_torque ?? null },
  { key: "fuel", label: "Fuel", unit: "L", dp: 2, needs: ["fuel"], compute: (s) => s.ch.fuel ?? null },
  { key: "lf_temp_m", label: "LF temp (middle)", unit: "°C", dp: 1, needs: ["lf_temp_m"], compute: (s) => s.ch.lf_temp_m ?? null },
  { key: "alt", label: "Altitude", unit: "m", dp: 1, needs: ["alt"], compute: (s) => s.ch.alt ?? null },
];

export const CHANNEL_BY_KEY: Record<string, ChannelDef> = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

/** Channels every one of these laps can produce. */
export function availableChannels(laps: LapSeries[]): ChannelDef[] {
  if (laps.length === 0) return [];
  return CHANNELS.filter((c) =>
    c.key === "delta" ? laps.length > 0 : c.needs.every((k) => laps.every((l) => k in l.ch)),
  );
}

/** Indices of samples to draw so no series carries more than `max` points,
 *  keeping each stride's min and max so a spike survives the thinning. */
export function thin(xs: Float64Array, ys: Float64Array, x0: number, x1: number, max: number): number[] {
  const lo = Math.max(0, indexAt(xs, x0) - 1);
  const hi = Math.min(xs.length - 1, indexAt(xs, x1) + 1);
  const count = hi - lo + 1;
  if (count <= max) return Array.from({ length: Math.max(count, 0) }, (_, i) => lo + i);
  const buckets = Math.max(1, Math.floor(max / 2));
  const step = count / buckets;
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const a = lo + Math.floor(b * step);
    const e = Math.min(hi, lo + Math.floor((b + 1) * step) - 1);
    let mi = a, ma = a;
    for (let i = a; i <= e; i++) {
      if (ys[i] < ys[mi]) mi = i;
      if (ys[i] > ys[ma]) ma = i;
    }
    if (mi < ma) out.push(mi, ma);
    else if (ma < mi) out.push(ma, mi);
    else out.push(mi);
  }
  return out;
}
