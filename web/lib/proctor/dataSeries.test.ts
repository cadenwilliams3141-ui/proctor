import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHANNEL_BY_KEY,
  availableChannels,
  fromSamples,
  fromTrace,
  indexAt,
  interpAt,
  thin,
  type LapSeries,
} from "@/lib/proctor/dataSeries";
import { decodeLap, type SampleHeader } from "@/lib/proctor/samples";
import type { Trace } from "@/lib/proctor/types";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "samples-lap.json"), "utf8")) as {
  lap: number; header: SampleHeader; data_b64: string;
};

function series(lap: number, t: number[], d: number[], ch: Record<string, number[]>): LapSeries {
  return {
    lap, source: "samples", n: t.length, t: Float64Array.from(t), d: Float64Array.from(d),
    ch: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, Float64Array.from(v)])),
  };
}

describe("lap series", () => {
  it("takes time and distance from full-rate samples", async () => {
    const lap = await decodeLap({ lap: 1, header: fx.header, data: new Uint8Array(Buffer.from(fx.data_b64, "base64")) });
    const s = fromSamples(lap);
    expect(s.source).toBe("samples");
    expect(s.t.length).toBe(s.n);
    expect("t" in s.ch).toBe(false);
    expect(s.t[s.n - 1]).toBeGreaterThan(s.t[0]);
  });

  it("rebuilds time from speed for a grid-only lap, and says so", () => {
    const n = 1000;
    const trace = {
      lap_number: 3, lap_time_s: 100, grid_pct: Array.from({ length: n }, (_, i) => (i + 0.5) / n),
      speed: Array(n).fill(40), throttle: Array(n).fill(1), brake: Array(n).fill(0), brake_raw: Array(n).fill(0),
      steer: Array(n).fill(0), gear: Array(n).fill(4), rpm: Array(n).fill(7000), lat_accel: Array(n).fill(0),
      long_accel: Array(n).fill(0), lat_gps: Array(n).fill(0), lon_gps: Array(n).fill(0), abs_active: null,
    } as unknown as Trace;
    const s = fromTrace(trace, 4000);
    expect(s.source).toBe("grid");
    expect(s.d[n - 1]).toBeCloseTo(3998, 0);
    expect(s.t[n - 1]).toBeLessThanOrEqual(100);
  });
});

describe("math channels", () => {
  const ref = series(1, [0, 10, 20], [0, 500, 1000], { speed: [50, 50, 50] });
  const slow = series(2, [0, 11, 22], [0, 500, 1000], { speed: [45, 45, 45] });

  it("time delta is time lost at the same place, against the reference", () => {
    const d = CHANNEL_BY_KEY.delta.compute(slow, ref)!;
    expect(Array.from(d)).toEqual([0, 1, 2]);
    expect(CHANNEL_BY_KEY.delta.compute(slow, null)).toBeNull();
  });

  it("slip ratio is negative for a wheel slower than the car", () => {
    const s = series(1, [0, 1], [0, 1], { speed: [50, 50], lf_speed: [50, 25] });
    expect(Array.from(CHANNEL_BY_KEY.slip_lf.compute(s, null)!)).toEqual([0, -50]);
  });

  it("units are the ones a driver reads", () => {
    const s = series(1, [0], [0], { speed: [10], lat_accel: [9.81], long_accel: [0] });
    expect(CHANNEL_BY_KEY.speed.compute(s, null)![0]).toBeCloseTo(36);
    expect(CHANNEL_BY_KEY.lat_g.compute(s, null)![0]).toBeCloseTo(1);
    expect(CHANNEL_BY_KEY.combined_g.compute(s, null)![0]).toBeCloseTo(1);
  });

  it("offers only channels every selected lap carries", () => {
    const a = series(1, [0], [0], { speed: [1], vel_x: [1], vel_y: [0] });
    const b = series(2, [0], [0], { speed: [1] });
    const keys = availableChannels([a, b]).map((c) => c.key);
    expect(keys).toContain("speed");
    expect(keys).not.toContain("beta");
  });
});

describe("helpers", () => {
  const xs = Float64Array.from([0, 1, 2, 3]);
  it("interpolates and holds the ends", () => {
    expect(interpAt(xs, Float64Array.from([0, 10, 20, 30]), 1.5)).toBe(15);
    expect(interpAt(xs, Float64Array.from([0, 10, 20, 30]), 9)).toBe(30);
    expect(indexAt(xs, 2.4)).toBe(2);
  });

  it("thinning keeps a one-sample spike", () => {
    const n = 10000;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = new Float64Array(n);
    y[4321] = 99;
    const idx = thin(x, y, 0, n, 400);
    expect(idx.length).toBeLessThanOrEqual(400);
    expect(idx).toContain(4321);
  });
});
