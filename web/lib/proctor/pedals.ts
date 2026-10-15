/* The brake ceiling, read the same way on every screen.
 *
 * input_response owns it: the most the brake pedal sensor read while moving.
 * Sessions ingested before that module existed carry the identical figure
 * under hardware (brake_vs_raw — same channel, same moving mask, same max), so
 * falling back to it is honest rather than a substitute. The phone and the
 * desktop each used to pick their own source; this is the one place that does.
 *
 * The ABS deliberately has NO equivalent fallback. The old hardware ABS share
 * counted braking off the APPLIED channel and input_response counts it off the
 * PEDAL, so they are different numbers. A session without input_response shows
 * the ABS as unmeasured rather than as the other definition. */

import type { HardwareData, InputResponseData } from "@/lib/proctor/types";

export interface BrakeCeiling {
  /** Percent of pedal travel, or null when no module measured it. */
  pct: number | null;
  /** Why it is null, in a module's own words when one gave them. */
  reason?: string;
}

export function brakeCeiling(
  hw: HardwareData | null,
  ir: InputResponseData | null,
): BrakeCeiling {
  if (ir?.brake.measured) return { pct: ir.brake.pedal_ceiling_pct };
  if (hw?.brake_ceiling_pct != null) return { pct: hw.brake_ceiling_pct };
  return {
    pct: null,
    reason:
      (ir && !ir.brake.measured ? ir.brake.reason : undefined) ??
      hw?.brake_reason ??
      "Not measured for this session.",
  };
}
