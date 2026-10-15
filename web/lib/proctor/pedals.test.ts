/* One brake ceiling, whichever module carried it. */

import { describe, expect, it } from "vitest";

import { brakeCeiling } from "./pedals";
import type { HardwareData, InputResponseData } from "./types";

const ir = (pct: number) =>
  ({ brake: { measured: true, pedal_ceiling_pct: pct } }) as unknown as InputResponseData;
const legacyHw = (pct: number | null, reason?: string) =>
  ({ brake_ceiling_pct: pct, brake_reason: reason }) as unknown as HardwareData;

describe("brakeCeiling", () => {
  it("prefers input_response, which owns it", () => {
    expect(brakeCeiling(legacyHw(80), ir(89.8))).toEqual({ pct: 89.8 });
  });

  it("falls back to a pre-input_response session's hardware block", () => {
    expect(brakeCeiling(legacyHw(89.8), null)).toEqual({ pct: 89.8 });
  });

  it("is null with a reason, never zero, when nothing measured it", () => {
    const unmeasured = {
      brake: { measured: false, reason: "only 12 moving braking ticks in this session" },
    } as unknown as InputResponseData;
    expect(brakeCeiling(null, unmeasured)).toEqual({
      pct: null,
      reason: "only 12 moving braking ticks in this session",
    });
    expect(brakeCeiling(null, null).pct).toBeNull();
    expect(brakeCeiling(null, null).reason).toBeTruthy();
  });
});
