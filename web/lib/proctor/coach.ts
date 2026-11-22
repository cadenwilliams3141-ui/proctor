/* The coach's words. The ONE place an instruction is written.
 *
 * ┌ THE RULE THIS FILE CARRIES (2026-11-22) ────────────────────────────────┐
 * │ Prescribe only what your own laps have demonstrated. Every sentence     │
 * │ here is built from a structured action the parser emitted with its      │
 * │ evidence — the laps it came from, how many passes, the correlation, the │
 * │ false-discovery q, the explained gain — and every sentence carries that │
 * │ evidence with it. No evidence, no sentence: describeAction() throws.    │
 * │                                                                         │
 * │ So the instruction is never "brake later" in the abstract. It is "brake │
 * │ where you did on laps A, B and C — about N m before the apex". The    │
 * │ target is a place the driver has already been, and it is never outside  │
 * │ the range those passes drove.                                           │
 * │                                                                         │
 * │ No measurement is a literal in this file: every number comes from the   │
 * │ payload, so a change of session can never leave a stale figure behind.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { fmtLap } from "@/lib/proctor/format";
import type {
  CoachAction,
  CoachData,
  CoachMetric,
  SegmentCorner,
  WatchData,
  WatchEvent,
  WatchKind,
} from "@/lib/proctor/types";

export interface ActionText {
  /** "T4 · braking" */
  where: string;
  /** What the driver's other passes did, against their fastest passes. */
  observed: string;
  /** The instruction, anchored to laps already driven. */
  todo: string;
  /** "Worth about X s a lap." */
  gain: string;
  /** Why this is shown at all: n, correlation, q, stability, target laps. */
  because: string;
  /** Inputs that moved with the lead one, counted once. */
  comesWith: string | null;
  confidence: "strong" | "moderate";
}

const kmh = (ms: number) => ms * 3.6;
const r0 = (v: number) => Math.round(Math.abs(v)).toString();
const r1 = (v: number) => (Math.round(Math.abs(v) * 10) / 10).toString();
const pct = (v: number) => `${Math.round(v * 100)}%`;
const laps = (xs: number[]) =>
  xs.length <= 1 ? `lap ${xs[0] ?? "?"}` : `laps ${[...xs].sort((a, b) => a - b).join(", ")}`;

/** Where the apex sits, in metres from the start of the corner's segment. */
export function apexU(corner: Pick<SegmentCorner, "apex_m" | "seg_start_m">, lengthM: number): number {
  return (((corner.apex_m - corner.seg_start_m) % lengthM) + lengthM) % lengthM;
}

/** "about N m before the apex" / "after the apex" for a segment position. */
export function relApex(u: number, apex: number): string {
  const d = apex - u;
  if (Math.abs(d) < 3) return "at the apex";
  return d > 0 ? `about ${r0(d)} m before the apex` : `about ${r0(d)} m after the apex`;
}

export const METRIC_LABEL: Record<CoachMetric, string> = {
  brake_on: "where you started braking",
  brake_peak: "how hard you braked",
  release: "where you came off the brake",
  trail: "how far you carried brake into the turn",
  turn_in: "where you turned in",
  coast: "how far you coasted",
  abs_ms: "how long the ABS worked",
  v_min: "your speed at the slowest point",
  corrections: "how many steering corrections you made",
  pickup: "where you picked up the throttle",
  full: "where you reached full throttle",
  relifts: "lifting again after picking up the throttle",
};

const PHASE_LABEL: Record<CoachAction["phase"], string> = {
  entry: "braking and entry",
  mid: "mid-corner",
  exit: "exit",
};

/** A value in the units a driver reads. */
export function fmtMetric(metric: CoachMetric, v: number, apex?: number): string {
  switch (metric) {
    case "brake_on":
    case "release":
    case "turn_in":
    case "pickup":
    case "full":
      return apex == null ? `${r0(v)} m into the segment` : relApex(v, apex);
    case "trail":
    case "coast":
      return `${r0(v)} m`;
    case "v_min":
      return `${r0(kmh(v))} km/h`;
    case "brake_peak":
      return pct(v);
    case "abs_ms":
      return `${r1(v / 1000)} s`;
    case "corrections":
    case "relifts":
      return r1(v);
  }
}

/** The size of the difference between what the short passes did and the target. */
function gap(metric: CoachMetric, a: number, b: number): string {
  if (metric === "v_min") return `${r1(kmh(a - b))} km/h`;
  if (metric === "brake_peak") return `${Math.round(Math.abs(a - b) * 100)} points`;
  if (metric === "abs_ms") return `${r1((a - b) / 1000)} s`;
  if (metric === "corrections" || metric === "relifts") return r1(a - b);
  return `${r0(a - b)} m`;
}

export class MissingEvidenceError extends Error {}

export function describeAction(
  action: CoachAction,
  corner: SegmentCorner | null,
  lengthM: number | null,
): ActionText {
  const ev = action.evidence;
  if (!ev || !(ev.n > 0) || !Array.isArray(ev.target_laps) || ev.target_laps.length === 0) {
    // The rule, enforced: an instruction without the laps it came from is a
    // guess, and this app does not print guesses.
    throw new MissingEvidenceError(`action at corner ${action.corner} carries no evidence`);
  }
  const name = corner?.name ?? `T${action.corner}`;
  const apex = corner && lengthM ? apexU(corner, lengthM) : undefined;
  const short = action.short_typical ?? action.typical;
  const tgt = action.target;
  const ns = action.n_short;
  const n = ev.n;
  const who = laps(ev.target_laps);
  const d = gap(action.metric, short, tgt);
  const at = fmtMetric(action.metric, tgt, apex);
  const later = action.direction;

  let observed: string;
  let todo: string;
  switch (action.metric) {
    case "brake_on":
      observed = `On ${ns} of ${n} passes you started braking about ${d} ${later === "later" ? "earlier" : "later"} than your fastest passes did.`;
      todo = `Brake where you did on ${who} — ${at}.`;
      break;
    case "release":
      observed = `On ${ns} of ${n} passes you came off the brake about ${d} ${later === "later" ? "earlier" : "later"} than your fastest passes did.`;
      todo = `Come off the brake where you did on ${who} — ${at}.`;
      break;
    case "turn_in":
      observed = `On ${ns} of ${n} passes you turned in about ${d} ${later === "later" ? "earlier" : "later"} than your fastest passes did.`;
      todo = `Turn in where you did on ${who} — ${at}.`;
      break;
    case "pickup":
      observed = `On ${ns} of ${n} passes you picked up the throttle about ${d} ${later === "earlier" ? "later" : "earlier"} than your fastest passes did.`;
      todo = `Pick up the throttle where you did on ${who} — ${at}.`;
      break;
    case "full":
      observed = `On ${ns} of ${n} passes you got to full throttle about ${d} ${later === "earlier" ? "later" : "earlier"} than your fastest passes did.`;
      todo = `Be back to full throttle where you were on ${who} — ${at}.`;
      break;
    case "v_min":
      observed = `On ${ns} of ${n} passes your slowest point was about ${d} ${later === "higher" ? "slower" : "faster"} than on your fastest passes (${fmtMetric("v_min", short)} against ${at}).`;
      todo =
        later === "higher"
          ? `Carry ${at} through the slowest point, as you did on ${who}.`
          : `Slow the car to about ${at} for the apex, as you did on ${who}, and take the exit from there.`;
      break;
    case "brake_peak":
      observed = `On ${ns} of ${n} passes your brake pressure peaked at ${fmtMetric("brake_peak", short)}; on your fastest passes it reached ${at}.`;
      todo =
        later === "harder"
          ? `Hit the brake harder at the start of the zone — about ${at}, as on ${who}.`
          : `Ease the first hit of the brake to about ${at}, as on ${who}.`;
      break;
    case "trail":
      observed = `On ${ns} of ${n} passes you carried brake about ${d} ${later === "longer" ? "less" : "further"} into the turn than your fastest passes did.`;
      todo =
        later === "longer"
          ? `Keep some brake on as you turn in — about ${at} of overlap, as on ${who}.`
          : `Let the brake go sooner after turning in — about ${at} of overlap, as on ${who}.`;
      break;
    case "coast":
      observed = `On ${ns} of ${n} passes you coasted for about ${fmtMetric("coast", short)} with neither pedal; your fastest passes coasted ${at}.`;
      todo = `Go from one pedal straight to the other, as on ${who}.`;
      break;
    case "abs_ms":
      observed = `On ${ns} of ${n} passes the ABS worked for about ${fmtMetric("abs_ms", short)}; on your fastest passes, ${at}.`;
      todo = `Brake just below where the ABS takes over, as on ${who}.`;
      break;
    case "corrections":
      observed = `On ${ns} of ${n} passes you made about ${fmtMetric("corrections", short)} steering corrections through the corner; your fastest passes made ${at}.`;
      todo = `Settle on one steering input, as on ${who}.`;
      break;
    case "relifts":
      observed = `On ${ns} of ${n} passes you lifted again after picking up the throttle; your fastest passes did that ${at} times.`;
      todo = `Once you are back on the throttle, stay on it, as on ${who}.`;
      break;
  }

  const comes = action.comes_with.length
    ? `Came with: ${action.comes_with
        .map((c) => `${METRIC_LABEL[c.metric]} (${fmtMetric(c.metric, c.target, apex)} on the fastest passes)`)
        .join("; ")}. Counted once.`
    : null;

  const because =
    `Shown because, across ${n} usable passes through ${name}, ${METRIC_LABEL[action.metric]} ` +
    `went with the time here (rank correlation ${ev.rho.toFixed(2)}, false-discovery q ${ev.q.toFixed(3)}, ` +
    `${Math.round(ev.stability * 100)}% of resamples agree). ` +
    `Fastest passes: ${who}.` +
    (ev.entry_speed_adjusted ? " Brake points compared at matched entry speed." : "") +
    " Fuel and tyre drift over the run removed first.";

  return {
    where: `${name} · ${PHASE_LABEL[action.phase]}`,
    observed,
    todo,
    gain: `Worth about ${action.gain_s.toFixed(2)} s a lap.`,
    because,
    comesWith: comes,
    confidence: action.confidence,
  };
}

/** The headline numbers, as words. Missing stays missing. */
export function coachHeadline(c: CoachData): {
  typical: number | null;
  achievable: number | null;
  theoretical: number | null;
  best: number | null;
  sentence: string;
} {
  const sentence =
    c.actions.length > 0
      ? `${c.actions.length === 1 ? "One change" : `${c.actions.length} changes`} your own fastest passes already made would take your typical lap from ${fmtLap(
          c.typical_lap_s,
        )} to about ${fmtLap(c.achievable_lap_s)}.`
      : c.no_action_reason
        ? `No repeatable difference stood out: ${c.no_action_reason}.`
        : "No action came out of this session.";
  return {
    typical: c.typical_lap_s,
    achievable: c.achievable_lap_s,
    theoretical: c.theoretical_best_s,
    best: c.best_lap_s,
    sentence,
  };
}

export const KIND_LABEL: Record<WatchKind, string> = {
  lockup: "Lockups",
  wheelspin: "Wheelspin",
  oversteer: "Slides",
  understeer: "Understeer moments",
  coasting: "Coasting",
  brake_pumping: "Brake re-applied",
  throttle_hesitation: "Throttle hesitations",
  slow_shift: "Slow shifts",
  over_rev: "Over-revs on a downshift",
  off_track: "Off track",
  kerb_strike: "Kerb strikes",
  heavy_abs: "Heavy ABS",
  tow: "Tows (left out)",
  possible_traffic: "Possible traffic (left out)",
};

const WHEEL = ["left front", "right front", "left rear", "right rear"];

/** One event, in words. Describes the car; never guesses intent. */
export function describeEvent(e: WatchEvent): string {
  const where = `T${e.corner}, ${e.phase}`;
  const dur = e.dur_ms > 0 ? `, ${(e.dur_ms / 1000).toFixed(2)} s` : "";
  switch (e.kind) {
    case "lockup":
      return `${WHEEL[Number(e.a)] ?? "a wheel"} locked — ${where}${dur}`;
    case "wheelspin":
      return `${WHEEL[Number(e.a)] ?? "a wheel"} spun up — ${where}${dur}`;
    case "oversteer":
      return e.a === "countersteer"
        ? `countersteer — ${where}${dur}`
        : `the car slid (${e.sev.toFixed(1)}° of slip) — ${where}${dur}`;
    case "understeer":
      return `turned less per degree of lock than your other passes — ${where}${dur}`;
    case "coasting":
      return `neither pedal — ${where}${dur}`;
    case "brake_pumping":
      return `brake released and re-applied — ${where}`;
    case "throttle_hesitation":
      return `throttle came back off after the pickup — ${where}`;
    case "slow_shift":
      return `in neutral for ${(e.dur_ms / 1000).toFixed(2)} s — ${where}`;
    case "over_rev":
      return `over-rev on a downshift (${Math.round(e.sev)} rpm) — ${where}`;
    case "off_track":
      return `off the racing surface — ${where}${dur}`;
    case "kerb_strike":
      return `kerb strike (${e.sev.toFixed(1)} g) — ${where}`;
    case "heavy_abs":
      return `ABS working for ${Math.round(e.sev * 100)}% of the braking — ${where}`;
    case "tow":
      return `more straight-line acceleration than your other laps — a tow? Left out of comparisons — ${where}`;
    case "possible_traffic":
      return `a lift from flat out and back where you are normally flat — traffic? Left out of comparisons — ${where}`;
  }
}

/** "Lockups in T7 on 4 of 14 laps, those passes 0.21 s slower there."
 *
 *  Laps, not events: one lap can lock a wheel twice in the same corner, and
 *  "on 6 of 14 laps" must never count it twice. When the stored events were
 *  capped, the count falls back to events and says so. */
export function watchHighlights(w: WatchData, max = 4): string[] {
  const lapsByKey = new Map<string, Set<number>>();
  for (const e of w.events) {
    const k = `${e.corner}|${e.kind}`;
    if (!lapsByKey.has(k)) lapsByKey.set(k, new Set());
    lapsByKey.get(k)!.add(e.lap);
  }
  const total = w.laps_watched.length;
  const rows: { n: number; text: string }[] = [];
  for (const [corner, kinds] of Object.entries(w.matrix)) {
    for (const [kind, count] of Object.entries(kinds) as [WatchKind, number][]) {
      if (!count) continue;
      const link = w.links.find((l) => String(l.corner) === corner && l.kind === kind);
      const cost =
        link && link.median_delta_s > 0.005
          ? `, those passes ${link.median_delta_s.toFixed(2)} s slower there`
          : link
            ? ", those passes no slower there"
            : "";
      const lapsSeen = lapsByKey.get(`${corner}|${kind}`)?.size ?? 0;
      const span =
        w.capped || lapsSeen === 0 ? `${count} times` : `on ${lapsSeen} of ${total} laps`;
      rows.push({ n: w.capped ? count : lapsSeen, text: `${KIND_LABEL[kind]} in T${corner} ${span}${cost}` });
    }
  }
  return rows
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((r) => r.text);
}
