/* Telemetry channel colours, and the Carbon roles SVG needs as literals.
 *
 * Data channels have to stay distinguishable at 1.3-1.8px stroke widths, which
 * a single-hue ramp cannot do. Five hues are declared for that purpose and no
 * other.
 *
 * SVG presentation attributes (fill=, stroke=) and three.js colours cannot
 * resolve var(), so the literals have to exist in JS somewhere. This module is
 * that somewhere — the ONLY place in the app a raw colour may appear.
 * Components import from here; they never inline a hex or an rgba().
 *
 * These values mirror the custom properties in app/globals.css, and
 * lib/proctor/palette.test.ts fails if the two lists drift apart.
 */

export const CH = {
  /** lap A / the reference lap. Mirrors --color-accent-400. */
  a: "#35d0e5",
  /** lap B / the comparison lap. */
  b: "#ff9f43",
  /** time lost, brake, lockup. Loss must never read as the accent. */
  loss: "#ff6b57",
  /** time gained, throttle. Lighter than loss as well as a different hue. */
  gain: "#a6e33c",
  /** wheelspin, anomalous, wear-masked, "your gear first". Distinct from lockup. */
  warn: "#ffc14d",
} as const;

/** Carbon roles that SVG and three.js need as literals for the same reason. */
export const INK = {
  bg: "#0f1112",
  surface: "#171a1c",
  /** the rail and the map panels: a step below a card */
  rail: "#131617",
  text: "#f1f3f4",
  accent: "#35d0e5",
  /** text on a cyan fill */
  onAccent: "#0f1112",
  /** under-stroke for the circuit; card borders */
  neutral800: "#2b3034",
  neutral700: "#4a5257",
  neutral500: "#9aa3a9",
  /** the circuit's own line under the speed colouring */
  accent2_700: "#545c61",
  accent2_600: "#6e777d",
  accent800: "#0f4a53",
  accent900: "#0b2e33",
} as const;

/** Text at N% opacity. Muted text is a mix, never its own token.
 *  60 secondary · 45-50 tertiary · 34-42 caveats · 28-30 disabled. */
export function dim(pct: number): string {
  return `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;
}

/** The same, as an rgba literal for SVG attributes. */
export function inkA(a: number): string {
  return alpha(INK.text, a);
}

/** Any palette colour at an opacity, as rgba() — safe in SVG attributes and
 *  inline styles alike. This is how a tint is made; never write the rgba. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
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
