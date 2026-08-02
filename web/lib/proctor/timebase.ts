/* Turning the distance grid back into time.
 *
 * ┌ THE BUG THIS EXISTS TO FIX ─────────────────────────────────────────────┐
 * │ Every trace in this app is resampled onto a grid that is uniform in     │
 * │ DISTANCE — 1000 samples evenly spaced around the lap. The Live screen   │
 * │ used to sweep that grid at a constant rate, which meant the car crossed │
 * │ every sample in the same number of milliseconds. On screen that is a    │
 * │ car travelling at one fixed speed the whole way round: it crawls down   │
 * │ the straights and flies through the hairpin, which is backwards.        │
 * │                                                                         │
 * │ The fix does not need a schema change or a re-ingest, because the time  │
 * │ base was never actually lost. The grid step is a fixed distance and the │
 * │ speed at each sample is recorded, so the time to cross sample i is      │
 * │ ds/v_i, and the running sum of that IS the elapsed time around the lap. │
 * │                                                                         │
 * │ ds itself is unknown here (nothing on the client carries the track      │
 * │ length in metres) and it does not need to be: it is a constant, so it   │
 * │ scales out. The curve is normalised so its total equals the lap time    │
 * │ that was actually recorded, which pins both ends to a measurement.      │
 * │                                                                         │
 * │ What this is NOT: a re-simulation. Between two grid samples the         │
 * │ position is interpolated, because that is all the stored data can say.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The same integral drives the delta traces (see ledger.ts → elapsedCurve).
 * They agree by construction, which is why a lap's sweep finishes at the same
 * moment its delta curve does.
 */

import type { Trace } from "@/lib/proctor/types";

export interface Timebase {
  /** Seconds elapsed at each distance sample. Monotonic, starts at 0. */
  elapsed: number[];
  /** The lap's own recorded time — the last value the curve reaches. */
  lapTime: number;
  /** Fractional distance-grid index at `seconds` into the lap. */
  indexAt(seconds: number): number;
  /** Seconds into the lap at a fractional distance-grid index. */
  timeAt(index: number): number;
}

/** Below this a speed sample is treated as this floor rather than inverted.
 *  A sample at literally zero would take infinitely long to cross, and a spin
 *  or a stop in the middle of a lap would freeze the sweep forever. */
const MIN_SPEED_MS = 0.5;

export function buildTimebase(trace: Trace): Timebase {
  const n = trace.speed.length;
  const elapsed = new Array<number>(Math.max(n, 1)).fill(0);

  if (n === 0) {
    return {
      elapsed,
      lapTime: 0,
      indexAt: () => 0,
      timeAt: () => 0,
    };
  }

  // Running sum of 1/v. Each step is one grid cell, so the true increment is
  // ds/v — and ds is a constant that the normalisation below removes.
  let total = 0;
  for (let i = 0; i < n; i++) {
    elapsed[i] = total;
    total += 1 / Math.max(trace.speed[i], MIN_SPEED_MS);
  }

  /* Scale so the curve ends at the lap time that was actually recorded.
     Resampling loses a little, so the raw integral does not land exactly on the
     stopwatch; rather than let the two disagree, the measurement wins and the
     integral is stretched onto it. */
  const lapTime = trace.lap_time_s > 0 ? trace.lap_time_s : total;
  const scale = total > 0 ? lapTime / total : 0;
  for (let i = 0; i < n; i++) elapsed[i] *= scale;

  const indexAt = (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    if (seconds >= lapTime) return n - 1;

    // Binary search the monotonic curve, then interpolate inside the cell so
    // the car glides rather than stepping from sample to sample.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (elapsed[mid] <= seconds) lo = mid;
      else hi = mid;
    }
    const span = elapsed[hi] - elapsed[lo];
    return span > 0 ? lo + (seconds - elapsed[lo]) / span : lo;
  };

  const timeAt = (index: number): number => {
    if (!Number.isFinite(index) || index <= 0) return 0;
    if (index >= n - 1) return lapTime;
    const lo = Math.floor(index);
    const f = index - lo;
    return elapsed[lo] + (elapsed[lo + 1] - elapsed[lo]) * f;
  };

  return { elapsed, lapTime, indexAt, timeAt };
}

/** Read a channel at a fractional grid index, interpolating between samples.
 *
 *  The playhead now lands between samples most of the time — it is driven by
 *  wall-clock time, not by the grid — so rounding to the nearest sample would
 *  put visible stair-steps into the speed readout on a fast straight. */
export function sampleAt(values: number[], index: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const wrapped = ((index % n) + n) % n;
  const lo = Math.floor(wrapped);
  const hi = (lo + 1) % n;
  const f = wrapped - lo;
  return values[lo] + (values[hi] - values[lo]) * f;
}

/** The same, for a channel where interpolating would invent a value that never
 *  existed — gear is 3 or 4, never 3.4. */
export function stepAt(values: number[], index: number): number {
  const n = values.length;
  if (n === 0) return 0;
  return values[((Math.round(index) % n) + n) % n];
}
