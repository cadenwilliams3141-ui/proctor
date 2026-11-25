/* Focus memory: tackle one thing at a time, and see whether it moved.
 *
 * The driver pins a suggestion as their focus. What their driving looked like
 * then — for each corner it named: where the corner is, the time in the
 * stretch the suggestion claimed, and the habit it was about — is kept as the
 * BASELINE (driver_focus.baseline, migrations/003). The next session at the
 * same car and track is read against it.
 *
 * Three things keep this honest:
 *
 *   - CORNERS ARE MATCHED BY PLACE, NOT ID. Corner ids are numbered from each
 *     session's own reference lap, so T4 today may not be yesterday's T4. A
 *     corner is the same corner when its apex sits within FOCUS_APEX_TOLERANCE
 *     of a lap's length; one that cannot be found is said, not guessed.
 *   - THE SERVER BUILDS THE BASELINE. The route re-derives the suggestion from
 *     the stored session; a browser cannot hand it numbers to save.
 *   - A DIFFERENT DAY IS A DIFFERENT DAY. Track temperature, setup and fuel
 *     move these numbers as much as a habit can. The caveat travels with the
 *     reading, and a change smaller than the payload's own min_at_stake_s is
 *     "held", not "better".
 */

import type { AspectKey, RuleKey, Suggestion } from "@/lib/proctor/coach";
import type {
  AspectMetricKey,
  AspectZoneKey,
  DrivingAspectsData,
  TrailBrakingData,
  TrailMedians,
} from "@/lib/proctor/types";

/** A corner is the same corner when its apex is within this share of a lap. */
export const FOCUS_APEX_TOLERANCE = 0.01;

type TrailKey = "trail_s" | "coast_s" | "restabs" | "transition_min_pct";

interface Habit {
  from: "aspects" | "trail";
  key: AspectMetricKey | TrailKey;
  /** What the habit is, in a driver's words, and its unit. */
  label: string;
  unit: string;
  /** Which way the quick passes pointed; null where only distance from them counts. */
  better: "higher" | "lower" | null;
}

/** The habit each rule is about. Null: the rule is about linked time only. */
export const FOCUS_HABIT: Record<RuleKey, Habit | null> = {
  "trail.carry": { from: "trail", key: "trail_s", label: "brake held past turn-in", unit: "s", better: "higher" },
  "trail.early_release": { from: "trail", key: "trail_s", label: "brake held past turn-in", unit: "s", better: "higher" },
  "trail.restab": { from: "trail", key: "restabs", label: "re-presses during the release", unit: "", better: "lower" },
  "trail.dip": { from: "trail", key: "transition_min_pct", label: "grip kept between brake and turn", unit: "%", better: "higher" },
  "coast.close": { from: "trail", key: "coast_s", label: "coasting with neither pedal", unit: "s", better: "lower" },
  "brake.later": { from: "aspects", key: "brake_point_m", label: "brake point before the apex", unit: "m", better: "lower" },
  "brake.harder": { from: "aspects", key: "peak_brake_pct", label: "peak brake pressure", unit: "%", better: "higher" },
  "grip.lockup": null,
  "steer.once": { from: "aspects", key: "corrections", label: "steering corrections to the apex", unit: "", better: "lower" },
  "throttle.earlier": { from: "aspects", key: "pickup_m", label: "throttle pickup after the apex", unit: "m", better: "lower" },
  "throttle.commit": { from: "aspects", key: "exit_lifts", label: "lifts on the way out", unit: "", better: "lower" },
  "throttle.squeeze": null,
  "line.turn_in": { from: "aspects", key: "offset_turn_in_m", label: "position at turn-in", unit: "m", better: null },
  "line.apex": { from: "aspects", key: "offset_apex_m", label: "position at the apex", unit: "m", better: null },
  "line.exit": { from: "aspects", key: "offset_exit_m", label: "position at the exit", unit: "m", better: null },
  "drift.improving": null,
};

/** Rules a driver can pin. "Keep going" is encouragement, not a thing to practise. */
export const PINNABLE: RuleKey[] = (Object.keys(FOCUS_HABIT) as RuleKey[]).filter((k) => k !== "drift.improving");

export interface FocusCorner {
  id: number;
  apex_pct: number;
  zone_typical_s: number | null;
  habit_typical: number | null;
  habit_quick: number | null;
}

export interface FocusBaseline {
  zone: AspectZoneKey | "total";
  at_stake_s: number;
  evidence: string;
  recorded_at: string | null;
  corners: FocusCorner[];
}

export interface DriverFocus {
  id: number;
  car_name: string;
  track_name: string;
  aspect: AspectKey;
  rule_key: RuleKey;
  title: string;
  baseline_session_id: number | null;
  baseline: FocusBaseline;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The baseline
// ─────────────────────────────────────────────────────────────────────────────

function habitValues(
  habit: Habit | null,
  cornerId: number,
  da: DrivingAspectsData,
  tb: TrailBrakingData | null,
): { typical: number | null; quick: number | null } {
  if (!habit) return { typical: null, quick: null };
  if (habit.from === "aspects") {
    const m = da.corners.find((c) => c.id === cornerId)?.metrics[habit.key as AspectMetricKey];
    return { typical: m?.typical ?? null, quick: m?.quick ?? null };
  }
  const t = tb?.corners.find((c) => c.id === cornerId);
  if (!t || !t.measured) return { typical: null, quick: null };
  const k = habit.key as keyof TrailMedians;
  return {
    typical: (t.median[k] as number | null) ?? null,
    quick: (t.best_entry[k as keyof typeof t.best_entry] as number | null) ?? null,
  };
}

function zoneTime(da: DrivingAspectsData, cornerId: number, zone: AspectZoneKey | "total"): number | null {
  const c = da.corners.find((x) => x.id === cornerId);
  if (!c) return null;
  return zone === "total" ? c.corner_total.typical_s : c.zones[zone].typical_s;
}

/** What the driving looked like when the focus was pinned. */
export function focusBaseline(
  s: Suggestion,
  da: DrivingAspectsData,
  tb: TrailBrakingData | null,
  recordedAt: string | null,
): FocusBaseline {
  const zone = s.zone ?? "total";
  const habit = FOCUS_HABIT[s.key];
  return {
    zone,
    at_stake_s: s.atStakeS,
    evidence: s.evidence,
    recorded_at: recordedAt,
    corners: s.corners.flatMap((id) => {
      const c = da.corners.find((x) => x.id === id);
      if (!c) return [];
      const h = habitValues(habit, id, da, tb);
      return [{ id, apex_pct: c.apex_pct, zone_typical_s: zoneTime(da, id, zone), habit_typical: h.typical, habit_quick: h.quick }];
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// This session against it
// ─────────────────────────────────────────────────────────────────────────────

export type FocusState = "same-session" | "quicker" | "slower" | "held" | "cant-compare";

export interface FocusProgress {
  state: FocusState;
  /** Change in the claimed stretch's typical time, summed over matched corners.
   *  Negative is quicker. */
  zoneDeltaS: number | null;
  matched: { then: FocusCorner; nowId: number; zoneNowS: number | null; habitNow: number | null }[];
  unmatched: FocusCorner[];
  /** Habit, averaged over matched corners: then and now. */
  habitThen: number | null;
  habitNow: number | null;
  habitMoved: "toward" | "away" | "same" | null;
  reason?: string;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function matchCorner(apexPct: number, da: DrivingAspectsData): number | null {
  let best: { id: number; d: number } | null = null;
  for (const c of da.corners) {
    const raw = Math.abs(c.apex_pct - apexPct);
    const d = Math.min(raw, 1 - raw); // the lap wraps at the line
    if (d <= FOCUS_APEX_TOLERANCE && (!best || d < best.d)) best = { id: c.id, d };
  }
  return best?.id ?? null;
}

export function focusProgress(
  focus: DriverFocus,
  sessionId: number | string | null,
  da: DrivingAspectsData | null,
  tb: TrailBrakingData | null,
): FocusProgress {
  const empty = { zoneDeltaS: null, matched: [], unmatched: [], habitThen: null, habitNow: null, habitMoved: null };
  if (sessionId != null && focus.baseline_session_id != null && String(focus.baseline_session_id) === String(sessionId)) {
    return { state: "same-session", ...empty };
  }
  if (!da) {
    return { state: "cant-compare", ...empty, reason: "this session has no aspect timing to compare with" };
  }
  const habit = FOCUS_HABIT[focus.rule_key];
  const matched: FocusProgress["matched"] = [];
  const unmatched: FocusCorner[] = [];
  for (const then of focus.baseline.corners) {
    const nowId = matchCorner(then.apex_pct, da);
    if (nowId == null) {
      unmatched.push(then);
      continue;
    }
    matched.push({
      then,
      nowId,
      zoneNowS: zoneTime(da, nowId, focus.baseline.zone),
      habitNow: habitValues(habit, nowId, da, tb).typical,
    });
  }
  if (!matched.length) {
    return {
      state: "cant-compare",
      ...empty,
      unmatched,
      reason: "none of those corners was found where it was last time — a different layout, or a reference lap that carved the lap differently",
    };
  }

  const pairs = matched.filter((m) => m.then.zone_typical_s != null && m.zoneNowS != null);
  const zoneDeltaS = pairs.length ? pairs.reduce((s, m) => s + (m.zoneNowS! - m.then.zone_typical_s!), 0) : null;

  const hThen = mean(matched.flatMap((m) => (m.then.habit_typical == null ? [] : [m.then.habit_typical])));
  const hNow = mean(matched.flatMap((m) => (m.habitNow == null ? [] : [m.habitNow])));
  const hQuick = mean(matched.flatMap((m) => (m.then.habit_quick == null ? [] : [m.then.habit_quick])));
  let habitMoved: FocusProgress["habitMoved"] = null;
  if (hThen != null && hNow != null) {
    if (hNow === hThen) habitMoved = "same";
    else if (habit?.better === "higher") habitMoved = hNow > hThen ? "toward" : "away";
    else if (habit?.better === "lower") habitMoved = hNow < hThen ? "toward" : "away";
    else if (hQuick != null) habitMoved = Math.abs(hNow - hQuick) < Math.abs(hThen - hQuick) ? "toward" : "away";
  }

  const band = da.coach_gates.min_at_stake_s;
  const state: FocusState =
    zoneDeltaS == null ? "cant-compare" : Math.abs(zoneDeltaS) < band ? "held" : zoneDeltaS < 0 ? "quicker" : "slower";
  return {
    state,
    zoneDeltaS,
    matched,
    unmatched,
    habitThen: hThen,
    habitNow: hNow,
    habitMoved,
    reason: state === "cant-compare" ? "the stretch's time was not measured on both days" : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

const ZONE_WORDS: Record<AspectZoneKey | "total", string> = {
  braking: "those braking zones",
  rotation: "turn-in to apex there",
  exit: "those exits",
  straight: "those straights",
  total: "those corners",
};

function habitText(n: number, unit: string): string {
  const dp = unit === "%" ? 0 : unit === "m" ? 1 : unit === "s" ? 2 : 0;
  return `${n.toFixed(dp)}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
}

/** One or two sentences: what moved, in the driver's own numbers. */
export function progressLine(focus: DriverFocus, p: FocusProgress): string {
  const habit = FOCUS_HABIT[focus.rule_key];
  if (p.state === "same-session") return "Pinned from this session. The next session at this car and track will be read against it.";
  if (p.state === "cant-compare") return `Can't compare this session: ${p.reason}.`;
  const d = Math.abs(p.zoneDeltaS ?? 0).toFixed(2);
  const where = ZONE_WORDS[focus.baseline.zone];
  const first =
    p.state === "held"
      ? d === "0.00"
        ? `Your typical time through ${where} matched last time.`
        : `Your typical time through ${where} held within ${d} s.`
      : `Your typical time through ${where} was ${d} s ${p.state === "quicker" ? "quicker" : "slower"}.`;
  if (!habit || p.habitThen == null || p.habitNow == null) return first;
  return `${first} ${habit.label[0].toUpperCase()}${habit.label.slice(1)}: ${habitText(p.habitNow, habit.unit)}, was ${habitText(p.habitThen, habit.unit)}.`;
}

export const FOCUS_CAVEAT =
  "A different day: track temperature, setup and fuel move these numbers as much as a habit can. Corners are matched by where they sit on the lap.";

// ─────────────────────────────────────────────────────────────────────────────
// The request the route accepts
// ─────────────────────────────────────────────────────────────────────────────

export type FocusRequest = { sessionId: string; key: RuleKey; corners: number[] };

/** Validate a pin request. Anything not exactly this shape is refused: the site
 *  has no login, so the route accepts nothing it does not need. */
export function parseFocusRequest(body: unknown): FocusRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const sessionId = typeof b.sessionId === "number" ? String(b.sessionId) : b.sessionId;
  if (typeof sessionId !== "string" || !/^\d{1,12}$/.test(sessionId)) return { error: "sessionId must be a session number" };
  if (typeof b.key !== "string" || !PINNABLE.includes(b.key as RuleKey)) return { error: "key is not a suggestion that can be pinned" };
  if (!Array.isArray(b.corners) || b.corners.length === 0 || b.corners.length > 40) return { error: "corners must list the suggestion's corners" };
  if (!b.corners.every((c) => Number.isInteger(c) && c > 0 && c < 1000)) return { error: "corners must be corner numbers" };
  return { sessionId, key: b.key as RuleKey, corners: [...(b.corners as number[])].sort((x, y) => x - y) };
}
