/* You, or your gear? Each verdict planted with the reading that should earn it.
 *
 * The golden Long Beach session's brake ceiling is 89.8% — a known-good number,
 * NOT a known verdict. A foot that never pressed past 89.8 and a pedal that
 * cannot report more both read 89.8, so both shapes are here and must land on
 * different verdicts. */

import { describe, expect, it } from "vitest";

import { allGearChecks, blockingFinding, gearCheck, type GearInputs } from "./gearCheck";
import type { CeilingShape, HardwareData, InputResponseData, ReportCardData } from "./types";

const RULE = { min_stops: 5, at_ceiling_share: 0.5, full_pct: 99.5 };

function shape(over: Partial<CeilingShape>): CeilingShape {
  return {
    hard_stops: 40,
    min_peak_pct: 50,
    flat_tolerance_pct: 0.1,
    flat_min_ms: 150,
    gear_rule: RULE,
    at_ceiling: 2,
    flat_at_ceiling: 0,
    flat_with_abs: 0,
    median_peak_pct: 78,
    peak_spread_pct: 9,
    ...over,
  };
}

function ir(ceiling: number, cs: CeilingShape | undefined, range?: unknown): InputResponseData {
  return {
    brake: {
      measured: true,
      braking_ticks: 4000,
      pedal_ceiling_pct: ceiling,
      applied_ceiling_pct: ceiling,
      mean_held_back_pct: 0,
      max_held_back_pct: 0,
      ceiling_shape: cs,
    },
    throttle: {
      measured: true,
      on_power_ticks: 9000,
      mean_throttle_pct: 80,
      range: (range ?? {
        measured: true,
        floor_pct: 0,
        ceiling_pct: 100,
        flat_out_holds: 30,
        holds_flat_at_ceiling: 30,
        rule: { floor_watch_pct: 1, full_pct: 99, hold_s: 1 },
      }) as never,
    },
    steering: { measured: false, reason: "not needed here" },
    caveat: "",
  };
}

function hw(over: Partial<HardwareData> = {}): HardwareData {
  return {
    brake_ceiling_pct: null,
    pedal_noise: {
      spike_ticks: 0,
      max_spike: 0,
      qualifying_ticks: 8000,
      brief: { events: 0, peak_pct: null, max_duration_ms: 50, min_reading_pct: 5 },
    },
    ffb: { clipping_pct: 0.4, flagged: false, flag_threshold_pct: 2, by_corner: [] },
    steerTorque: { available: false, median_nm: null, peak_nm: null, at_own_max_pct: null },
    brake_bias: { available: false },
    ...over,
  };
}

const rc = (lfb: boolean, sub60 = 0): ReportCardData => ({
  driving_style: {
    measured: true,
    median_release_to_brake_ms: lfb ? -50 : 240,
    brake_applications: 300,
    brake_before_lift_pct: lfb ? 77 : 5,
    style_observation: lfb
      ? "throttle release and brake application overlap — consistent with left-foot braking"
      : "distinct gap between throttle release and braking",
  },
  frame_health: { available: true, min_fps: sub60 ? 48 : 118, mean_fps: 140, sub_60_ticks: sub60 * 60, sub_60_seconds: sub60 },
  caveat: "",
});

const inputs = (over: Partial<GearInputs>): GearInputs => ({
  inputResponse: ir(89.8, shape({})),
  hardware: hw(),
  reportCard: rc(false),
  ...over,
});

describe("braking", () => {
  it("reads a foot that tops out at 89.8% as you, not the pedal", () => {
    const g = gearCheck("braking", inputs({ inputResponse: ir(89.8, shape({ at_ceiling: 1, hard_stops: 8 })) }));
    expect(g.verdict).toBe("looks-like-you");
    expect(g.findings[0].detail).toContain("78%");
  });

  it("reads stops landing on the same sub-100% value as the pedal's limit", () => {
    const g = gearCheck("braking", inputs({ inputResponse: ir(82, shape({ at_ceiling: 36, peak_spread_pct: 0 })) }));
    expect(g.verdict).toBe("gear-first");
    expect(g.findings[0].detail).toContain("36 of 40");
    expect(g.findings[0].detail).toContain("82%");
    expect(g.findings[0].fix).toMatch(/recalibrate/i);
    expect(blockingFinding(g, "brake.harder", 4)).not.toBeNull();
    expect(blockingFinding(g, "trail.carry", 4)).toBeNull();
  });

  it("takes its threshold from the payload, not from this file", () => {
    const strict = shape({ at_ceiling: 36, gear_rule: { ...RULE, at_ceiling_share: 0.95 } });
    expect(gearCheck("braking", inputs({ inputResponse: ir(82, strict) })).verdict).toBe("looks-like-you");
  });

  it("cannot tell on a session ingested before stop shapes existed", () => {
    const g = gearCheck("braking", inputs({ inputResponse: ir(89.8, undefined) }));
    expect(g.verdict).toBe("cant-tell");
    expect(g.findings[0].detail).toMatch(/re-ingest/);
  });

  it("cannot tell when the full travel is used every stop", () => {
    const g = gearCheck("braking", inputs({ inputResponse: ir(100, shape({ at_ceiling: 35 })) }));
    expect(g.verdict).toBe("cant-tell");
  });

  it("puts brake jumps too quick for a foot on the gear, and blocks the release tip", () => {
    const jumpy = hw({
      pedal_noise: {
        spike_ticks: 0,
        max_spike: 0,
        qualifying_ticks: 8000,
        brief: { events: 3, peak_pct: 31, max_duration_ms: 50, min_reading_pct: 5 },
      },
    });
    const g = gearCheck("braking", inputs({ hardware: jumpy }));
    expect(g.verdict).toBe("gear-first");
    expect(blockingFinding(g, "trail.restab", null)).not.toBeNull();
  });

  it("will not pin a left-foot braker's noise floor on the pedal", () => {
    const noisy = hw({
      pedal_noise: {
        spike_ticks: 69,
        max_spike: 0.03,
        qualifying_ticks: 8000,
        brief: { events: 0, peak_pct: null, max_duration_ms: 50, min_reading_pct: 5 },
      },
    });
    const g = gearCheck("braking", inputs({ hardware: noisy, reportCard: rc(true) }));
    const noise = g.findings.find((f) => f.label.startsWith("Brake noise"))!;
    expect(noise.verdict).toBe("cant-tell");
    expect(noise.detail).toContain("left-foot");
  });
});

describe("throttle", () => {
  const range = (over: object) => ({
    measured: true,
    floor_pct: 0,
    ceiling_pct: 100,
    flat_out_holds: 30,
    holds_flat_at_ceiling: 30,
    rule: { floor_watch_pct: 1, full_pct: 99, hold_s: 1 },
    ...over,
  });

  it("flags a pedal that never returns to zero", () => {
    const g = gearCheck("throttle", inputs({ inputResponse: ir(89.8, shape({}), range({ floor_pct: 3 })) }));
    expect(g.verdict).toBe("gear-first");
    expect(blockingFinding(g, "coast.close", 2)).not.toBeNull();
  });

  it("flags a pedal that flattens short of full", () => {
    const g = gearCheck("throttle", inputs({ inputResponse: ir(89.8, shape({}), range({ ceiling_pct: 96, holds_flat_at_ceiling: 28 })) }));
    expect(g.verdict).toBe("gear-first");
    expect(blockingFinding(g, "throttle.earlier", 2)).not.toBeNull();
  });

  it("reads a full range as you", () => {
    expect(gearCheck("throttle", inputs({})).verdict).toBe("looks-like-you");
  });
});

describe("steering", () => {
  it("blocks steering tips only in the corners where the wheel clipped", () => {
    const some = hw({
      ffb: {
        clipping_pct: 1.1,
        flagged: false,
        flag_threshold_pct: 2,
        by_corner: [
          { id: 3, clipping_pct: 9, ticks: 400 },
          { id: 4, clipping_pct: 0, ticks: 400 },
        ],
      },
    });
    const g = gearCheck("turn_in", inputs({ hardware: some }));
    expect(g.verdict).toBe("gear-first");
    expect(blockingFinding(g, "steer.once", 3)).not.toBeNull();
    expect(blockingFinding(g, "steer.once", 4)).toBeNull();
  });

  it("reads a wheel under its watch line as you", () => {
    expect(gearCheck("turn_in", inputs({})).verdict).toBe("looks-like-you");
  });
});

describe("the rest", () => {
  it("never puts line or grip on the rig", () => {
    expect(gearCheck("line", inputs({})).verdict).toBe("looks-like-you");
    expect(gearCheck("grip", inputs({})).findings).toHaveLength(0);
  });

  it("carries frame-rate dips as context, never as the verdict", () => {
    const g = gearCheck("line", inputs({ reportCard: rc(false, 4.2) }));
    expect(g.context).toContain("4.2 s");
    expect(g.verdict).toBe("looks-like-you");
  });

  it("lists every device for the Gear screen", () => {
    expect(allGearChecks(inputs({})).map((g) => g.aspect)).toEqual(["braking", "throttle", "turn_in"]);
  });
});
