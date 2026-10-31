/* One corner, read in the order a driver drives it.
 *
 * The corner ledger splits a corner's time into four EQUAL quarters of its
 * window — "on entry", "in the run to the apex", ... — which is honest
 * arithmetic but not how a corner is driven. This module splits the same window
 * at the points the driver's own best lap actually did things: where it turned
 * in, where it was slowest, and where it was back to full throttle. That gives
 * four phases a driver already thinks in — braking, turn-in, apex, exit — and
 * the time this lap lost or gained against the best lap in each.
 *
 * ┌ WHAT IT CLAIMS, AND WHAT IT DOES NOT ───────────────────────────────────┐
 * │ Every fact is this lap against the driver's own best lap, measured on   │
 * │ the shared distance grid: where the pedal went on, how hard, where the  │
 * │ car turned in, how slow it got, where the throttle came back, how fast   │
 * │ it left. Nothing here says why, and nothing says what to do — the file  │
 * │ records what the car did, not what the driver meant. Same rule as        │
 * │ explain.ts: name the thing, its size and where, never the remedy.        │
 * │                                                                         │
 * │ Distances are good to one grid sample. Two points within a sample of    │
 * │ each other are reported as the same point, never as "0 m".              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The phase times are read off the same cumulative delta curve the ledger
 * uses, between boundaries on the same grid, so the four always sum to the
 * corner's own delta exactly. A phase is never invented to hold a remainder.
 */

import { MATCHED_BAND_S } from "@/lib/proctor/channels";
import { gpsToLocal } from "@/lib/proctor/geometry";
import { deltaCurve } from "@/lib/proctor/ledger";
import type { Corner, CornerDelta, Trace } from "@/lib/proctor/types";

export type PhaseId = "brake" | "turnin" | "apex" | "exit";

/** A run of text, optionally the bold part. A fact is a short sentence whose
 *  number is the thing the eye should land on. */
export interface Span {
  text: string;
  strong?: boolean;
}
export type Fact = Span[];

export interface Phase {
  id: PhaseId;
  /** "Braking" becomes "Entry" when neither lap braked for the corner. */
  label: string;
  /** Unwrapped grid indices: [from, to). The last phase ends at the window end. */
  from: number;
  to: number;
  /** Seconds this lap lost (+) or gained (−) against the best lap in this phase. */
  delta: number;
  /** Most telling first. Never empty: a phase with nothing to say says so. */
  facts: Fact[];
}

/** Where one lap did each thing, as unwrapped grid indices. null = it did not. */
export interface LapMarks {
  brake: number | null;
  turnIn: number | null;
  apex: number;
  throttle: number | null;
}

export interface CornerReading {
  id: number;
  delta: number;
  phases: Phase[];
  /** The phase that cost the most, when one cost anything. */
  worst: PhaseId | null;
  marks: { best: LapMarks; lap: LapMarks };
  /** One grid sample in metres — the resolution every distance here carries. */
  metresPerSample: number;
  /** Whether the phases were cut at the best lap's own points (true) or fell
   *  back to equal quarters (false) — and if so, why, so the screen can say
   *  exactly that rather than a reason that happens to be wrong. */
  fromEvents: boolean;
  fallback: "no-turn-in" | "no-throttle" | "out-of-order" | null;
}

/** The thresholds the points are read with.
 *
 *  brakeOn/brakeOff/turnInFrac are the trail_braking module's own rules, and
 *  the caller passes the ones that module sent so the two never disagree.
 *  fullThrottle is this module's: back on the throttle means 90% pedal or more. */
export interface PhaseRules {
  brakeOn: number;
  brakeOff: number;
  turnInFrac: number;
  fullThrottle: number;
}

export const DEFAULT_RULES: PhaseRules = {
  brakeOn: 0.1,
  brakeOff: 0.05,
  turnInFrac: 0.3,
  fullThrottle: 0.9,
};

export const PHASE_LABEL: Record<PhaseId, string> = {
  brake: "Braking",
  turnin: "Turn-in",
  apex: "Apex",
  exit: "Exit",
};

// ─────────────────────────────────────────────────────────────────────────────
// Finding the points on one lap
// ─────────────────────────────────────────────────────────────────────────────

const wrap = (i: number, n: number) => ((i % n) + n) % n;
const at = (a: number[], i: number) => a[wrap(i, a.length)];

/** The slowest sample in [from, to]. */
export function slowestPoint(t: Trace, from: number, to: number): number {
  let best = from;
  for (let i = from; i <= to; i++) if (at(t.speed, i) < at(t.speed, best)) best = i;
  return best;
}

/** Where the car turned in: the first sample before the apex at which lateral
 *  load reached `frac` of THIS lap's own peak through the corner. Self-relative,
 *  so it needs no per-car number. null when the corner never loaded up. */
export function turnInPoint(
  t: Trace,
  from: number,
  apex: number,
  to: number,
  frac: number,
): number | null {
  let peak = 0;
  for (let i = from; i <= to; i++) peak = Math.max(peak, Math.abs(at(t.lat_accel, i)));
  if (peak < 0.5) return null; // under 0.05 g: not a corner the car felt
  for (let i = from; i <= apex; i++) if (Math.abs(at(t.lat_accel, i)) >= frac * peak) return i;
  return null;
}

/** Where the pedal went on for this corner, searching back from the apex no
 *  further than `limit`.
 *
 *  It wants the LAST sustained application before the apex — two samples in a
 *  row at or over `on` — and then walks back while the pedal stays over `off`,
 *  stepping over a single-sample dip. Two samples, not one, because a sensor
 *  that jumps for a frame (hardware's brief-spike check) is not a braking point
 *  and must not be able to move one. */
export function brakePoint(
  t: Trace,
  limit: number,
  apex: number,
  on: number,
  off: number,
): number | null {
  const p = (i: number) => at(t.brake_raw, i);
  let last: number | null = null;
  for (let i = apex; i > limit; i--) {
    if (p(i) >= on && p(i - 1) >= on) {
      last = i;
      break;
    }
  }
  if (last == null) return null;
  let s = last;
  while (s - 1 >= limit && (p(s - 1) >= off || (s - 2 >= limit && p(s - 2) >= off))) s--;
  while (p(s) < off && s < last) s++;
  return s;
}

/** Back to full throttle after the apex: the first of two samples in a row at
 *  or over `full`, before `limit`. null when it never got there. */
export function throttlePoint(t: Trace, apex: number, limit: number, full: number): number | null {
  for (let i = apex; i < limit; i++) {
    if (at(t.throttle, i) >= full && at(t.throttle, i + 1) >= full) return i;
  }
  return null;
}

export function lapMarks(
  t: Trace,
  win: { from: number; to: number },
  search: { brakeFrom: number; throttleTo: number },
  rules: PhaseRules,
): LapMarks {
  const apex = slowestPoint(t, win.from, win.to);
  return {
    brake: brakePoint(t, search.brakeFrom, apex, rules.brakeOn, rules.brakeOff),
    turnIn: turnInPoint(t, win.from, apex, win.to, rules.turnInFrac),
    apex,
    throttle: throttlePoint(t, apex, search.throttleTo, rules.fullThrottle),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading one corner
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadingInput {
  cd: CornerDelta;
  /** The driver's best lap — lap A in the store. */
  best: Trace;
  /** The lap being looked at — lap B. */
  lap: Trace;
  /** Delta curve of lap against best. Pass it in when reading every corner of
   *  a lap so it is computed once, not twelve times. */
  delta?: number[];
  /** Unwrapped grid index of the previous corner's apex: braking for this
   *  corner cannot have started before it. */
  prevApex: number;
  /** ...nor can the throttle point for this one lie past the next apex. */
  nextApex: number;
  /** Metres along the lap per grid sample. */
  metresPerSample: number;
  /** For "inside"/"wider" at the apex. Both from the track-width payload. */
  centre?: {
    x: number[];
    y: number[];
    normalX: number[];
    normalY: number[];
    origin: { lat: number; lon: number };
  } | null;
  rules?: PhaseRules;
  /** What the reference lap is called in the copy: "your best" when it is the
   *  driver's fastest clean lap, "lap 6" when they picked another one. A
   *  sentence must never call a lap the best when it is not. */
  ref?: string;
}

export function readCorner(input: ReadingInput): CornerReading {
  const { cd, best, lap, metresPerSample } = input;
  const rules = input.rules ?? DEFAULT_RULES;
  const n = Math.min(best.speed.length, lap.speed.length);
  const delta = input.delta ?? deltaCurve(best, lap);
  const lapDelta = delta[n - 1];
  // The cumulative curve read across the start/finish line, as the ledger does.
  const readAt = (i: number) => {
    const k = wrap(i, n);
    return i < 0 ? delta[k] - lapDelta : i >= n ? delta[k] + lapDelta : delta[k];
  };

  const win = { from: cd.from, to: cd.to };
  const search = { brakeFrom: Math.max(input.prevApex, cd.from - Math.round(n * 0.06)), throttleTo: input.nextApex };
  const mb = lapMarks(best, win, search, rules);
  const ml = lapMarks(lap, win, search, rules);

  // Phase boundaries come from the BEST lap's own points, so both laps are cut
  // at the same places on the grid and the times are comparable. If a point is
  // missing or out of order, the whole corner falls back to equal quarters
  // rather than to a mix of the two schemes.
  const quarter = (q: number) => Math.round(win.from + ((win.to - win.from) * q) / 4);
  const t1 = mb.turnIn;
  const t2 = mb.apex;
  const t3 = mb.throttle != null && mb.throttle < win.to ? mb.throttle : null;
  const ordered =
    t1 != null && t3 != null && win.from < t1 && t1 < t2 && t2 < t3 && t3 < win.to;
  const cuts = ordered ? [win.from, t1!, t2, t3!, win.to] : [0, 1, 2, 3, 4].map(quarter);
  const fallback = ordered ? null : t1 == null ? "no-turn-in" : t3 == null ? "no-throttle" : "out-of-order";

  const braked = mb.brake != null || ml.brake != null;
  const ids: PhaseId[] = ["brake", "turnin", "apex", "exit"];
  const facts = factsFor(input, mb, ml, cuts, rules);

  const phases: Phase[] = ids.map((id, q) => ({
    id,
    label: id === "brake" && !braked ? "Entry" : PHASE_LABEL[id],
    from: cuts[q],
    to: cuts[q + 1],
    delta: readAt(cuts[q + 1]) - readAt(cuts[q]),
    facts: facts[id],
  }));

  const worstPhase = phases.reduce((w, p) => (p.delta > w.delta ? p : w), phases[0]);

  return {
    id: cd.corner.id,
    delta: phases.reduce((s, p) => s + p.delta, 0),
    phases,
    worst: worstPhase.delta > MATCHED_BAND_S ? worstPhase.id : null,
    marks: { best: mb, lap: ml },
    metresPerSample,
    fromEvents: ordered,
    fallback,
  };
}

/** Every corner of a lap, with the delta curve computed once. */
export function readLap(
  corners: CornerDelta[],
  best: Trace,
  lap: Trace,
  opts: Pick<ReadingInput, "metresPerSample" | "centre" | "rules" | "ref">,
): CornerReading[] {
  const n = Math.min(best.speed.length, lap.speed.length);
  const delta = deltaCurve(best, lap);
  const apex = (c: Corner) => Math.round(c.apex_pct * (n - 1));
  return corners.map((cd, k) => {
    const prev = corners[(k - 1 + corners.length) % corners.length].corner;
    const next = corners[(k + 1) % corners.length].corner;
    const here = apex(cd.corner);
    // Unwrap the neighbours onto the same side of the line as this corner.
    let prevApex = apex(prev);
    if (corners.length === 1 || prevApex >= here) prevApex -= n;
    let nextApex = apex(next);
    if (corners.length === 1 || nextApex <= here) nextApex += n;
    return readCorner({ cd, best, lap, delta, prevApex, nextApex, ...opts });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts
// ─────────────────────────────────────────────────────────────────────────────

const b = (text: string): Span => ({ text, strong: true });
const p = (text: string): Span => ({ text });

/** "12 m later" / "12 m earlier" / null when within one sample (the same point). */
function metresApart(lapIdx: number, bestIdx: number, mps: number): { m: number; later: boolean } | null {
  const d = (lapIdx - bestIdx) * mps;
  if (Math.abs(lapIdx - bestIdx) <= 1) return null;
  return { m: Math.round(Math.abs(d)), later: d > 0 };
}

const kmhDiff = (lapMs: number, bestMs: number) => (lapMs - bestMs) * 3.6;

/** "Exit speed 3 km/h faster" / "Exit speed the same". Under 1 km/h is the same:
 *  speed is shown in whole km/h everywhere else in the app. */
function speedFact(lead: string, lapMs: number, bestMs: number): Fact {
  const d = kmhDiff(lapMs, bestMs);
  if (Math.abs(d) < 1) return [p(`${lead} `), b("the same")];
  return [p(`${lead} `), b(`${Math.abs(d).toFixed(0)} km/h ${d > 0 ? "faster" : "slower"}`)];
}

function factsFor(
  input: ReadingInput,
  mb: LapMarks,
  ml: LapMarks,
  cuts: number[],
  rules: PhaseRules,
): Record<PhaseId, Fact[]> {
  const { best, lap, metresPerSample: mps } = input;
  const ref = input.ref ?? "your best";
  const Ref = ref.charAt(0).toUpperCase() + ref.slice(1);
  const pedalPct = (t: Trace, i: number) => at(t.brake_raw, i) * 100;

  // ── Braking ──────────────────────────────────────────────────────────────
  const brake: Fact[] = [];
  if (mb.brake == null && ml.brake == null) {
    brake.push([p("Neither lap "), b("braked"), p(" here")]);
    brake.push(speedFact("Speed at turn-in", at(lap.speed, cuts[1]), at(best.speed, cuts[1])));
  } else if (ml.brake == null) {
    brake.push([p("This lap "), b("did not brake"), p(`; ${ref} did`)]);
  } else if (mb.brake == null) {
    brake.push([p("This lap "), b("braked"), p(`; ${ref} did not`)]);
  } else {
    const apart = metresApart(ml.brake, mb.brake, mps);
    brake.push(
      apart
        ? [p("Braked "), b(`${apart.m} m ${apart.later ? "later" : "earlier"}`)]
        : [p("Braked at "), b("the same point")],
    );
    const peak = (t: Trace, from: number, to: number) => {
      let m = 0;
      for (let i = from; i <= to; i++) m = Math.max(m, at(t.brake_raw, i));
      return m * 100;
    };
    const pl = peak(lap, ml.brake, ml.apex);
    const pb = peak(best, mb.brake, mb.apex);
    brake.push(
      Math.abs(pl - pb) < 1
        ? [p("Peak pedal "), b(`${pl.toFixed(0)}%`), p(`, the same as ${ref}`)]
        : [p("Peak pedal "), b(`${pl.toFixed(0)}%`), p(` against ${pb.toFixed(0)}%`)],
    );
  }

  // ── Turn-in ──────────────────────────────────────────────────────────────
  const turnin: Fact[] = [];
  if (ml.turnIn != null && mb.turnIn != null) {
    const apart = metresApart(ml.turnIn, mb.turnIn, mps);
    turnin.push(
      apart
        ? [p("Turned in "), b(`${apart.m} m ${apart.later ? "later" : "earlier"}`)]
        : [p("Turned in at "), b("the same point")],
    );
    const onL = pedalPct(lap, ml.turnIn);
    const onB = pedalPct(best, mb.turnIn);
    if (onL >= rules.brakeOff * 100 || onB >= rules.brakeOff * 100) {
      turnin.push([p("Brake at turn-in "), b(`${onL.toFixed(0)}%`), p(` against ${onB.toFixed(0)}%`)]);
    } else {
      turnin.push([p("Off the brake at turn-in on "), b("both laps")]);
    }
  } else {
    turnin.push([p("No clear turn-in on "), b(ml.turnIn == null ? "this lap" : ref)]);
  }

  // ── Apex ─────────────────────────────────────────────────────────────────
  const apex: Fact[] = [];
  apex.push(speedFact("Slowest point", at(lap.speed, ml.apex), at(best.speed, mb.apex)));
  const apexApart = metresApart(ml.apex, mb.apex, mps);
  if (apexApart) apex.push([p("Slowest point came "), b(`${apexApart.m} m ${apexApart.later ? "later" : "earlier"}`)]);
  const line = lineAtApex(input, mb.apex);
  if (line) apex.push(line);

  // ── Exit ─────────────────────────────────────────────────────────────────
  const exit: Fact[] = [];
  if (ml.throttle != null && mb.throttle != null) {
    const apart = metresApart(ml.throttle, mb.throttle, mps);
    exit.push(
      apart
        ? [p("Full throttle "), b(`${apart.m} m ${apart.later ? "later" : "earlier"}`)]
        : [p("Full throttle at "), b("the same point")],
    );
  } else if (ml.throttle == null && mb.throttle == null) {
    exit.push([p("Neither lap reached "), b("full throttle"), p(" before the next corner")]);
  } else {
    exit.push([
      p(ml.throttle == null ? "This lap " : `${Ref} `),
      b("never reached full throttle"),
      p(" before the next corner"),
    ]);
  }
  exit.push(speedFact("Exit speed", at(lap.speed, cuts[4]), at(best.speed, cuts[4])));

  return { brake, turnin, apex, exit };
}

/** How far apart the two lines were at the best lap's apex, and which way.
 *
 *  Offsets are measured along the reference line's normal (pointing left of
 *  travel), exactly as track_width measures them. "Tighter" means nearer the
 *  inside of the corner, which needs the corner's fitted direction; without it
 *  the fact says only how far apart the lines were. */
function lineAtApex(input: ReadingInput, apexIdx: number): Fact | null {
  const ref = input.ref ?? "your best";
  const c = input.centre;
  if (!c || c.x.length === 0) return null;
  const n = c.x.length;
  const k = wrap(apexIdx, n);
  const offset = (t: Trace): number | null => {
    if (t.lat_gps.length === 0) return null;
    const lat = at(t.lat_gps, apexIdx);
    const lon = at(t.lon_gps, apexIdx);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const { x, y } = gpsToLocal([lat], [lon], c.origin);
    return (x[0] - c.x[k]) * c.normalX[k] + (y[0] - c.y[k]) * c.normalY[k];
  };
  const ol = offset(input.lap);
  const ob = offset(input.best);
  if (ol == null || ob == null) return null;
  const d = ol - ob; // + = this lap further left
  // The file stores positions as float32 — about half a metre of rounding —
  // so a difference smaller than that is not one the file can see.
  if (Math.abs(d) < 0.5) return [p("Line at the apex "), b(`matched ${ref}`)];
  const dir = input.cd.corner.dir;
  const m = `${Math.abs(d).toFixed(1)} m`;
  if (dir == null) return [p("Line at the apex "), b(`${m} apart`), p(` from ${ref}`)];
  const inside = dir === "left" ? d > 0 : d < 0;
  return [p("Line at the apex "), b(`${m} ${inside ? "tighter" : "wider"}`)];
}

/** Plain text of a fact, for tests and titles. */
export function factText(f: Fact): string {
  return f.map((s) => s.text).join("");
}
