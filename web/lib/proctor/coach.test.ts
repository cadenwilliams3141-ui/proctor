/* The coach's words: every instruction carries its evidence, every number
 * comes from the payload, and nothing guesses at intent. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MissingEvidenceError,
  apexU,
  coachHeadline,
  describeAction,
  describeEvent,
  relApex,
  watchHighlights,
} from "@/lib/proctor/coach";
import type { CoachAction, CoachMetric, SegmentCorner, WatchData } from "@/lib/proctor/types";

const corner: SegmentCorner = {
  id: 4, name: "T4", kind: "brake", complex: false, dir: "right", radius_m: 60, turn_deg: 90, vmin_ms: 29.7,
  apex_m: 2193, seg_start_m: 1991, seg_end_m: 2546.8, start_pct: 0.66, apex_pct: 0.73, end_pct: 0.85,
  wraps: false, sub_apexes: [],
};
const L = 3000;

function action(metric: CoachMetric, over: Partial<CoachAction> = {}): CoachAction {
  return {
    corner: 4, metric, unit: "m", phase: "entry", typical: 58.25, target: 62.98, range: [62.1, 63.4],
    n_short: 6, short_typical: 40.1, short_laps: [6, 7, 10, 11, 12, 15], direction: "later", gain_s: 0.075,
    confidence: "strong", comes_with: [],
    evidence: { n: 15, k: 4, target_laps: [14, 5, 13, 4], rho: -0.825, p: 0.001, q: 0.0068,
      slope_s_per_unit: -0.0049, stability: 0.998, phase_share_entry: 0.66, entry_speed_adjusted: true,
      detrended_by_lap_order: true },
    ...over,
  };
}

const ALL: [CoachMetric, Partial<CoachAction>][] = [
  ["brake_on", {}],
  ["release", { typical: 120, target: 130, short_typical: 110 }],
  ["turn_in", { typical: 150, target: 155, short_typical: 140 }],
  ["pickup", { typical: 230, target: 210, short_typical: 240, direction: "earlier", phase: "exit" }],
  ["full", { typical: 245, target: 230, short_typical: 260, direction: "earlier", phase: "exit" }],
  ["v_min", { typical: 29.4, target: 30.2, short_typical: 29.1, direction: "higher", phase: "mid", unit: "m/s" }],
  ["brake_peak", { typical: 0.9, target: 1.0, short_typical: 0.84, direction: "harder", unit: "ratio" }],
  ["trail", { typical: 5, target: 15, short_typical: 2, direction: "longer" }],
  ["coast", { typical: 20, target: 0, short_typical: 35, direction: "less" }],
  ["abs_ms", { typical: 900, target: 200, short_typical: 1100, direction: "less", unit: "ms" }],
  ["corrections", { typical: 3, target: 1, short_typical: 4, direction: "fewer", phase: "mid", unit: "count" }],
  ["relifts", { typical: 1, target: 0, short_typical: 1, direction: "fewer", phase: "exit", unit: "count" }],
];

describe("describeAction", () => {
  it.each(ALL)("%s names the fastest laps, n, and what matching them is worth", (metric, over) => {
    const t = describeAction(action(metric, over), corner, L);
    expect(t.todo).toMatch(/laps 4, 5, 13, 14/);
    expect(t.observed).toMatch(/of 15 passes/);
    expect(t.gain).toBe("Worth about 0.07 s a lap.".replace("0.07", (0.075).toFixed(2)));
    expect(t.because).toMatch(/15 usable passes through T4/);
    expect(t.because).toMatch(/q 0\.007/);
    expect(t.where.startsWith("T4")).toBe(true);
    for (const s of [t.observed, t.todo, t.because]) {
      expect(s).not.toMatch(/undefined|NaN|null/);
    }
  });

  it("refuses to speak without evidence", () => {
    const bare = { ...action("brake_on"), evidence: undefined } as unknown as CoachAction;
    expect(() => describeAction(bare, corner, L)).toThrow(MissingEvidenceError);
    const empty = action("brake_on", {
      evidence: { ...action("brake_on").evidence, target_laps: [] },
    });
    expect(() => describeAction(empty, corner, L)).toThrow(MissingEvidenceError);
  });

  it("places a brake point against the apex, from the payload's own positions", () => {
    const apex = apexU(corner, L); // 202 m into the segment
    expect(apex).toBe(202);
    expect(relApex(62.98, apex)).toBe("about 139 m before the apex");
    expect(relApex(230, apex)).toBe("about 28 m after the apex");
    const t = describeAction(action("brake_on"), corner, L);
    expect(t.todo).toContain("about 139 m before the apex");
    expect(t.observed).toContain("about 23 m earlier");
  });

  it("says brake points were compared at matched entry speed when they were", () => {
    expect(describeAction(action("brake_on"), corner, L).because).toMatch(/matched entry speed/);
  });

  it("counts grouped inputs once and says so", () => {
    const t = describeAction(
      action("brake_peak", {
        typical: 0.98, target: 1.0, short_typical: 0.84, direction: "harder",
        comes_with: [{ metric: "brake_on", unit: "m", typical: 58, target: 63, direction: "later" }],
      }),
      corner,
      L,
    );
    expect(t.comesWith).toMatch(/where you started braking/);
    expect(t.comesWith).toMatch(/Counted once/);
  });
});

describe("the copy file itself", () => {
  const src = readFileSync(join(__dirname, "coach.ts"), "utf8");

  it("carries no measurement as a literal", () => {
    expect(src).not.toMatch(/\b\d+(\.\d+)?\s?(km\/h|m before|m after|s a lap)\b/);
  });

  it("never guesses at intent", () => {
    expect(src.toLowerCase()).not.toMatch(/you wanted|you tried|you meant|you should have|because you/);
  });
});

describe("coachHeadline", () => {
  it("states the achievable lap only when there are actions, and says why when not", () => {
    const base = {
      n_clean_laps: 14, typical_lap_s: 68.313, best_lap_s: 67.9, explained_gain_s: 0.15,
      achievable_lap_s: 68.163, theoretical_best_s: 67.6, actions_total: 0, corners: [], tests_run: 40,
      method: {}, caveat: "",
    };
    const yes = coachHeadline({ ...base, actions: [action("brake_on")], no_action_reason: null });
    expect(yes.sentence).toMatch(/1:08\.313 to about 1:08\.163/);
    const no = coachHeadline({ ...base, actions: [], no_action_reason: "no input explained the differences" });
    expect(no.sentence).toMatch(/No repeatable difference/);
  });
});

describe("the watcher's words", () => {
  const w: WatchData = {
    events: [
      { lap: 2, at_m: 519, corner: 1, phase: "braking", kind: "lockup", sev: -0.65, dur_ms: 250, a: 0, b: 0.87 },
      { lap: 2, at_m: 530, corner: 1, phase: "braking", kind: "lockup", sev: -0.4, dur_ms: 100, a: 1, b: 0.8 },
      { lap: 5, at_m: 520, corner: 1, phase: "braking", kind: "lockup", sev: -0.5, dur_ms: 150, a: 0, b: 0.9 },
    ],
    capped: false,
    counts: { lockup: 3 },
    matrix: { "1": { lockup: 3 } },
    per_lap: {},
    links: [{ corner: 1, kind: "lockup", n_with: 2, n_without: 8, median_delta_s: 0.21 }],
    none_observed: [],
    unavailable: {},
    laps_watched: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    caveat: "",
  };

  it("counts laps, not events", () => {
    expect(watchHighlights(w)[0]).toBe("Lockups in T1 on 2 of 10 laps, those passes 0.21 s slower there");
  });

  it("describes the car, not the driver's mind", () => {
    expect(describeEvent(w.events[0])).toBe("left front locked — T1, braking, 0.25 s");
  });
});
