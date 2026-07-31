/* Telemetry channel colours — a DECLARED EXCEPTION to Nocturne's mono palette.
 *
 * Data channels have to stay distinguishable at 1.3-1.8px stroke widths, which
 * a single-hue ramp cannot do. Five hues are declared for that purpose and no
 * other.
 *
 * SVG presentation attributes (fill=, stroke=) cannot resolve var(), so the
 * literals have to exist in JS somewhere. This module is that somewhere — the
 * ONLY place in the app a raw channel hex may appear. Components import from
 * here; they never inline a hex.
 *
 * These values mirror the custom properties in app/globals.css. If one list
 * changes the other must change with it.
 */

export const CH = {
  /** lap A / the reference lap. Mirrors --color-accent-400. */
  a: "#b5abfc",
  /** lap B / the comparison lap. */
  b: "#e0a86a",
  /** time lost, brake, lockup. Loss must never read as the accent. */
  loss: "#e0685e",
  /** time gained, throttle. */
  gain: "#6fbf8f",
  /** wheelspin, anomalous, wear-masked. Distinct from lockup. */
  warn: "#e0b76a",
} as const;

/** Nocturne roles that SVG needs as literals for the same reason. */
export const INK = {
  bg: "#161826",
  surface: "#232532",
  text: "#e9e9ed",
  accent: "#9184d9",
  /** under-stroke for the circuit */
  neutral800: "#3f424d",
  neutral700: "#595d6c",
  neutral500: "#9397ab",
  /** the circuit's own line under the speed colouring */
  accent2_700: "#5c5794",
  accent2_600: "#7972a9",
  accent800: "#423a6a",
  accent900: "#2b2741",
} as const;

/** Text at N% opacity. Muted text is a mix, never its own token.
 *  60 secondary · 45-50 tertiary · 34-42 caveats · 28-30 disabled. */
export function dim(pct: number): string {
  return `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
}

/** The same, as an rgba literal for SVG attributes. */
export function inkA(alpha: number): string {
  return `rgba(233, 233, 237, ${alpha})`;
}

/** Loss/gain colouring for a delta, with a dead band where the two laps
 *  genuinely matched. Below the band a delta is not a finding. */
export const MATCHED_BAND_S = 0.004;

export function deltaColor(delta: number): string {
  if (delta > MATCHED_BAND_S) return CH.loss;
  if (delta < -MATCHED_BAND_S) return CH.gain;
  return inkA(0.45);
}

export type DeltaSense = "loss" | "gain" | "matched";

export function deltaSense(delta: number): DeltaSense {
  if (delta > MATCHED_BAND_S) return "loss";
  if (delta < -MATCHED_BAND_S) return "gain";
  return "matched";
}
