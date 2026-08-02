/* The time base is the fix for the Live screen's inverted playback, so it is
 * worth proving rather than eyeballing. Every test here is a property that has
 * to hold for the replay to be honest:
 *
 *   - a lap takes exactly as long as it was recorded taking;
 *   - the car covers less distance per second where it was going slower;
 *   - the marker is somewhere sensible at every moment of the lap.
 */

import { describe, expect, it } from "vitest";

import { buildTimebase, sampleAt, stepAt } from "./timebase";
import type { Trace } from "./types";

/** A trace with a given speed profile on the standard 1000-point grid. */
function trace(speed: number[], lapTime: number): Trace {
  const n = speed.length;
  const zeros = new Array<number>(n).fill(0);
  return {
    lap_number: 1,
    lap_time_s: lapTime,
    grid_pct: speed.map((_, i) => (i + 0.5) / n),
    speed,
    throttle: zeros,
    brake: zeros,
    brake_raw: zeros,
    steer: zeros,
    gear: zeros,
    rpm: zeros,
    lat_accel: zeros,
    long_accel: zeros,
    lat_gps: zeros,
    lon_gps: zeros,
    abs_active: null,
  };
}

/** Half the lap at 20 m/s, half at 80 m/s — a straight and a hairpin. */
function twoSpeeds(n = 1000, slow = 20, fast = 80): number[] {
  return Array.from({ length: n }, (_, i) => (i < n / 2 ? slow : fast));
}

describe("buildTimebase", () => {
  it("ends at the lap time that was actually recorded", () => {
    const tb = buildTimebase(trace(twoSpeeds(), 90));
    expect(tb.lapTime).toBe(90);
    expect(tb.elapsed[tb.elapsed.length - 1]).toBeCloseTo(90, 1);
  });

  it("is monotonic — time never runs backwards round the lap", () => {
    const tb = buildTimebase(trace(twoSpeeds(), 90));
    for (let i = 1; i < tb.elapsed.length; i++) {
      expect(tb.elapsed[i]).toBeGreaterThanOrEqual(tb.elapsed[i - 1]);
    }
  });

  it("spends time in proportion to how slowly the section was driven", () => {
    // The slow half is a quarter the speed, so it takes four times as long
    // despite covering the same distance. This is the whole bug in one figure:
    // a constant-distance sweep gives both halves the same time.
    const tb = buildTimebase(trace(twoSpeeds(1000, 20, 80), 100));
    const halfway = tb.elapsed[500];
    expect(halfway / tb.lapTime).toBeCloseTo(0.8, 2);
  });

  it("puts the car less far round the lap early on when the start is slow", () => {
    const tb = buildTimebase(trace(twoSpeeds(1000, 20, 80), 100));
    // At the midpoint of the LAP TIME the car is nowhere near the midpoint of
    // the lap: it is still grinding through the slow half.
    const idx = tb.indexAt(50);
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(400);
  });

  it("is flat when the speed is, so a constant-speed lap sweeps evenly", () => {
    const tb = buildTimebase(trace(new Array(1000).fill(50), 80));
    expect(tb.indexAt(40)).toBeCloseTo(499.5, 0);
  });

  it("round-trips a time through indexAt and back", () => {
    const tb = buildTimebase(trace(twoSpeeds(), 90));
    for (const t of [0, 7.5, 33, 61, 89.9]) {
      expect(tb.timeAt(tb.indexAt(t))).toBeCloseTo(t, 3);
    }
  });

  it("clamps outside the lap rather than running off the end of the array", () => {
    const tb = buildTimebase(trace(twoSpeeds(), 90));
    expect(tb.indexAt(-5)).toBe(0);
    expect(tb.indexAt(1e6)).toBe(999);
    expect(tb.timeAt(-3)).toBe(0);
    expect(tb.timeAt(5000)).toBe(90);
  });

  it("survives a lap that stopped, instead of freezing there forever", () => {
    // A spin puts real zeros in the speed channel. Dividing by them would make
    // the sweep take infinitely long to cross that sample.
    const speed = twoSpeeds();
    for (let i = 300; i < 320; i++) speed[i] = 0;
    const tb = buildTimebase(trace(speed, 95));
    expect(Number.isFinite(tb.elapsed[999])).toBe(true);
    expect(tb.elapsed[999]).toBeCloseTo(95, 1);
  });

  it("falls back to the integrated time when no lap time was recorded", () => {
    // A partial lap reaches the UI with lap_time_s of 0. Scaling onto that
    // would collapse the whole curve to zero and the marker would never move.
    const tb = buildTimebase(trace(new Array(1000).fill(50), 0));
    expect(tb.lapTime).toBeGreaterThan(0);
    expect(tb.indexAt(tb.lapTime / 2)).toBeCloseTo(499.5, 0);
  });

  it("answers honestly for an empty trace", () => {
    const tb = buildTimebase(trace([], 0));
    expect(tb.lapTime).toBe(0);
    expect(tb.indexAt(10)).toBe(0);
  });
});

describe("sampleAt", () => {
  it("interpolates between the samples the playhead sits between", () => {
    expect(sampleAt([0, 10, 20], 0.5)).toBeCloseTo(5);
    expect(sampleAt([0, 10, 20], 1.25)).toBeCloseTo(12.5);
  });

  it("wraps across the start/finish line rather than clamping", () => {
    // The lap is a closed loop: the sample after the last one is the first.
    expect(sampleAt([0, 10, 20], 2.5)).toBeCloseTo(10);
    expect(sampleAt([0, 10, 20], -0.5)).toBeCloseTo(10);
  });

  it("returns zero for an empty channel rather than NaN", () => {
    expect(sampleAt([], 3)).toBe(0);
  });
});

describe("stepAt", () => {
  it("never invents a value between two steps", () => {
    // There is no gear 3.4. Interpolating a stepped channel would print one.
    expect(stepAt([3, 4], 0.4)).toBe(3);
    expect(stepAt([3, 4], 0.6)).toBe(4);
  });

  it("wraps the same way the interpolating reader does", () => {
    expect(stepAt([3, 4, 5], 3)).toBe(3);
    expect(stepAt([3, 4, 5], -1)).toBe(5);
  });
});
