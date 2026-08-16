/* The projection every circuit drawing goes through.
 *
 * The rule under test is the one the track boundary depends on: an unmeasured
 * bin is a GAP, and a gap must cost exactly the road it covers. Before this was
 * handled, a single NaN reached Math.min, which answers NaN for the whole set —
 * so one unmeasured bin anywhere on the lap made every projected coordinate NaN
 * and the panel rendered nothing at all.
 */

import { describe, expect, it } from "vitest";

import { project, projectAll } from "./geometry";

const finite = (p: { X: (v: number) => number; Y: (v: number) => number }, v: number) =>
  Number.isFinite(p.X(v)) && Number.isFinite(p.Y(v));

describe("fitting a circuit that has holes in it", () => {
  it("projects the measured points when some bins are unmeasured", () => {
    const p = project([0, 10, NaN, 30, 40], [0, 5, NaN, 15, 20], 620, 560, 26);
    expect(finite(p, 0)).toBe(true);
    expect(finite(p, 40)).toBe(true);
  });

  it("fits to the same box whether or not the gaps are there", () => {
    const whole = project([0, 10, 20, 30], [0, 10, 20, 30], 620, 560, 26);
    const holed = project([0, NaN, 20, 30], [0, NaN, 20, 30], 620, 560, 26);
    // The gap sat inside the extent, so it changes nothing about the fit.
    expect(holed.X(30)).toBeCloseTo(whole.X(30), 6);
    expect(holed.Y(0)).toBeCloseTo(whole.Y(0), 6);
  });

  it("survives a set with nothing finite in it at all", () => {
    // An empty panel is the honest outcome for a boundary nothing was measured
    // in. A NaN projection that silently draws nothing is not — it looks the
    // same on screen but every caller downstream is handling garbage.
    const p = project([NaN, NaN], [NaN, NaN], 620, 560, 26);
    expect(finite(p, 0)).toBe(true);
  });

  it("ignores a sample whose partner is missing", () => {
    // Edge builders write NaN into x and y together, but a half-written pair
    // must not be able to stretch the frame either.
    const p = project([0, 10, 1e6], [0, 10, NaN], 620, 560, 26);
    const whole = project([0, 10], [0, 10], 620, 560, 26);
    expect(p.X(10)).toBeCloseTo(whole.X(10), 6);
  });

  it("keeps a gap in one set from blanking the others", () => {
    const p = projectAll(
      [
        { x: [0, 10, 20], y: [0, 10, 20] },
        { x: [NaN, NaN], y: [NaN, NaN] },
      ],
      620,
      560,
      26,
    );
    expect(finite(p, 20)).toBe(true);
  });

  it("still centres and preserves aspect ratio", () => {
    // A wide, flat circuit: the scale is set by the long axis, and the short one
    // is centred rather than stretched to fill.
    const p = project([0, 100], [0, 10], 620, 560, 26);
    const spanX = p.X(100) - p.X(0);
    const spanY = p.Y(0) - p.Y(10);
    expect(spanX).toBeCloseTo(620 - 52, 6);
    expect(spanY).toBeCloseTo(spanX / 10, 6);
    // Centred on the short axis.
    expect((p.Y(10) + p.Y(0)) / 2).toBeCloseTo(560 / 2, 6);
  });
});
