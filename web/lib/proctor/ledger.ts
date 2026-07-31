/* The corner ledger: what one lap cost against the reference, corner by corner.
 *
 * This is the arithmetic behind the most important screen in the product, so
 * it is worth being precise about what it does and does not claim.
 *
 * It works from `speed` alone, which means it works identically on fixture data
 * and on real traces out of Neon — no fixture-only assumptions leak in. When
 * the parser starts emitting per-corner sub-section deltas for arbitrary lap
 * pairs, `sections` below should be replaced by that field rather than split
 * here; everything else stays.
 */

import type {
  Corner,
  CornerDelta,
  CornerLedger,
  Trace,
} from "@/lib/proctor/types";
import { MATCHED_BAND_S } from "@/lib/proctor/channels";
import { SECTION_LABEL } from "@/lib/proctor/types";

/** Elapsed time at each grid point.
 *
 *  The grid is uniform in DISTANCE, so dt = ds/v. Integrating that gives a lap
 *  time which will not land exactly on the recorded lap_time_s — resampling
 *  loses a little. Rather than let the two disagree, the curve is scaled so its
 *  total IS the recorded lap time. The endpoint of a delta between two laps is
 *  then exactly the difference of their recorded times, which is what the
 *  headline number on screen claims it is. */
export function elapsedCurve(trace: Trace): number[] {
  const n = trace.speed.length;
  const raw = new Array<number>(n).fill(0);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    raw[i] = acc;
    acc += 1 / Math.max(trace.speed[i], 0.5);
  }
  const scale = acc > 0 ? trace.lap_time_s / acc : 0;
  return raw.map((v) => v * scale);
}

/** Cumulative time lost by lap B against lap A at each point of the lap.
 *  Positive means B is behind. */
export function deltaCurve(a: Trace, b: Trace): number[] {
  const ta = elapsedCurve(a);
  const tb = elapsedCurve(b);
  const n = Math.min(ta.length, tb.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = tb[i] - ta[i];
  return out;
}

/** Padding either side of a corner, in samples. A corner's cost begins at the
 *  braking point, which is before the geometry turns in. */
const PAD = 14;

/** Windows must not overlap.
 *
 *  Two corners that share samples both bill the same tenth, the per-corner
 *  deltas then sum to more than the lap gap, and the "straights" remainder goes
 *  negative — which would show the driver time appearing from nowhere. So a
 *  padded window is clamped at the midpoint of the gap to its neighbour: every
 *  sample of the lap belongs to at most one corner, and the arithmetic closes.
 */
function windows(corners: Corner[], n: number): { from: number; to: number }[] {
  const at = (pct: number) => Math.round(pct * (n - 1));
  const seg = corners.map((c) => ({ s: at(c.start_pct), e: at(c.end_pct) }));
  const last = seg.length - 1;

  /* One boundary per gap between consecutive corners, placed at the midpoint.
     The midpoint is the right answer whether the corners are separated (it sits
     on the straight between them) or slightly overlapping (it sits inside the
     overlap and splits it) — a complex layout has corners that run into each
     other, and the ledger still has to divide every sample exactly once. */
  const boundary = seg.map((cur, i) =>
    Math.round((cur.e + (i === last ? seg[0].s + n : seg[i + 1].s)) / 2),
  );

  // Indices are left unwrapped on purpose; readAt() below unwraps the
  // cumulative delta curve across the start/finish line.
  return seg.map(({ s, e }, i) => ({
    from: Math.max(s - PAD, i === 0 ? boundary[last] - n : boundary[i - 1]),
    to: Math.min(e + PAD, boundary[i]),
  }));
}

export function buildLedger(
  corners: Corner[],
  a: Trace,
  b: Trace,
): CornerLedger {
  const n = Math.min(a.speed.length, b.speed.length);
  const delta = deltaCurve(a, b);
  const wrap = (i: number) => ((i % n) + n) % n;
  const win = windows(corners, n);

  // Reading the cumulative curve across a window that crosses the start/finish
  // line would subtract the whole lap's delta. Unwrap by adding the lap total
  // back on for the part that has already crossed.
  const lapDelta = delta[n - 1];
  const readAt = (i: number): number => {
    const k = wrap(i);
    return i < 0 ? delta[k] - lapDelta : i >= n ? delta[k] + lapDelta : delta[k];
  };

  const list: CornerDelta[] = corners.map((corner, idx) => {
    const { from, to } = win[idx];

    // Four equal sub-sections: entry, run to the apex, apex out, exit.
    const step = (to - from) / 4;
    const bounds = [0, 1, 2, 3, 4].map((q) => Math.round(from + step * q));
    const sections = [0, 1, 2, 3].map(
      (q) => readAt(bounds[q + 1]) - readAt(bounds[q]),
    ) as [number, number, number, number];

    const total = sections.reduce((s, v) => s + v, 0);

    let minA = Infinity;
    let minB = Infinity;
    for (let i = from; i <= to; i++) {
      const k = wrap(i);
      minA = Math.min(minA, a.speed[k]);
      minB = Math.min(minB, b.speed[k]);
    }

    // "Most of it" means the sub-section that contributed most in the direction
    // the corner actually went. For a loss that is the largest positive slice;
    // for a gain, the largest negative one.
    const dominant =
      total > 0
        ? sections.indexOf(Math.max(...sections))
        : sections.indexOf(Math.min(...sections));

    return {
      corner,
      sections,
      delta: total,
      dominant,
      minSpeedA: minA,
      minSpeedB: minB,
      from,
      to,
    };
  });

  const cornerSum = list.reduce((s, c) => s + c.delta, 0);

  return {
    lapA: a.lap_number,
    lapB: b.lap_number,
    corners: list,
    lapDelta,
    // NOT distributed into the corners. See the caption this drives.
    remainder: lapDelta - cornerSum,
    maxAbs: Math.max(...list.map((c) => Math.abs(c.delta)), 1e-6),
  };
}

/** The observation copy for one corner.
 *
 *  Every phrasing here describes; none prescribes. There is no "you should
 *  brake later" in this function and there must never be one — the setup and
 *  technique call stays with the driver. */
export function observation(c: CornerDelta): string {
  const ms = Math.abs(c.delta * 1000).toFixed(0);
  const where = SECTION_LABEL[c.dominant];

  if (c.delta > MATCHED_BAND_S) {
    const kmh = Math.abs((c.minSpeedA - c.minSpeedB) * 3.6).toFixed(0);
    const sense = c.minSpeedB < c.minSpeedA ? "slower" : "faster";
    return `${ms} ms, most of it ${where} · ${kmh} km/h ${sense} at the slowest point`;
  }
  if (c.delta < -MATCHED_BAND_S) {
    return `${ms} ms taken back, mostly ${where}`;
  }
  return "matched the reference lap here, inside 4 ms";
}

/** Shortened for the phone's single-line row. Same claim, fewer words. */
export function observationShort(c: CornerDelta): string {
  const ms = Math.abs(c.delta * 1000).toFixed(0);
  const where = SECTION_LABEL[c.dominant];
  if (c.delta > MATCHED_BAND_S) return `${ms} ms, most of it ${where}`;
  if (c.delta < -MATCHED_BAND_S) return `${ms} ms taken back, mostly ${where}`;
  return "matched, inside 4 ms";
}

/** Ranked worst-first — the order the product leads with. */
export function ranked(ledger: CornerLedger): CornerDelta[] {
  return [...ledger.corners].sort((x, y) => y.delta - x.delta);
}
