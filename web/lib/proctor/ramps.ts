/* Two interpolated colour ramps, both built from the channel anchors.
 *
 * A ramp is a reading aid, not a measurement — every ramp in this app is
 * normalised against the driver's own data (this lap's own min/max, this
 * session's own tire range), never against an absolute scale. That is the
 * same rule the rest of the product follows: limits come from the driver's
 * own data, labelled as such.
 */

type Stop = [pos: number, rgb: [number, number, number]];

function lerp(c0: [number, number, number], c1: [number, number, number], f: number): string {
  const ch = c0.map((c, i) => Math.round(c + (c1[i] - c) * f));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function sample(stops: Stop[], t: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < stops.length; i++) {
    if (clamped <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const span = p1 - p0;
      return lerp(c0, c1, span === 0 ? 0 : (clamped - p0) / span);
    }
  }
  return lerp(stops[stops.length - 2][1], stops[stops.length - 1][1], 1);
}

/* Speed on the track map. Brightness reads as speed; the warm top end marks
   the flat-out sections. Normalised per lap against that lap's own min/max. */
const SPEED_STOPS: Stop[] = [
  [0, [58, 61, 82]],
  [0.42, [121, 114, 169]],
  [0.78, [181, 171, 252]],
  [1, [244, 214, 168]],
];

export function speedRamp(t: number): string {
  return sample(SPEED_STOPS, t);
}

/* Tire surface temperature. Normalised across all three L/M/R bands of the
   session together, so the bands stay comparable to each other. */
const TIRE_STOPS: Stop[] = [
  [0, [70, 74, 110]],
  [0.55, [181, 171, 252]],
  [1, [232, 150, 110]],
];

export function tireRamp(t: number): string {
  return sample(TIRE_STOPS, t);
}

/** Normalise a value into 0..1 against a min/max, safe when the range is flat. */
export function norm(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  return span === 0 ? 0 : (v - lo) / span;
}
