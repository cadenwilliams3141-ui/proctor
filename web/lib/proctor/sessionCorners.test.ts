import { describe, expect, it } from "vitest";

import { buildLedger } from "./ledger";
import { median, sessionCorners } from "./sessionCorners";
import type { Corner, Trace } from "./types";

const N = 300;

/** Two corners, at samples 75 and 225. `slow` takes km/h off each apex. */
function lap(n: number, slow: [number, number]): Trace {
  const speed: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = Math.exp(-(((i - 75) / 18) ** 2));
    const b = Math.exp(-(((i - 225) / 18) ** 2));
    speed.push(55 - (25 + slow[0] / 3.6) * a - (25 + slow[1] / 3.6) * b);
  }
  const zeros = speed.map(() => 0);
  return {
    lap_number: n,
    lap_time_s: speed.reduce((s, v) => s + 5 / v, 0),
    grid_pct: speed.map((_, i) => i / N),
    speed,
    throttle: zeros,
    brake: zeros,
    brake_raw: zeros,
    steer: zeros,
    gear: zeros,
    rpm: zeros,
    lat_accel: zeros,
    long_accel: zeros,
    lat_gps: [],
    lon_gps: [],
    abs_active: null,
  };
}

const corners: Corner[] = [
  { id: 1, start_pct: 55 / N, apex_pct: 75 / N, end_pct: 95 / N, radius_m: null, dir: null },
  { id: 2, start_pct: 205 / N, apex_pct: 225 / N, end_pct: 245 / N, radius_m: null, dir: null },
];

describe("sessionCorners", () => {
  // Lap 1 is the best overall, but lap 3 is quicker through turn 2.
  const traces: Record<number, Trace> = {
    1: lap(1, [0, 2]),
    2: lap(2, [6, 4]),
    3: lap(3, [8, 0]),
    4: lap(4, [5, 5]),
  };

  it("takes the median of what the other clean laps lost in each corner", () => {
    const s = sessionCorners(corners, traces, 1, [1, 2, 3, 4])!;
    const t1 = [2, 3, 4].map((n) => buildLedger(corners, traces[1], traces[n]).corners[0].delta);
    expect(s.corners[0].typical).toBeCloseTo(median(t1), 12);
    expect(s.corners[0].laps).toBe(3);
  });

  it("finds the lap that beat the best lap through a corner", () => {
    const s = sessionCorners(corners, traces, 1, [1, 2, 3, 4])!;
    expect(s.corners[1].quickestLap).toBe(3);
    expect(s.corners[1].quickest).toBeLessThan(0);
    // Nobody beat lap 1 through turn 1.
    expect(s.corners[0].quickestLap).toBeNull();
    expect(s.corners[0].quickest).toBe(0);
  });

  it("combines the best lap with every corner's quickest pass, never above the best lap", () => {
    const s = sessionCorners(corners, traces, 1, [1, 2, 3, 4])!;
    expect(s.combined).toBeCloseTo(traces[1].lap_time_s + s.corners[1].quickest, 12);
    expect(s.combined).toBeLessThan(traces[1].lap_time_s);
  });

  it("has nothing to say with one clean lap", () => {
    expect(sessionCorners(corners, traces, 1, [1])).toBeNull();
  });

  it("leaves laps out that have no stored trace", () => {
    const s = sessionCorners(corners, { 1: traces[1], 2: traces[2] }, 1, [1, 2, 3])!;
    expect(s.corners[0].laps).toBe(1);
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
