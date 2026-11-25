/* You, or your gear?
 *
 * Every aspect of the driving gets a verdict before it gets a tip, because a
 * tip about braking is worthless if the brake pedal cannot report a full press.
 * The verdicts:
 *
 *   gear-first      the file shows the equipment limiting what the driver could
 *                   do or feel. The technique tips it would distort are BLOCKED
 *                   (listed in `blocks`) and the fix is offered instead.
 *   looks-like-you  every check for this aspect was measured and none fired.
 *   cant-tell       a check could not be made, or its reading fits both the
 *                   driver and the rig. Said plainly; never rounded to "fine".
 *
 * Every threshold comes off the payload (`gear_rule`, `rule`,
 * `flag_threshold_pct`), never from a literal here — the equipment.ts rule.
 * The fixes are general knowledge about equipment, labelled as such wherever
 * they render; nothing here can see the rig, only what it reported. */

import type {
  BalanceData,
  HardwareData,
  InputResponseData,
  ReportCardData,
} from "@/lib/proctor/types";

export type AspectKey = "braking" | "turn_in" | "throttle" | "line" | "grip";
export type Verdict = "gear-first" | "looks-like-you" | "cant-tell";

export type RuleKey =
  | "trail.carry"
  | "trail.early_release"
  | "trail.restab"
  | "trail.dip"
  | "brake.later"
  | "brake.harder"
  | "grip.lockup"
  | "coast.close"
  | "throttle.earlier"
  | "throttle.squeeze"
  | "throttle.commit"
  | "steer.once"
  | "line.turn_in"
  | "line.apex"
  | "line.exit"
  | "drift.improving";

export interface GearFinding {
  /** What was checked, in a driver's words. */
  label: string;
  verdict: Verdict;
  /** The reading, with its number. */
  detail: string;
  /** Equipment advice — general knowledge, rendered with GEAR_FIX_LABEL. */
  fix?: string;
  /** Rules this finding stops from being shown as technique. */
  blocks: RuleKey[];
  /** Corners the block applies to; absent = every corner. */
  corners?: number[];
}

export interface GearCheck {
  aspect: AspectKey;
  verdict: Verdict;
  headline: string;
  findings: GearFinding[];
  /** PC context (frame rate). Shown beside the verdict, never decides it. */
  context?: string;
}

/** Rendered beside every equipment fix. */
export const GEAR_FIX_LABEL =
  "General equipment advice. Proctor reads what the rig reported, not the rig itself.";

export interface GearInputs {
  inputResponse: InputResponseData | null;
  hardware: HardwareData | null;
  reportCard: ReportCardData | null;
  balance?: BalanceData | null;
}

const RANK: Record<Verdict, number> = { "looks-like-you": 0, "cant-tell": 1, "gear-first": 2 };

function worst(findings: GearFinding[]): Verdict {
  return findings.reduce<Verdict>(
    (v, f) => (RANK[f.verdict] > RANK[v] ? f.verdict : v),
    "looks-like-you",
  );
}

const one = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

// ─────────────────────────────────────────────────────────────────────────────
// Braking
// ─────────────────────────────────────────────────────────────────────────────

/** A resting left foot reads like sensor noise, so for a left-foot braker the
 *  noise floor cannot be pinned on the pedal. */
export function leftFootBraker(rc: ReportCardData | null): boolean {
  const ds = rc?.driving_style;
  return !!ds && ds.measured && ds.style_observation.includes("left-foot");
}

function brakeTopEnd(ir: InputResponseData | null): GearFinding {
  const label = "The brake pedal's top end";
  if (!ir || !ir.brake.measured) {
    return {
      label,
      verdict: "cant-tell",
      detail: ir && !ir.brake.measured ? ir.brake.reason : "The brake was not measured for this session.",
      blocks: [],
    };
  }
  const ceiling = ir.brake.pedal_ceiling_pct;
  const shape = ir.brake.ceiling_shape;
  if (!shape) {
    return {
      label,
      verdict: "cant-tell",
      detail: `Your pedal read up to ${one(ceiling)}%. This session was ingested before stop shapes were read; a re-ingest checks it.`,
      blocks: [],
    };
  }
  const rule = shape.gear_rule;
  if (shape.hard_stops < rule.min_stops || shape.at_ceiling == null) {
    return {
      label,
      verdict: "cant-tell",
      detail: `Only ${shape.hard_stops} hard stops above ${one(shape.min_peak_pct)}% — too few to read the pedal's shape.`,
      blocks: [],
    };
  }
  const share = shape.at_ceiling / shape.hard_stops;
  if (ceiling < rule.full_pct && share >= rule.at_ceiling_share) {
    return {
      label,
      verdict: "gear-first",
      detail: `${shape.at_ceiling} of ${shape.hard_stops} hard stops landed on exactly ${one(ceiling)}%. A foot varies; this is the pedal's limit.`,
      fix: "Recalibrate the brake pedal so a full press reads 100% — in iRacing's calibration, or the pedal's own software.",
      blocks: ["brake.harder", "brake.later", "grip.lockup"],
    };
  }
  if (ceiling >= rule.full_pct && share >= rule.at_ceiling_share) {
    return {
      label,
      verdict: "cant-tell",
      detail: `${shape.at_ceiling} of ${shape.hard_stops} stops used the pedal's full travel — stamping, or a pedal set too light.`,
      blocks: [],
    };
  }
  return {
    label,
    verdict: "looks-like-you",
    detail:
      shape.median_peak_pct != null && shape.peak_spread_pct != null
        ? `Your stops peaked around ${one(shape.median_peak_pct)}% and varied by ${one(shape.peak_spread_pct)} points — a foot choosing.`
        : `Your stops varied below the ${one(ceiling)}% ceiling — a foot choosing.`,
    blocks: [],
  };
}

function brakeJumps(hw: HardwareData | null): GearFinding | null {
  const brief = hw?.pedal_noise.brief;
  if (!brief) return null;
  if (brief.events > 0) {
    return {
      label: "Brake readings too quick for a foot",
      verdict: "gear-first",
      detail: `${brief.events} reading${brief.events === 1 ? "" : "s"} jumped above ${brief.min_reading_pct}% and vanished inside ${brief.max_duration_ms} ms.`,
      fix: "Check the brake pedal's cable and connector, then recalibrate. A jump that short is the sensor, not a press.",
      blocks: ["trail.restab"],
    };
  }
  return {
    label: "Brake readings too quick for a foot",
    verdict: "looks-like-you",
    detail: `None: nothing above ${brief.min_reading_pct}% came and went inside ${brief.max_duration_ms} ms.`,
    blocks: [],
  };
}

function brakeNoise(hw: HardwareData | null, rc: ReportCardData | null): GearFinding | null {
  const n = hw?.pedal_noise;
  if (!n || n.spike_ticks == null) return null;
  if (n.spike_ticks === 0) {
    return {
      label: "Brake noise with your foot off",
      verdict: "looks-like-you",
      detail: "Silent while you were flat on the throttle.",
      blocks: [],
    };
  }
  if (leftFootBraker(rc)) {
    return {
      label: "Brake noise with your foot off",
      verdict: "cant-tell",
      detail: `${n.spike_ticks} faint readings while flat out — but you left-foot brake, and a resting foot reads the same.`,
      blocks: [],
    };
  }
  return {
    label: "Brake noise with your foot off",
    verdict: "cant-tell",
    detail: `${n.spike_ticks} faint readings while you were flat on the throttle. Worth watching across sessions.`,
    fix: "A noise floor that grows session to session is usually a worn sensor or a loose connector.",
    blocks: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Throttle
// ─────────────────────────────────────────────────────────────────────────────

function throttleRange(ir: InputResponseData | null): GearFinding {
  const label = "The throttle's range";
  if (!ir || !ir.throttle.measured) {
    return {
      label,
      verdict: "cant-tell",
      detail: ir && !ir.throttle.measured ? ir.throttle.reason : "The throttle was not measured for this session.",
      blocks: [],
    };
  }
  const r = ir.throttle.range;
  if (!r) {
    return {
      label,
      verdict: "cant-tell",
      detail: "Ingested before the throttle's range was read; a re-ingest checks it.",
      blocks: [],
    };
  }
  if (!r.measured) return { label, verdict: "cant-tell", detail: r.reason, blocks: [] };
  if (r.floor_pct >= r.rule.floor_watch_pct) {
    return {
      label,
      verdict: "gear-first",
      detail: `Your throttle never read below ${one(r.floor_pct)}% — it is not returning to zero.`,
      fix: "Recalibrate the throttle, or add a small deadzone at the bottom of its travel.",
      blocks: ["coast.close", "throttle.commit"],
    };
  }
  if (r.ceiling_pct < r.rule.full_pct) {
    const flat = r.flat_out_holds > 0 && r.holds_flat_at_ceiling * 2 >= r.flat_out_holds;
    return flat
      ? {
          label,
          verdict: "gear-first",
          detail: `Flat out read ${one(r.ceiling_pct)}% on ${r.holds_flat_at_ceiling} of ${r.flat_out_holds} holds — the pedal cannot report full.`,
          fix: "Recalibrate the throttle so a full press reads 100%.",
          blocks: ["throttle.earlier", "throttle.commit", "throttle.squeeze"],
        }
      : {
          label,
          verdict: "cant-tell",
          detail: `Your throttle topped out at ${one(r.ceiling_pct)}%, without sitting flat there.`,
          blocks: [],
        };
  }
  return {
    label,
    verdict: "looks-like-you",
    detail: `Full range: down to ${one(r.floor_pct)}%, up to ${one(r.ceiling_pct)}%.`,
    blocks: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Steering
// ─────────────────────────────────────────────────────────────────────────────

function wheelLimit(hw: HardwareData | null): GearFinding {
  const label = "The wheel at its force limit";
  const f = hw?.ffb;
  if (!f || f.clipping_pct == null) {
    return {
      label,
      verdict: "cant-tell",
      detail: f?.reason ?? "Force feedback was not measured for this session.",
      blocks: [],
    };
  }
  const line = f.flag_threshold_pct;
  const clipped = line == null ? [] : f.by_corner.filter((c) => c.clipping_pct >= line).map((c) => c.id);
  if (f.flagged) {
    return {
      label,
      verdict: "gear-first",
      detail: `At its limit ${one(f.clipping_pct)}% of the time you were moving — road detail stops reaching your hands there.`,
      fix: "Lower the force (in-sim strength, or the wheelbase's maximum) until clipping stays rare.",
      blocks: ["steer.once", "trail.dip"],
      corners: clipped.length ? clipped : undefined,
    };
  }
  if (clipped.length) {
    return {
      label,
      verdict: "gear-first",
      detail: `At its limit through ${clipped.map((c) => `T${c}`).join(", ")}.`,
      fix: "Lower the force until those corners stop clipping.",
      blocks: ["steer.once", "trail.dip"],
      corners: clipped,
    };
  }
  return {
    label,
    verdict: "looks-like-you",
    detail:
      f.clipping_pct === 0
        ? "Never at its limit while you were moving."
        : `At its limit ${one(f.clipping_pct)}% of the time, under the ${one(line ?? 0)}% watch line.`,
    blocks: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per aspect
// ─────────────────────────────────────────────────────────────────────────────

function frameContext(rc: ReportCardData | null): string | undefined {
  const fh = rc?.frame_health;
  if (!fh || !fh.available) return undefined;
  if (fh.sub_60_seconds > 0) {
    return `Your frame rate dipped below 60 for ${one(fh.sub_60_seconds)} s (lowest ${one(fh.min_fps)} fps).`;
  }
  return undefined;
}

/** The PC, in a few words for the gear strip's last cell. Context only: a
 *  frame-rate dip never decides an aspect's verdict. */
export function frameCell(rc: ReportCardData | null): { dipped: boolean; line: string } {
  const fh = rc?.frame_health;
  if (!fh || !fh.available) return { dipped: false, line: "frame rate not recorded" };
  if (fh.sub_60_seconds > 0) return { dipped: true, line: `${one(fh.sub_60_seconds)} s under 60 fps` };
  return { dipped: false, line: "never under 60 fps" };
}

const HEADLINE: Record<Verdict, string> = {
  "gear-first": "Check your gear first",
  "looks-like-you": "Looks like you, not your gear",
  "cant-tell": "Can't tell you from your gear here",
};

export function gearCheck(aspect: AspectKey, inp: GearInputs): GearCheck {
  const findings: GearFinding[] = [];
  if (aspect === "braking") {
    findings.push(brakeTopEnd(inp.inputResponse));
    const j = brakeJumps(inp.hardware);
    if (j) findings.push(j);
    const n = brakeNoise(inp.hardware, inp.reportCard);
    if (n) findings.push(n);
  } else if (aspect === "throttle") {
    findings.push(throttleRange(inp.inputResponse));
  } else if (aspect === "turn_in") {
    findings.push(wheelLimit(inp.hardware));
  }
  // Line and grip: nothing on a rig limits where the car goes or how much grip
  // the tyres have, so they are never gear-first.
  const verdict = findings.length ? worst(findings) : "looks-like-you";
  return {
    aspect,
    verdict,
    headline: findings.length ? HEADLINE[verdict] : "Nothing on the rig decides this",
    findings,
    context: frameContext(inp.reportCard),
  };
}

/** Every equipment finding in one list, for the Gear screen. */
export function allGearChecks(inp: GearInputs): GearCheck[] {
  return (["braking", "throttle", "turn_in"] as const).map((a) => gearCheck(a, inp));
}

/** Is `rule` at `corner` blocked by a gear-first finding? Returns the finding. */
export function blockingFinding(
  check: GearCheck,
  rule: RuleKey,
  corner: number | null,
): GearFinding | null {
  for (const f of check.findings) {
    if (f.verdict !== "gear-first" || !f.blocks.includes(rule)) continue;
    if (f.corners && corner != null && !f.corners.includes(corner)) continue;
    return f;
  }
  return null;
}
