/* The coach: what to work on, aimed at what your own laps already did.
 *
 * ┌ THE RULES THIS FILE KEEPS ──────────────────────────────────────────────┐
 * │ Proctor used to stop at describing (explain.ts). Since 2026-11-25 it     │
 * │ also says what to try — on four conditions, each enforced by a test:    │
 * │                                                                         │
 * │ 1. TARGETS ARE YOURS. A suggestion only points at something one of the  │
 * │    driver's own laps this session already did, and quotes that lap and  │
 * │    the numbers. Never an outside ideal, never a per-car figure.         │
 * │ 2. EVIDENCE GATES IT. A habit must have gone with a quicker zone across │
 * │    enough laps that chance is unlikely (`coach_gates`, sent by the      │
 * │    parser), and the zone must be worth `min_at_stake_s`.                │
 * │ 3. GEAR COMES FIRST. A rule a gear-first finding blocks is not shown as │
 * │    technique; the equipment fix is shown instead.                       │
 * │ 4. HEDGED AND LABELLED. Time is "up to", links "seem to", linked time   │
 * │    "went with" — never "cost". The general "why" is a technique note    │
 * │    under technique.ts's LABEL, and never quotes the driver's values.    │
 * │                                                                         │
 * │ Intent is still not a channel: Proctor cannot see WHY a lap was quick.  │
 * │ It can see that the quick passes did something the typical ones didn't.│
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type {
  AspectCorner,
  AspectLink,
  AspectMetric,
  AspectZoneKey,
  BalanceData,
  CoachGates,
  DrivingAspectsData,
  HardwareData,
  InputResponseData,
  ReportCardData,
  TrackWidthData,
  TrailBrakingData,
  TrailCorner,
} from "@/lib/proctor/types";
import type { TechniqueNote } from "@/lib/proctor/technique";
import { TRAIL_TIE_S } from "@/lib/proctor/explain";
import {
  blockingFinding,
  gearCheck,
  leftFootBraker,
  type AspectKey,
  type GearCheck,
  type GearFinding,
  type RuleKey,
} from "@/lib/proctor/gearCheck";

export type { AspectKey, RuleKey };

export interface Suggestion {
  key: RuleKey;
  aspect: AspectKey;
  corners: number[];
  /** Billed: the zone time claimed. Linked: the gap that went with the habit. */
  atStakeS: number;
  linked: boolean;
  /** Where on the corner the claimed time is; null for linked time. */
  zone: AspectZoneKey | null;
  /** Strongest (lowest) p behind it; null where the evidence is a split, not a link. */
  p: number | null;
  title: string;
  evidence: string;
  /** The laps to go and look at. */
  laps: number[];
  why: TechniqueNote | null;
  /** Set when a gear-first finding stops this being shown as technique. */
  blocked: GearFinding | null;
}

export interface AspectSummary {
  key: AspectKey;
  label: string;
  /** Billed aspects sum zone time; linked ones sum what went with a habit. */
  atStakeS: number | null;
  linked: boolean;
  corners: { id: number; atStakeS: number }[];
  suggestions: Suggestion[];
  gear: GearCheck;
  tendency: string | null;
  /** Time in this aspect's own zones that another aspect's habit explained. */
  handedTo?: { aspect: AspectKey; atStakeS: number }[];
}

export type OneThing =
  | { kind: "suggestion"; suggestion: Suggestion }
  | { kind: "gear"; finding: GearFinding; suggestion: Suggestion }
  | { kind: "none"; reason: string };

export interface CoachReport {
  available: boolean;
  /** Why not, when it is not. */
  reason?: string;
  oneThing: OneThing;
  aspects: AspectSummary[];
  suggestions: Suggestion[];
  gates: CoachGates | null;
}

export interface CoachInputs {
  drivingAspects: DrivingAspectsData | null;
  trailBraking: TrailBrakingData | null;
  inputResponse: InputResponseData | null;
  hardware: HardwareData | null;
  reportCard: ReportCardData | null;
  balance: BalanceData | null;
  trackWidth: TrackWidthData | null;
  /** Absence reason for driving_aspects, when the bundle has one. */
  absentReason?: string;
}

export const ASPECT_LABEL: Record<AspectKey, string> = {
  braking: "Braking",
  turn_in: "Turn-in & steering",
  throttle: "Throttle & exit",
  line: "Line",
  grip: "Grip",
};

export const ASPECT_ORDER: AspectKey[] = ["braking", "turn_in", "throttle", "line", "grip"];

const ZONE_ASPECT: Record<Exclude<AspectZoneKey, "straight">, AspectKey> = {
  braking: "braking",
  rotation: "turn_in",
  exit: "throttle",
};

const RULE_ORDER: RuleKey[] = [
  "trail.carry",
  "trail.early_release",
  "brake.later",
  "brake.harder",
  "trail.restab",
  "grip.lockup",
  "trail.dip",
  "steer.once",
  "coast.close",
  "throttle.earlier",
  "throttle.commit",
  "throttle.squeeze",
  "line.turn_in",
  "line.apex",
  "line.exit",
  "drift.improving",
];

// ─────────────────────────────────────────────────────────────────────────────
// Words and numbers
// ─────────────────────────────────────────────────────────────────────────────

const t = (id: number) => `T${id}`;

export function where(ids: number[]): string {
  const ts = ids.map(t);
  if (ts.length <= 1) return ts[0] ?? "";
  // Past three, a list stops being read: name the two that matter most.
  if (ts.length > 3) return `${ts[0]}, ${ts[1]} and ${ts.length - 2} more`;
  return `${ts.slice(0, -1).join(", ")} and ${ts[ts.length - 1]}`;
}

const sec = (v: number) => `${Math.abs(v).toFixed(2)} s`;
const m1 = (v: number) => `${Math.abs(v).toFixed(1)} m`;
const p0 = (v: number) => `${v.toFixed(0)}%`;
const fromApex = (v: number) => `${m1(v)} ${v >= 0 ? "after" : "before"} the apex`;
const laps = (ns: number[]) => (ns.length === 1 ? `lap ${ns[0]}` : `laps ${ns.join(", ")}`);

function oneSidedP(link: AspectLink, sign: 1 | -1): number {
  const half = link.p / 2;
  return Math.sign(link.rho) === sign ? half : 1 - half;
}

/** The habit went with a quicker zone, across enough laps that chance is unlikely. */
function strong(link: AspectLink | null | undefined, sign: 1 | -1, g: CoachGates): boolean {
  return !!link && link.n >= g.strong_n && oneSidedP(link, sign) <= g.strong_p;
}

/** The quick passes through this zone were not slower over the whole corner. */
function wholeCorner(c: AspectCorner, zone: AspectZoneKey): boolean {
  const q = c.zones[zone].quick_corner_total_s;
  return q == null || q <= c.corner_total.typical_s;
}

function worth(c: AspectCorner, zone: AspectZoneKey, g: CoachGates): boolean {
  return c.zones[zone].at_stake_s >= g.min_at_stake_s;
}

// ─────────────────────────────────────────────────────────────────────────────
// The general "why" — technique, not a reading. Never quotes the driver.
// ─────────────────────────────────────────────────────────────────────────────

const WHY: Partial<Record<RuleKey, string>> = {
  "trail.carry":
    "Pressure still on at turn-in keeps weight on the front tyres, so they bite and rotate the car early. The release is a taper as the steering builds.",
  "trail.early_release":
    "Coming fully off the brake before turning in leaves a moment asking the tyres for nothing. Overlapping the two keeps the grip in use.",
  "trail.restab":
    "Pressing again during the release moves weight forward a second time, just as the front is asked to turn.",
  "trail.dip":
    "The quickest transitions blend the brake out as the steering comes in, so combined grip stays high rather than dipping between the two.",
  "brake.later":
    "A later brake point gains time only while the car still makes the apex. The whole-corner time is the check, not the braking zone alone.",
  "brake.harder":
    "Peak pressure early in the stop, while the car is fastest and most loaded, buys the most deceleration; pressure then comes off as speed does.",
  "grip.lockup":
    "A locked tyre slides instead of gripping. Lockups usually start in the first hit of the pedal, before load has moved forward.",
  "steer.once":
    "Each correction scrubs speed. A single, decisive input at turn-in, held to the apex, is conventionally the quicker shape.",
  "coast.close":
    "With neither pedal applied, the car is neither slowing efficiently nor driving out. Shortening that gap is conventionally free time.",
  "throttle.earlier":
    "Exit speed is carried all the way down the following straight, so throttle that comes in sooner is worth more than the corner alone.",
  "throttle.commit":
    "Lifting mid-exit unsettles the rear and restarts the drive. One progressive application is conventionally quicker.",
  "throttle.squeeze":
    "Past a few percent of slip, a driven tyre gives less drive, not more. Squeezing the throttle in keeps it under that line.",
  "line.turn_in":
    "Where the car turns in sets the arc it can carry. A small change at turn-in changes the whole corner.",
  "line.apex":
    "The apex position decides how early the car can straighten and drive out.",
  "line.exit":
    "Using the road on exit lets the car straighten sooner, which is when the throttle can go fully down.",
};

function why(key: RuleKey, because: string): TechniqueNote | null {
  const body = WHY[key];
  return body ? { body, because } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// One corner's findings
// ─────────────────────────────────────────────────────────────────────────────

interface Hit {
  key: RuleKey;
  /** Hits group into one suggestion by this. Defaults to `key`; the line
   *  rules add the direction, so "wider" and "tighter" never merge. */
  groupKey?: string;
  aspect: AspectKey;
  corner: number;
  /** The zone whose time this claims; null for linked time. */
  zone: AspectZoneKey | null;
  atStakeS: number;
  p: number | null;
  titleAt: (w: string) => string;
  evidence: string;
  laps: number[];
}

function metric(c: AspectCorner, key: keyof AspectCorner["metrics"]): AspectMetric | null {
  const m = c.metrics[key];
  return m && m.quick != null ? m : null;
}

function cornerHits(
  c: AspectCorner,
  tb: TrailCorner | undefined,
  g: CoachGates,
  improving: Set<string>,
  envelope: boolean,
): Hit[] {
  const hits: Hit[] = [];
  const zoneOk = (z: AspectZoneKey) => worth(c, z, g) && !improving.has(`${c.id}:${z}`);
  const quickLaps = (z: AspectZoneKey) => c.zones[z].quick_laps;

  // ── Braking ────────────────────────────────────────────────────────────────
  // Trail braking is a braking habit whose payoff lands between turn-in and the
  // apex — the car rotates sooner — so the trail rules claim the rotation zone
  // and say so, while staying under Braking where the driver will look for them.
  if (tb && tb.measured && zoneOk("rotation")) {
    const best = tb.best_entry;
    const med = tb.median;
    const link = tb.trail_vs_entry;
    const gain = best.gain_vs_median_s;
    const stood = gain != null && gain > TRAIL_TIE_S;
    if (
      link.measured &&
      link.link === "longer_trail_faster" &&
      link.p != null &&
      link.laps >= g.strong_n &&
      link.p / 2 <= g.strong_p &&
      best.trail_s != null &&
      med.trail_s != null &&
      best.trail_s > 0 &&
      best.trail_s > med.trail_s
    ) {
      const more =
        best.brake_at_turn_in_pct != null &&
        med.brake_at_turn_in_pct != null &&
        best.brake_at_turn_in_pct > med.brake_at_turn_in_pct;
      hits.push({
        key: "trail.carry",
        aspect: "braking",
        corner: c.id,
        zone: "rotation",
        atStakeS: c.zones.rotation.at_stake_s,
        p: link.p,
        titleAt: (w) => `Carry the brake further past turn-in at ${w}`,
        evidence: more
          ? `Lap ${best.lap}, your quickest entry to ${t(c.id)}, had ${p0(best.brake_at_turn_in_pct!)} brake at turn-in and held it ${sec(best.trail_s)}; you usually ${p0(med.brake_at_turn_in_pct!)}, ${sec(med.trail_s)}.`
          : `Lap ${best.lap}, your quickest entry to ${t(c.id)}, held the brake ${sec(best.trail_s)} past turn-in; you usually release after ${sec(med.trail_s)}.`,
        laps: [best.lap],
      });
    } else if (
      stood &&
      tb.braked_laps >= g.strong_n &&
      tb.released_before_turn_in_laps * 2 >= tb.braked_laps &&
      med.trail_s != null &&
      best.trail_s != null &&
      med.trail_s < 0 &&
      best.trail_s > 0
    ) {
      hits.push({
        key: "trail.early_release",
        aspect: "braking",
        corner: c.id,
        zone: "rotation",
        atStakeS: c.zones.rotation.at_stake_s,
        p: null,
        titleAt: (w) => `Hold some brake to the turn-in at ${w}`,
        evidence: `You were usually off the brake ${sec(med.trail_s)} before turning in to ${t(c.id)}; lap ${best.lap}, your quickest entry, held it ${sec(best.trail_s)} past.`,
        laps: [best.lap],
      });
    }
    if (stood && (med.restabs ?? 0) >= 1 && best.restabs === 0) {
      hits.push({
        key: "trail.restab",
        aspect: "braking",
        corner: c.id,
        zone: "rotation",
        atStakeS: c.zones.rotation.at_stake_s,
        p: null,
        titleAt: (w) => `Release the brake in one movement into ${w}`,
        evidence: `Your release into ${t(c.id)} usually pressed the pedal again; lap ${best.lap}, your quickest entry, did not.`,
        laps: [best.lap],
      });
    }
    if (
      envelope &&
      stood &&
      best.transition_min_pct != null &&
      med.transition_min_pct != null &&
      best.transition_min_pct - med.transition_min_pct >= g.dip_pts
    ) {
      hits.push({
        key: "trail.dip",
        aspect: "turn_in",
        corner: c.id,
        zone: "rotation",
        atStakeS: c.zones.rotation.at_stake_s,
        p: null,
        titleAt: (w) => `Blend the brake into the steering at ${w}`,
        evidence: `Between braking and turning into ${t(c.id)} you usually dropped to ${p0(med.transition_min_pct)} of your grip; lap ${best.lap} kept ${p0(best.transition_min_pct)}.`,
        laps: [best.lap],
      });
    }
    if (
      stood &&
      med.coast_s != null &&
      best.coast_s != null &&
      med.coast_s >= g.coast_s &&
      med.coast_s - best.coast_s >= g.coast_s
    ) {
      hits.push({
        key: "coast.close",
        aspect: "throttle",
        corner: c.id,
        zone: "rotation",
        atStakeS: c.zones.rotation.at_stake_s,
        p: null,
        titleAt: (w) => `Close the gap between brake and throttle in ${w}`,
        evidence: `You usually coast ${sec(med.coast_s)} with neither pedal in ${t(c.id)}; lap ${best.lap} coasted ${sec(best.coast_s)}.`,
        laps: [best.lap],
      });
    }
  }

  const bp = metric(c, "brake_point_m");
  if (
    bp &&
    zoneOk("braking") &&
    strong(bp.link, 1, g) &&
    bp.typical - bp.quick! >= g.brake_point_m &&
    wholeCorner(c, "braking") &&
    !(c.linked.lockup.measured && c.linked.lockup.delta_s > 0)
  ) {
    hits.push({
      key: "brake.later",
      aspect: "braking",
      corner: c.id,
      zone: "braking",
      atStakeS: c.zones.braking.at_stake_s,
      p: bp.link!.p,
      titleAt: (w) => `Brake later for ${w}`,
      evidence: `Your quicker passes into ${t(c.id)} (${laps(quickLaps("braking"))}) braked ${m1(bp.typical - bp.quick!)} later than you usually do.`,
      laps: quickLaps("braking"),
    });
  }

  const pk = metric(c, "peak_brake_pct");
  if (pk && zoneOk("braking") && strong(pk.link, -1, g) && pk.quick! - pk.typical >= g.peak_brake_pts) {
    hits.push({
      key: "brake.harder",
      aspect: "braking",
      corner: c.id,
      zone: "braking",
      atStakeS: c.zones.braking.at_stake_s,
      p: pk.link!.p,
      titleAt: (w) => `Brake harder at the top of the stop into ${w}`,
      evidence: `Your quicker stops into ${t(c.id)} peaked at ${p0(pk.quick!)}; you usually peak at ${p0(pk.typical)}.`,
      laps: quickLaps("braking"),
    });
  }

  if (c.linked.lockup.measured && c.linked.lockup.delta_s >= g.min_at_stake_s) {
    const l = c.linked.lockup;
    hits.push({
      key: "grip.lockup",
      aspect: "grip",
      corner: c.id,
      zone: null,
      atStakeS: l.delta_s,
      p: null,
      titleAt: (w) => `Ease the first hit of the brake into ${w}`,
      evidence: `${l.laps_with} laps locked a wheel into ${t(c.id)} and were ${sec(l.delta_s)} slower through it than the ${l.laps_without} that didn't.`,
      laps: [],
    });
  }

  // ── Turn-in & steering ────────────────────────────────────────────────────
  const corr = metric(c, "corrections");
  if (corr && zoneOk("rotation") && strong(corr.link, 1, g) && corr.typical - corr.quick! >= g.corrections) {
    hits.push({
      key: "steer.once",
      aspect: "turn_in",
      corner: c.id,
      zone: "rotation",
      atStakeS: c.zones.rotation.at_stake_s,
      p: corr.link!.p,
      titleAt: (w) => `Turn in once at ${w}`,
      evidence: `Your quicker passes made ${corr.quick!.toFixed(0)} steering corrections to the apex of ${t(c.id)}; you usually make ${corr.typical.toFixed(0)}.`,
      laps: quickLaps("rotation"),
    });
  }

  // ── Throttle & exit ───────────────────────────────────────────────────────
  const spun = c.linked.wheelspin.measured && c.linked.wheelspin.delta_s > 0;
  const pick = metric(c, "pickup_m");
  const full = metric(c, "full_m");
  const early =
    pick && strong(pick.link, 1, g) && pick.typical - pick.quick! >= g.pickup_m
      ? { m: pick, what: "picked up the throttle" }
      : full && strong(full.link, 1, g) && full.typical - full.quick! >= g.pickup_m
        ? { m: full, what: "were flat out" }
        : null;
  if (early && zoneOk("exit") && wholeCorner(c, "exit") && !spun) {
    const mm = early.m;
    hits.push({
      key: "throttle.earlier",
      aspect: "throttle",
      corner: c.id,
      zone: "exit",
      atStakeS: c.zones.exit.at_stake_s,
      p: mm.link!.p,
      titleAt: (w) => `Get on the throttle sooner out of ${w}`,
      evidence: `Your quicker exits from ${t(c.id)} ${early.what} ${fromApex(mm.quick!)}; you usually do at ${fromApex(mm.typical)}.`,
      laps: quickLaps("exit"),
    });
  }

  const lifts = metric(c, "exit_lifts");
  if (lifts && zoneOk("exit") && lifts.typical >= 1 && lifts.quick === 0 && wholeCorner(c, "exit")) {
    hits.push({
      key: "throttle.commit",
      aspect: "throttle",
      corner: c.id,
      zone: "exit",
      atStakeS: c.zones.exit.at_stake_s,
      p: lifts.link?.p ?? null,
      titleAt: (w) => `Commit to one throttle application out of ${w}`,
      evidence: `You usually lift on the way out of ${t(c.id)}; your quicker exits (${laps(quickLaps("exit"))}) did not.`,
      laps: quickLaps("exit"),
    });
  }

  if (c.linked.wheelspin.measured && c.linked.wheelspin.delta_s >= g.min_at_stake_s) {
    const w = c.linked.wheelspin;
    hits.push({
      key: "throttle.squeeze",
      aspect: "throttle",
      corner: c.id,
      zone: null,
      atStakeS: w.delta_s,
      p: null,
      titleAt: (x) => `Squeeze the throttle out of ${x}`,
      evidence: `${w.laps_with} laps spun a wheel out of ${t(c.id)} and were ${sec(w.delta_s)} slower to the next corner than the ${w.laps_without} that didn't.`,
      laps: [],
    });
  }

  // ── Line ──────────────────────────────────────────────────────────────────
  const phases: [RuleKey, keyof AspectCorner["metrics"], string][] = [
    ["line.turn_in", "offset_turn_in_m", "turn-in"],
    ["line.apex", "offset_apex_m", "the apex"],
    ["line.exit", "offset_exit_m", "the exit"],
  ];
  for (const [key, mk, phase] of phases) {
    const om = metric(c, mk);
    if (!om || !om.link) continue;
    const delta = om.quick! - om.typical;
    const sign = om.link.rho >= 0 ? 1 : -1;
    if (!strong(om.link, sign, g) || Math.abs(delta) < g.line_m) continue;
    // Offsets are positive to the LEFT of travel. Outside of a left-hander is right.
    const toward = delta > 0 ? "left" : "right";
    const outside = c.dir === "left" ? "right" : c.dir === "right" ? "left" : null;
    const how = outside == null ? `further ${toward}` : toward === outside ? "wider" : "tighter";
    hits.push({
      key,
      groupKey: `${key}:${how}`,
      aspect: "line",
      corner: c.id,
      zone: null,
      atStakeS: Math.max(0, c.corner_total.at_stake_s),
      p: om.link.p,
      titleAt: (w) =>
        key === "line.exit"
          ? `Run ${m1(delta)} ${how} on the exit of ${w}`
          : key === "line.apex"
            ? how === "tighter"
              ? `Get ${m1(delta)} closer to the apex at ${w}`
              : how === "wider"
                ? `Leave ${m1(delta)} more room at the apex of ${w}`
                : `Apex ${m1(delta)} ${how} at ${w}`
            : `Turn in ${m1(delta)} ${how} at ${w}`,
      evidence: `Your quicker passes through ${t(c.id)} were ${m1(delta)} further ${toward} at ${phase}, across ${om.link.n} laps.`,
      laps: c.corner_total.quick_laps,
    });
  }
  return hits;
}

/** Zones where the session got quicker as it went: the "best" is the stint
 *  settling in (or fuel), so technique tips there are not offered. */
function improvingZones(da: DrivingAspectsData): { set: Set<string>; hits: Hit[] } {
  const g = da.coach_gates;
  const n = da.laps_used.length;
  const lastThird = new Set(da.laps_used.slice(Math.floor((2 * n) / 3)));
  const set = new Set<string>();
  const hits: Hit[] = [];
  for (const c of da.corners) {
    for (const z of ["braking", "rotation", "exit"] as const) {
      const zone = c.zones[z];
      const d = zone.drift;
      if (!d || d.rho > -g.drift_rho || d.p > g.strong_p || zone.at_stake_s < g.min_at_stake_s) continue;
      const late = zone.quick_laps.filter((l) => lastThird.has(l)).length;
      if (late * 2 < zone.quick_laps.length) continue;
      set.add(`${c.id}:${z}`);
      hits.push({
        key: "drift.improving",
        aspect: ZONE_ASPECT[z],
        corner: c.id,
        zone: null,
        atStakeS: zone.at_stake_s,
        p: d.p,
        titleAt: (w) => `Keep going at ${w}`,
        evidence: `You found ${sec(zone.at_stake_s)} here as the session went on: your quickest passes came late.`,
        laps: zone.quick_laps,
      });
    }
  }
  return { set, hits };
}

// ─────────────────────────────────────────────────────────────────────────────
// Across corners
// ─────────────────────────────────────────────────────────────────────────────

function group(
  hits: Hit[],
  checks: Record<AspectKey, GearCheck>,
): { suggestions: Suggestion[]; claims: Map<string, AspectKey> } {
  // Each zone's time is claimed once, by the strongest rule that fired in it.
  const sorted = [...hits].sort(
    (a, b) => (a.p ?? 1) - (b.p ?? 1) || b.atStakeS - a.atStakeS || RULE_ORDER.indexOf(a.key) - RULE_ORDER.indexOf(b.key),
  );
  const claims = new Map<string, AspectKey>();
  const kept: Hit[] = [];
  for (const h of sorted) {
    if (h.zone != null) {
      const k = `${h.corner}:${h.zone}`;
      if (claims.has(k)) continue;
      claims.set(k, h.aspect);
    }
    kept.push(h);
  }

  const byKey = new Map<string, Hit[]>();
  for (const h of kept) {
    const k = h.groupKey ?? h.key;
    byKey.set(k, [...(byKey.get(k) ?? []), h]);
  }

  const out: Suggestion[] = [];
  for (const hs of byKey.values()) {
    hs.sort((a, b) => b.atStakeS - a.atStakeS);
    const lead = hs[0];
    const key = lead.key;
    const corners = [...hs.map((h) => h.corner)].sort((a, b) => a - b);
    const ps = hs.map((h) => h.p).filter((p): p is number => p != null);
    const check = checks[lead.aspect];
    // Blocked when the gear finding covers the corner carrying most of it.
    const blocked = check ? blockingFinding(check, key, lead.corner) : null;
    out.push({
      key,
      aspect: lead.aspect,
      corners,
      atStakeS: hs.reduce((s, h) => s + h.atStakeS, 0),
      linked: lead.zone == null,
      zone: lead.zone,
      p: ps.length ? Math.min(...ps) : null,
      title: lead.titleAt(where(corners)),
      evidence: lead.evidence,
      laps: lead.laps,
      why: why(key, `this fired in ${where(corners)}`),
      blocked,
    });
  }
  out.sort(
    (a, b) => b.atStakeS - a.atStakeS || b.corners.length - a.corners.length || RULE_ORDER.indexOf(a.key) - RULE_ORDER.indexOf(b.key),
  );
  return { suggestions: out, claims };
}

function pickOne(suggestions: Suggestion[], g: CoachGates): OneThing {
  const eligible = suggestions.filter(
    (s) =>
      !s.linked &&
      s.key !== "drift.improving" &&
      s.atStakeS >= g.one_thing_min_s &&
      (s.corners.length >= 2 || (s.p != null && s.p <= g.one_corner_p)),
  );
  const top = eligible[0];
  if (!top) {
    return {
      kind: "none",
      reason: `Nothing worth ${sec(g.one_thing_min_s)} a lap stood out with enough laps behind it. Your passes through each zone were close to your own quick ones.`,
    };
  }
  if (top.blocked) return { kind: "gear", finding: top.blocked, suggestion: top };
  return { kind: "suggestion", suggestion: top };
}

// ─────────────────────────────────────────────────────────────────────────────
// What each aspect looks like this session, in one line
// ─────────────────────────────────────────────────────────────────────────────

function tendency(aspect: AspectKey, inp: CoachInputs): string | null {
  switch (aspect) {
    case "braking": {
      if (leftFootBraker(inp.reportCard)) {
        const ds = inp.reportCard!.driving_style;
        if (ds.measured) return `You left-foot brake: the brake went on before the lift ${p0(ds.brake_before_lift_pct)} of the time.`;
      }
      const s = inp.trailBraking?.summary;
      if (s && s.corners_measured) {
        const before = s.released_before_turn_in?.length ?? 0;
        return `You trail-brake into ${s.corners_measured - before} of ${s.corners_measured} braked corners.`;
      }
      return null;
    }
    case "turn_in": {
      const b = inp.balance;
      if (!b) return null;
      const { understeer_pct: us, oversteer_pct: os } = b.tendency;
      if (us === os) return "When the car slid, it was as often the front as the rear.";
      return us > os
        ? `When the car slid, it was the front ${p0(us)} of the time — relative to your own average.`
        : `When the car slid, it was the rear ${p0(os)} of the time — relative to your own average.`;
    }
    case "throttle": {
      const th = inp.inputResponse?.throttle;
      if (th?.measured && th.slip) return `A wheel spun on ${th.slip.share_of_on_power_pct.toFixed(1)}% of your time on power.`;
      return null;
    }
    case "line": {
      const w = inp.trackWidth?.summary;
      if (w?.measured && w.median_typical_spread_m != null) return `Your line usually varied by ${m1(w.median_typical_spread_m)} lap to lap.`;
      return null;
    }
    case "grip": {
      const da = inp.drivingAspects;
      if (!da) return null;
      const lock = da.corners.filter((c) => c.linked.lockup.laps_with > 0).length;
      const spin = da.corners.filter((c) => c.linked.wheelspin.laps_with > 0).length;
      if (!lock && !spin) return "No lockups or wheelspin on your clean laps.";
      return `Lockups in ${lock} corner${lock === 1 ? "" : "s"}, wheelspin out of ${spin}, on your clean laps.`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The report
// ─────────────────────────────────────────────────────────────────────────────

export function coach(inp: CoachInputs): CoachReport {
  const gearInputs = {
    inputResponse: inp.inputResponse,
    hardware: inp.hardware,
    reportCard: inp.reportCard,
    balance: inp.balance,
  };
  const checks = Object.fromEntries(
    ASPECT_ORDER.map((a) => [a, gearCheck(a, gearInputs)]),
  ) as Record<AspectKey, GearCheck>;

  const da = inp.drivingAspects;
  if (!da) {
    const reason =
      inp.absentReason ??
      "This session has no aspect timing. Re-ingesting it from the rig computes it from the same file.";
    return {
      available: false,
      reason,
      oneThing: { kind: "none", reason },
      aspects: ASPECT_ORDER.map((key) => ({
        key,
        label: ASPECT_LABEL[key],
        atStakeS: null,
        linked: key === "line" || key === "grip",
        corners: [],
        suggestions: [],
        gear: checks[key],
        tendency: tendency(key, inp),
      })),
      suggestions: [],
      gates: null,
    };
  }

  const g = da.coach_gates;
  const tb = new Map((inp.trailBraking?.corners ?? []).map((c) => [c.id, c]));
  const { set: improving, hits: drift } = improvingZones(da);
  const hits = da.corners.flatMap((c) => cornerHits(c, tb.get(c.id), g, improving, da.envelope_available));
  const { suggestions, claims } = group([...hits, ...drift], checks);

  /* Who owns each zone's time. A zone a habit explained belongs to that habit's
     aspect — trail braking's time lands between turn-in and the apex, and it is
     a braking habit — otherwise to the zone's own aspect. Every zone is owned
     exactly once, so the billed tiles still add up to the same total. */
  const owned: Record<"braking" | "turn_in" | "throttle", { id: number; atStakeS: number }[]> = {
    braking: [],
    turn_in: [],
    throttle: [],
  };
  const handed: Record<"braking" | "turn_in" | "throttle", Map<AspectKey, number>> = {
    braking: new Map(),
    turn_in: new Map(),
    throttle: new Map(),
  };
  for (const c of da.corners) {
    for (const z of ["braking", "rotation", "exit"] as const) {
      const v = c.zones[z].at_stake_s;
      if (v <= 0) continue;
      const home = ZONE_ASPECT[z] as "braking" | "turn_in" | "throttle";
      const owner = (claims.get(`${c.id}:${z}`) ?? home) as "braking" | "turn_in" | "throttle";
      owned[owner].push({ id: c.id, atStakeS: v });
      if (owner !== home) handed[home].set(owner, (handed[home].get(owner) ?? 0) + v);
    }
  }

  const aspects: AspectSummary[] = ASPECT_ORDER.map((key) => {
    const mine = suggestions.filter((s) => s.aspect === key);
    if (key === "line" || key === "grip") {
      const corners =
        key === "grip"
          ? da.corners
              .map((c) => ({
                id: c.id,
                atStakeS:
                  (c.linked.lockup.measured ? Math.max(0, c.linked.lockup.delta_s) : 0) +
                  (c.linked.wheelspin.measured ? Math.max(0, c.linked.wheelspin.delta_s) : 0),
              }))
              .filter((c) => c.atStakeS > 0)
          : mine.filter((s) => s.key !== "drift.improving").flatMap((s) => s.corners.map((id) => ({ id, atStakeS: s.atStakeS / s.corners.length })));
      const measured = key === "line" ? da.line_available : true;
      return {
        key,
        label: ASPECT_LABEL[key],
        atStakeS: measured ? corners.reduce((s, c) => s + c.atStakeS, 0) : null,
        linked: true,
        corners: corners.sort((a, b) => b.atStakeS - a.atStakeS),
        suggestions: mine,
        gear: checks[key],
        tendency: tendency(key, inp),
      };
    }
    // Several zones of one corner can be owned by one aspect: merge them.
    const merged = new Map<number, number>();
    for (const r of owned[key]) merged.set(r.id, (merged.get(r.id) ?? 0) + r.atStakeS);
    const corners = [...merged].map(([id, v]) => ({ id, atStakeS: v })).sort((a, b) => b.atStakeS - a.atStakeS);
    return {
      key,
      label: ASPECT_LABEL[key],
      atStakeS: corners.reduce((sum, c) => sum + c.atStakeS, 0),
      linked: false,
      corners,
      suggestions: mine,
      gear: checks[key],
      tendency: tendency(key, inp),
      handedTo: [...handed[key]].map(([aspect, v]) => ({ aspect, atStakeS: v })),
    };
  });

  return {
    available: true,
    oneThing: pickOne(suggestions, g),
    aspects,
    suggestions,
    gates: g,
  };
}

/** Where a suggestion's time was measured, for the line under it. */
export const ZONE_PHRASE: Record<AspectZoneKey, string> = {
  braking: "in the braking zone",
  rotation: "from turn-in to the apex",
  exit: "from the apex to full throttle",
  straight: "on the straight",
};

/** "up to 0.42 s a lap from turn-in to the apex" — or "went with" for linked time. */
export function worthLine(s: Suggestion): string {
  return s.linked
    ? `went with up to ${sec(s.atStakeS)} a lap`
    : `up to ${sec(s.atStakeS)} a lap ${s.zone ? ZONE_PHRASE[s.zone] : ""}`.trim();
}

/** The aspect's time in one hedged sentence. */
export function aspectHeadline(a: AspectSummary, g: CoachGates | null): string {
  if (a.atStakeS == null) return `${a.label}: not measured for this session.`;
  const gave = (a.handedTo ?? []).sort((x, y) => y.atStakeS - x.atStakeS)[0];
  if (!g || a.atStakeS < g.min_at_stake_s) {
    if (g && gave && gave.atStakeS >= g.min_at_stake_s) {
      return `${a.label}: the time here went with your ${ASPECT_LABEL[gave.aspect].toLowerCase()}.`;
    }
    return `${a.label}: your passes were close to your own quick ones.`;
  }
  return a.linked
    ? `${a.label}: differences here went with up to ${sec(a.atStakeS)} a lap.`
    : `Your ${a.label.toLowerCase()} seems to cost up to ${sec(a.atStakeS)} a lap.`;
}
