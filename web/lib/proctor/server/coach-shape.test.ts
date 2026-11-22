/* The coaching engine's payloads, shaped for the screens. */

import { describe, expect, it } from "vitest";

import {
  absencesFrom,
  coachFrom,
  cornerLapsFrom,
  cornersFrom,
  cornersFromSegments,
  segmentsFrom,
  watchFrom,
} from "@/lib/proctor/server/shape";

const segments = {
  basis: "b",
  numbering: "Proctor's own; not official turn names",
  length_m: 3000,
  length_source: "LapDist",
  corners: [
    { id: 1, name: "T1", kind: "brake", complex: false, dir: "right", radius_m: 30, turn_deg: 90, vmin_ms: 21,
      apex_m: 627, seg_start_m: 417.7, seg_end_m: 863.3, start_pct: 0.139, apex_pct: 0.209, end_pct: 0.288,
      wraps: false, sub_apexes: [] },
    { id: 2, name: "T2", kind: "brake", complex: false, dir: "right", radius_m: 80, turn_deg: 90, vmin_ms: 34,
      apex_m: 2900, seg_start_m: 2800, seg_end_m: 3417.7, start_pct: 0.933, apex_pct: 0.967, end_pct: 0.139,
      wraps: true, sub_apexes: [] },
  ],
  kinks: [],
  laps: { lap: [1, 2], segment_s: [[11.9, 50.1], [12.0, 50.3]] },
  timing: { available: true, sim_agrees: true },
};

const cornerLaps = {
  basis: "b",
  units: { brake_on: "m" },
  flag_bits: { off_track: 1 },
  corners: [
    { id: 1, seg_len_m: 445.6, landmarks: { brake_on: 37, turn_in: 178, v_min_at: 209, full: 229 },
      phase_names: ["approach", "braking"], phase_edges_m: [0, 37, 445.6],
      runs: { lap: [1], flags: [0], usable: [true], time_s: [11.9], phase_s: [[1, 10.9]], m: { brake_on: [37] } } },
    { id: 2, insufficient_data: true, reason: "no complete pass" },
  ],
};

const action = {
  corner: 1, metric: "brake_on", unit: "m", phase: "entry", typical: 30, target: 50, range: [48, 52],
  n_short: 5, short_typical: 25, short_laps: [2, 3, 4, 5, 6], direction: "later", gain_s: 0.08,
  confidence: "strong", comes_with: [],
  evidence: { n: 14, k: 4, target_laps: [7, 8, 9, 10], rho: -0.8, p: 0.001, q: 0.01, slope_s_per_unit: -0.004,
    stability: 0.99, phase_share_entry: 0.7, entry_speed_adjusted: true, detrended_by_lap_order: true },
};

describe("segmentsFrom / cornerLapsFrom", () => {
  it("reads the track model", () => {
    const s = segmentsFrom({ segments });
    expect(s?.corners.map((c) => c.name)).toEqual(["T1", "T2"]);
    expect(s?.numbering).toMatch(/official/);
  });

  it("is null when the module did not run, so the absence speaks instead", () => {
    expect(segmentsFrom({})).toBeNull();
    expect(segmentsFrom({ segments: { insufficient_data: true, reason: "no corner" } })).toBeNull();
  });

  it("drops a corner the module could not measure rather than inventing runs", () => {
    const cl = cornerLapsFrom({ corner_laps: cornerLaps });
    expect(cl?.corners.map((c) => c.id)).toEqual([1]);
  });
});

describe("cornersFromSegments", () => {
  it("uses the typical brake point and full-throttle point as the corner window", () => {
    const c = cornersFromSegments(segmentsFrom({ segments }), cornerLapsFrom({ corner_laps: cornerLaps }));
    const t1 = c[0];
    // 417.7 + 37 - 15 = 439.7 m; 417.7 + 229 + 15 = 661.7 m
    expect(t1.start_pct).toBeCloseTo(439.7 / 3000, 4);
    expect(t1.end_pct).toBeCloseTo(661.7 / 3000, 4);
    expect(t1.apex_pct).toBe(0.209);
  });

  it("clips a window at the start/finish line instead of wrapping it", () => {
    const c = cornersFromSegments(segmentsFrom({ segments }), null);
    for (const k of c) {
      expect(k.start_pct).toBeGreaterThanOrEqual(0);
      expect(k.end_pct).toBeLessThanOrEqual(1);
      expect(k.start_pct).toBeLessThan(k.end_pct);
    }
  });

  it("is what cornersFrom serves when the session has segments", () => {
    const map = { x_m: [], y_m: [] };
    expect(cornersFrom({ segments }, map).map((c) => c.id)).toEqual([1, 2]);
  });
});

describe("coachFrom", () => {
  it("keeps only actions that carry their evidence", () => {
    const bare = { ...action, evidence: undefined };
    const c = coachFrom({
      coach: { actions: [action, bare], corners: [], typical_lap_s: 68.3, achievable_lap_s: 68.2 },
    });
    expect(c?.actions).toHaveLength(1);
    expect(c?.actions[0].evidence.target_laps).toEqual([7, 8, 9, 10]);
  });

  it("keeps a missing lap figure missing, not zero", () => {
    const c = coachFrom({ coach: { actions: [], corners: [], typical_lap_s: null, no_action_reason: "none" } });
    expect(c?.typical_lap_s).toBeNull();
    expect(c?.no_action_reason).toBe("none");
  });
});

describe("watchFrom", () => {
  it("turns column rows into events by the payload's own field list", () => {
    const w = watchFrom({
      watch: {
        fields: ["lap", "at_m", "corner", "phase", "kind", "sev", "dur_ms", "a", "b"],
        events: [[2, 519.4, 1, "braking", "lockup", -0.65, 250, 0, 0.87]],
        counts: { lockup: 1 }, none_observed: ["wheelspin"], unavailable: { kerb_strike: "no channel" },
      },
    });
    expect(w?.events[0]).toMatchObject({ lap: 2, corner: 1, kind: "lockup", phase: "braking" });
    expect(w?.none_observed).toEqual(["wheelspin"]);
    expect(w?.unavailable.kerb_strike).toBe("no channel");
  });
});

describe("absences for the coaching engine", () => {
  it("a session ingested before the coach existed is told to re-ingest", () => {
    const a = absencesFrom({}, { wear_masked: false });
    const coach = a.find((x) => x.key === "coach");
    expect(coach?.kind).toBe("stale");
    expect(coach?.reason).toMatch(/re-ingest/);
  });

  it("a coach that could not run says why, in its own words", () => {
    const a = absencesFrom({ coach: { insufficient_data: true, reason: "no corner found" } }, { wear_masked: false });
    expect(a.find((x) => x.key === "coach")).toMatchObject({ kind: "this_run", reason: "no corner found" });
  });
});
