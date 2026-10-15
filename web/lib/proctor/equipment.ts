/* Signals from the rig that were not the driver, as cards.
 *
 * The desktop Physics screen and the phone both show these, and they used to
 * write their own words for them — which is how the phone came to carry a
 * different ABS figure from the desktop. The words live here once; each screen
 * only decides how a card looks.
 *
 * Three readings, each about the equipment and never about the driving:
 *
 *   brake noise, foot off   sub-5% readings while flat on the throttle (the
 *                           original noise floor — 69 on the golden Long Beach)
 *   brake jumps             readings above 5% that came and went faster than
 *                           a foot can press and release a pedal
 *   wheel at its limit      force feedback clipped against the stops
 *
 * A card is `flagged` when it shows something worth watching. Thresholds come
 * off the payload (min_reading_pct, max_duration_ms, flag_threshold_pct), never
 * from a literal here. */

import type { HardwareData } from "@/lib/proctor/types";

export interface Reading {
  key: "noise" | "jumps" | "ffb";
  label: string;
  /** null renders as an em dash with `note` as the reason. */
  value: number | null;
  unit: string;
  /** 0-100, or null for no bar. */
  bar: number | null;
  /** Counts are whole numbers; "2.00 jumps" reads as a measurement error. */
  decimals: number;
  flagged: boolean;
  note: string;
}

export function equipmentReadings(hw: HardwareData): Reading[] {
  const p = hw.pedal_noise;
  const brief = p.brief;
  const f = hw.ffb;

  const noise: Reading = {
    key: "noise",
    label: "brake noise, foot off",
    value: p.spike_ticks,
    unit: p.qualifying_ticks != null ? `of ${p.qualifying_ticks.toLocaleString()} full-throttle ticks` : "ticks",
    bar:
      p.spike_ticks != null && p.qualifying_ticks
        ? (p.spike_ticks / p.qualifying_ticks) * 100
        : null,
    decimals: 0,
    flagged: (p.spike_ticks ?? 0) > 0,
    note:
      p.reason ??
      (p.spike_ticks == null
        ? "Not measured for this session."
        : p.spike_ticks === 0
          ? "Silent while you were flat on the throttle."
          : `Readings up to ${fmtPct((p.max_spike ?? 0) * 100)}% while your foot was on the throttle.`),
  };

  const jumps: Reading = {
    key: "jumps",
    label: "brake jumps, too quick for a foot",
    value: brief ? brief.events : null,
    unit: "this session",
    bar: null,
    decimals: 0,
    flagged: (brief?.events ?? 0) > 0,
    note:
      p.reason ??
      (brief == null
        ? "This session was ingested before this check existed. Re-ingest it to run it."
        : brief.events === 0
          ? `No reading above ${brief.min_reading_pct}% came and went inside ${brief.max_duration_ms} ms.`
          : `Peak ${fmtPct(brief.peak_pct ?? 0)}%, each gone within ${brief.max_duration_ms} ms with the throttle flat.`),
  };

  const ffb: Reading = {
    key: "ffb",
    label: "wheel at its force limit",
    value: f.clipping_pct,
    unit: "% of moving",
    bar: f.clipping_pct,
    decimals: 2,
    flagged: f.flagged,
    note:
      f.reason ??
      (f.clipping_pct == null
        ? "Not measured for this session."
        : f.clipping_pct === 0
          ? "Never at its limit while you were moving."
          : f.flagged
            ? `Past the ${f.flag_threshold_pct != null ? `${f.flag_threshold_pct}% ` : ""}watch line. At the limit, road detail stops reaching your hands.`
            : "At the limit, road detail stops reaching your hands."),
  };

  return [noise, jumps, ffb];
}

function fmtPct(v: number): string {
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}
