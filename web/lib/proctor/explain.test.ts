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
