import { describe, expect, it } from "vitest";

import { cornerRange, flagNames, gridIndex, segmentRange, trackM, typicalAndBest } from "@/lib/proctor/cornerView";
import type { CornerRuns, SegmentCorner } from "@/lib/proctor/types";

const c: SegmentCorner = {
  id: 5, name: "T5", kind: "brake", complex: false, dir: "right", radius_m: 120, turn_deg: 78, vmin_ms: 42,
  apex_m: 2723, seg_start_m: 2546.8, seg_end_m: 3417.7, start_pct: 0.85, apex_pct: 0.91, end_pct: 0.14,
  wraps: true, sub_apexes: [],
};

describe("cornerView", () => {
  it("maps segment metres to track metres across the line", () => {
    expect(trackM(c, 0, 3000)).toBeCloseTo(2546.8);
    expect(trackM(c, 600, 3000)).toBeCloseTo(146.8);
  });

  it("maps track metres to grid samples", () => {
    expect(gridIndex(0, 3000, 1000)).toBe(0);
    expect(gridIndex(3000, 3000, 1000)).toBe(0);
    expect(gridIndex(1500, 3000, 1000)).toBe(500);
  });

  it("a wrapping segment's range runs past the end rather than backwards", () => {
    const r = segmentRange(c, 3000, 1000);
    expect(r.from).toBe(848);
    expect(r.to).toBeGreaterThan(999);
    expect(r.to - r.from).toBe(290);
  });

  it("the corner proper sits inside its segment", () => {
    const runs = { landmarks: { brake_on: 30, turn_in: 80, v_min_at: 176, full: 254 } } as unknown as CornerRuns;
    const seg = segmentRange(c, 3000, 1000);
    const r = cornerRange(c, runs, 3000, 1000);
    expect(r.from).toBeGreaterThanOrEqual(seg.from);
    expect(r.to).toBeLessThanOrEqual(seg.to);
  });

  it("typical is the usable pass nearest the median; flagged passes never stand for it", () => {
    const runs = {
      runs: { lap: [1, 2, 3, 4, 5], time_s: [10.0, 10.2, 9.0, 10.1, 10.4], usable: [true, true, false, true, true],
        flags: [0, 0, 1, 0, 0], phase_s: [], m: {} },
    } as unknown as CornerRuns;
    expect(typicalAndBest(runs)).toEqual({ typical: 4, best: 1, fromShort: false });
    // With an action, the overlay shows a pass that fell short of the target.
    expect(typicalAndBest(runs, [2, 5])).toEqual({ typical: 2, best: 1, fromShort: true });
  });

  it("reads flag names from the payload's bits", () => {
    expect(flagNames({ off_track: 1, tow: 4, possible_traffic: 64 }, 65)).toEqual(["off track", "possible traffic"]);
  });
});
