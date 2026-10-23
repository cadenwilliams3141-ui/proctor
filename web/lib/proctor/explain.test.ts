/* The copy budget for what you asked for against what the car did.
 *
 * This copy grew a sentence at a time until one idea — "the ABS is not the
 * pedal failing, it is the tyres refusing the pressure" — was on the Physics
 * screen three times, in a stat note, a finding and a technique note. These
 * tests are what stops that from coming back: every finding is a headline that
 * names the number and at most one short line of fact, and nothing a finding
 * says is said again by the technique note beside it. */

import { describe, expect, it } from "vitest";

import { explainInputResponse } from "./explain";
import { techniqueForInputResponse } from "./technique";
import type { InputResponseData } from "./types";

const MAX_WORDS = 20;
const words = (s: string) => s.trim().split(/\s+/).length;
const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const busy = {
  brake: {
    measured: true,
    braking_ticks: 4000,
    pedal_ceiling_pct: 89.8,
    applied_ceiling_pct: 88.1,
    mean_held_back_pct: 1.2,
    max_held_back_pct: 31,
    peak_deceleration_g: 1.65,
    decel_per_pedal_g: 1.42,
    abs: { engaged_pct_of_braking: 6.2, activation_events: 41, mean_cut_while_engaged_pct: 31 },
  },
  throttle: {
    measured: true,
    on_power_ticks: 9000,
    mean_throttle_pct: 82,
    slip: {
      share_of_on_power_pct: 4.1,
      mean_excess_pct_while_slipping: 7,
      peak_excess_pct: 18,
      threshold_pct: 4,
    },
  },
  steering: {
    measured: true,
    peak_steer_deg: 140,
    most_lateral_g_band: "45-75°",
    falloff_past_peak_g: 0.12,
    bands: [
      { band: "20-45°", ticks: 900, measured: true, peak_lateral_g: 1.4 },
      { band: "45-75°", ticks: 600, measured: true, peak_lateral_g: 1.6 },
      { band: "75-110°", ticks: 200, measured: true, peak_lateral_g: 1.48 },
    ],
  },
  caveat: "",
} as InputResponseData;

const quiet = {
  ...busy,
  brake: { ...busy.brake, abs: { engaged_pct_of_braking: 0, activation_events: 0 } },
  throttle: {
    ...busy.throttle,
    slip: { share_of_on_power_pct: 0, mean_excess_pct_while_slipping: 0, peak_excess_pct: 2, threshold_pct: 4 },
  },
  steering: { ...busy.steering, falloff_past_peak_g: 0 },
} as InputResponseData;

describe("explainInputResponse", () => {
  for (const [name, ir] of [
    ["a busy session", busy],
    ["a quiet one", quiet],
  ] as const) {
    it(`keeps every line inside the word budget on ${name}`, () => {
      const items = explainInputResponse(ir);
      expect(items.length).toBeGreaterThan(0);
      for (const e of items) {
        expect(words(e.headline), e.headline).toBeLessThanOrEqual(MAX_WORDS);
        if (e.detail) expect(words(e.detail), e.detail).toBeLessThanOrEqual(MAX_WORDS);
      }
    });
  }

  it("states the negative results rather than going quiet", () => {
    const text = explainInputResponse(quiet).map((e) => e.headline).join(" ");
    expect(text).toMatch(/ABS never engaged/);
    expect(text).toMatch(/No wheel spun/);
  });

  it("never says what the technique note beside it says", () => {
    const findings = explainInputResponse(busy).flatMap((e) =>
      sentences(`${e.headline} ${e.detail ?? ""}`),
    );
    const notes = techniqueForInputResponse(busy).flatMap((n) => sentences(n.body));
    expect(notes.length).toBeGreaterThan(0);
    for (const s of findings) expect(notes).not.toContain(s);
    // The specific repeat that started this: mechanics belong to the note.
    expect(findings.join(" ")).not.toMatch(/heat|pedal failing|running out of front/);
  });

  it("leaves force-feedback clipping to the equipment section", () => {
    const text = explainInputResponse(busy)
      .map((e) => `${e.headline} ${e.detail ?? ""}`)
      .join(" ");
    expect(text).not.toMatch(/force limit|stops|clipp/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trail braking: the same budget, and the same separation from technique
// ─────────────────────────────────────────────────────────────────────────────

import { explainTrailCorner, explainTrailSession } from "./explain";
import { techniqueForTrail } from "./technique";
import type { TrailBrakingData, TrailCorner } from "./types";

const trailLap = (lap: number, entry: number, brake: number, trail: number) => ({
  lap,
  entry_time_s: entry,
  brake_at_turn_in_pct: brake,
  trail_s: trail,
  release_s: 1.2,
  coast_s: 0.3,
  restabs: 1,
  transition_min_pct: 61,
  abs_in_trail_pct: 12,
});

const trailed: TrailCorner = {
  id: 4,
  start_pct: 0.4,
  apex_pct: 0.5,
  end_pct: 0.6,
  laps_measured: 6,
  braked_laps: 6,
  measured: true,
  median: {
    brake_at_turn_in_pct: 22,
    trail_s: 0.45,
    release_s: 1.2,
    coast_s: 0.3,
    transition_min_pct: 61,
    abs_in_trail_pct: 12,
    entry_time_s: 1.4,
    restabs: 1,
  },
  released_before_turn_in_laps: 0,
  held_past_apex_laps: 0,
  best_entry: { ...trailLap(7, 1.28, 34, 0.6), gain_vs_median_s: 0.12 },
  trail_vs_entry: { measured: true, laps: 6, rho: -0.8, link: "longer_trail_faster" },
  context: {
    grade_pct: -2.1,
    load_g_onset: 2.1,
    load_g_turn_in: 1.6,
    load_drop_g: 0.5,
    lf_temp_middle_c: 88,
  },
  per_lap: [trailLap(7, 1.28, 34, 0.6), trailLap(3, 1.45, 18, 0.2)],
};

const straight: TrailCorner = {
  ...trailed,
  median: { ...trailed.median, brake_at_turn_in_pct: 0, trail_s: -0.4, restabs: 0, abs_in_trail_pct: null },
  trail_vs_entry: { measured: true, laps: 6, rho: 0.1, link: "none" },
} as TrailCorner;

describe("explainTrailCorner", () => {
  for (const [name, c] of [
    ["a trailed corner", trailed],
    ["a straight-line corner", straight],
  ] as const) {
    it(`keeps every line inside the word budget on ${name}`, () => {
      for (const e of explainTrailCorner(c)) {
        expect(words(e.headline), e.headline).toBeLessThanOrEqual(MAX_WORDS);
        if (e.detail) expect(words(e.detail), e.detail).toBeLessThanOrEqual(MAX_WORDS);
      }
    });
  }

  it("points at the driver's own quickest entry, never at an outside ideal", () => {
    const text = explainTrailCorner(trailed)
      .map((e) => `${e.headline} ${e.detail ?? ""} ${e.lookAt ?? ""}`)
      .join(" ");
    expect(text).toMatch(/lap 7/);
    expect(text).not.toMatch(/\bshould\b|\btry\b|\bbrake later\b|\bideal\b/i);
  });

  it("states a missing link as a result, and an unmeasured corner by its reason", () => {
    const none = explainTrailCorner(straight).map((e) => e.headline).join(" ");
    expect(none).toMatch(/no consistent link/);
    const unmeasured = explainTrailCorner({
      ...trailed,
      measured: false,
      reason: "taken without braking on every clean lap",
    } as TrailCorner);
    expect(unmeasured[0].headline).toBe("Turn 4: taken without braking on every clean lap.");
  });

  it("calls a near-tie a tie instead of naming a quickest lap", () => {
    const tie = {
      ...trailed,
      best_entry: { ...trailed.best_entry, gain_vs_median_s: 0.002 },
    } as TrailCorner;
    const lines = explainTrailCorner(tie).map((e) => e.headline);
    expect(lines.join(" ")).toMatch(/No entry into Turn 4 stood out/);
    expect(lines.join(" ")).not.toMatch(/quickest entry/);
    for (const l of lines) expect(words(l)).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("never says what its technique notes say", () => {
    const findings = explainTrailCorner(trailed).flatMap((e) =>
      sentences(`${e.headline} ${e.detail ?? ""}`),
    );
    const notes = techniqueForTrail(trailed).flatMap((n) => sentences(n.body));
    expect(notes.length).toBeGreaterThan(0);
    for (const s of findings) expect(notes).not.toContain(s);
  });
});

describe("explainTrailSession", () => {
  const tb = (summary: TrailBrakingData["summary"]) =>
    ({ summary }) as unknown as TrailBrakingData;

  it("stays inside the budget however many corners were entered off the brake", () => {
    const e = explainTrailSession(
      tb({
        corners_measured: 12,
        median_brake_at_turn_in_pct: 18,
        released_before_turn_in: [1, 2, 3, 5, 6, 8, 9, 11],
        deepest_dip: { id: 5, transition_min_pct: 40 },
      }),
    );
    expect(e).not.toBeNull();
    expect(words(e!.headline)).toBeLessThanOrEqual(MAX_WORDS);
    expect(words(e!.detail!)).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("says nothing rather than something empty when no corner was braked", () => {
    expect(explainTrailSession(tb({ corners_measured: 0 }))).toBeNull();
  });
});
