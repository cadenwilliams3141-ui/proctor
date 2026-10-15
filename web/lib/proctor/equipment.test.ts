/* The rig's own signals: a pedal reading that was not the driver must show up,
 * and a silent rig must say so rather than show an empty card. */

import { describe, expect, it } from "vitest";

import { equipmentReadings } from "./equipment";
import type { HardwareData } from "./types";

const hw = (over: Partial<HardwareData> = {}): HardwareData => ({
  brake_ceiling_pct: null,
  pedal_noise: {
    spike_ticks: 0,
    max_spike: 0,
    qualifying_ticks: 8812,
    brief: { events: 0, peak_pct: null, max_duration_ms: 50, min_reading_pct: 5 },
  },
  ffb: { clipping_pct: 0, flagged: false, flag_threshold_pct: 2 },
  steerTorque: { available: false, median_nm: null, peak_nm: null, at_own_max_pct: null },
  brake_bias: { available: false },
  ...over,
});

const byKey = (h: HardwareData) =>
  Object.fromEntries(equipmentReadings(h).map((r) => [r.key, r]));

describe("equipmentReadings", () => {
  it("says a silent rig is silent, and flags nothing", () => {
    const r = byKey(hw());
    expect(r.noise.flagged || r.jumps.flagged || r.ffb.flagged).toBe(false);
    expect(r.noise.note).toMatch(/Silent/);
    expect(r.jumps.value).toBe(0);
    expect(r.ffb.note).toMatch(/Never at its limit/);
  });

  it("flags a brake jump too quick to be a foot, with its size and the rule", () => {
    const r = byKey(
      hw({
        pedal_noise: {
          spike_ticks: 0,
          max_spike: 0,
          qualifying_ticks: 8812,
          brief: { events: 3, peak_pct: 31, max_duration_ms: 50, min_reading_pct: 5 },
        },
      }),
    );
    expect(r.jumps.flagged).toBe(true);
    expect(r.jumps.value).toBe(3);
    expect(r.jumps.note).toContain("31%");
    expect(r.jumps.note).toContain("50 ms");
    expect(r.noise.flagged).toBe(false);
  });

  it("shows an older session's jump check as unmeasured, not as zero", () => {
    const r = byKey(
      hw({ pedal_noise: { spike_ticks: 69, max_spike: 0.0071, qualifying_ticks: 8812, brief: null } }),
    );
    expect(r.jumps.value).toBeNull();
    expect(r.jumps.note).toMatch(/Re-ingest/);
    expect(r.noise.flagged).toBe(true);
    expect(r.noise.value).toBe(69);
  });

  it("takes the FFB watch line from the module, not from this file", () => {
    const r = byKey(hw({ ffb: { clipping_pct: 3.1, flagged: true, flag_threshold_pct: 2 } }));
    expect(r.ffb.flagged).toBe(true);
    expect(r.ffb.note).toContain("2%");
  });
});
