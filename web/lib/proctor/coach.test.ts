/* The coach's four rules, each held by a test (see the header of coach.ts):
 * targets are the driver's own, evidence gates every tip, gear comes first,
 * and the copy is hedged, short and labelled.
 *
 * Two kinds of input. The real parser output for the dev fixture's healthy and
 * short-pedal sessions (__fixtures__/coach-sessions.json, regenerated from
 * render-service/tools/make_fixture_session.py) catches a payload shape the
 * coach no longer reads. Hand-built corners plant one trigger at a time. */

import { describe, expect, it } from "vitest";

import data from "./__fixtures__/coach-sessions.json";
import { aspectHeadline, coach, where, worthLine, type CoachInputs } from "./coach";
import {
  balanceFrom,
  drivingAspectsFrom,
  hardwareFrom,
  inputResponseFrom,
  reportCardFrom,
  trailBrakingFrom,
} from "./server/shape";
import type {
  AspectCorner,
  AspectMetric,
  AspectZone,
  CoachGates,
  DrivingAspectsData,
  MetricPayloads,
  TrackWidthData,
} from "./types";

const MAX_TITLE_WORDS = 14;
const MAX_EVIDENCE_WORDS = 32;
const words = (s: string) => s.trim().split(/\s+/).length;

function fromPayload(m: MetricPayloads): CoachInputs {
  return {
    drivingAspects: drivingAspectsFrom(m),
    trailBraking: trailBrakingFrom(m),
    inputResponse: inputResponseFrom(m),
    hardware: hardwareFrom(m),
    reportCard: reportCardFrom(m),
    balance: balanceFrom(m),
    trackWidth: m.track_width as unknown as TrackWidthData,
  };
}

const sessions = data as unknown as Record<"healthy" | "short_pedal", MetricPayloads>;

// ─────────────────────────────────────────────────────────────────────────────
// Hand-built
// ─────────────────────────────────────────────────────────────────────────────

const GATES: CoachGates = {
  strong_n: 6,
  strong_p: 0.1,
  one_corner_p: 0.02,
  min_at_stake_s: 0.03,
  one_thing_min_s: 0.1,
  brake_point_m: 3,
  peak_brake_pts: 5,
  pickup_m: 5,
  corrections: 1,
  line_m: 0.5,
  dip_pts: 10,
  coast_s: 0.05,
  drift_rho: 0.5,
  linked_min_laps_each_side: 2,
};

function zone(at: number, over: Partial<AspectZone> = {}): AspectZone {
  return {
    typical_s: 2,
    best_s: 2 - at - 0.01,
    best_lap: 4,
    second_best_s: 2 - at,
    at_stake_s: at,
    quick_laps: [4, 7, 9],
    drift: null,
    per_lap: {},
    quick_corner_total_s: 5.8,
    ...over,
  };
}

const metric = (typical: number, quick: number, rho: number, p = 0.001, n = 9): AspectMetric => ({
  zone: "braking",
  typical,
  quick,
  link: { rho, p, n },
  per_lap: {},
});

function corner(id: number, over: Partial<AspectCorner> = {}): AspectCorner {
  return {
    id,
    start_pct: 0.1 * id,
    apex_pct: 0.1 * id + 0.03,
    end_pct: 0.1 * id + 0.06,
    dir: "left",
    bounds: { brake_pct: 0, turn_in_pct: 0, apex_pct: 0, full_pct: 0, next_brake_pct: 0 },
    braked_laps: 9,
    early_brakers: [],
    braking_truncated_at_line: false,
    zones: { braking: zone(0.06), rotation: zone(0.01), exit: zone(0.01), straight: zone(0.01) },
    corner_total: zone(0.08, { typical_s: 6 }),
    metrics: {},
    linked: {
      lockup: { measured: false, laps_with: 0, laps_without: 9, reason: "none" },
      wheelspin: { measured: false, laps_with: 0, laps_without: 9, reason: "none" },
      carry: { measured: false, reason: "none" },
    },
    ...over,
  };
}

function aspects(corners: AspectCorner[], gates: CoachGates = GATES): DrivingAspectsData {
  const sum = (z: "braking" | "rotation" | "exit" | "straight") => ({
    at_stake_s: corners.reduce((s, c) => s + c.zones[z].at_stake_s, 0),
    corners: corners.map((c) => ({ id: c.id, at_stake_s: c.zones[z].at_stake_s })),
    billed: z !== "straight",
  });
  return {
    reference_lap: 4,
    laps_used: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    lap_times_s: {},
    median_lap_s: 90,
    second_best_lap_s: 89.6,
    best_lap_s: 89.5,
    actual_gap_s: 0.4,
    theoretical_gap_s: 0.5,
    aspects: { braking: sum("braking"), rotation: sum("rotation"), exit: sum("exit"), straight: sum("straight") },
    lead_in: zone(0),
    corners,
    track_length_known: true,
    envelope_available: true,
    line_available: true,
    thresholds: {} as DrivingAspectsData["thresholds"],
    coach_gates: gates,
    caveat: "",
  };
}

const bare = (da: DrivingAspectsData | null, over: Partial<CoachInputs> = {}): CoachInputs => ({
  drivingAspects: da,
  trailBraking: null,
  inputResponse: null,
  hardware: null,
  reportCard: null,
  balance: null,
  trackWidth: null,
  ...over,
});

const brakeLater = (id: number, at = 0.06) =>
  corner(id, {
    zones: { braking: zone(at), rotation: zone(0.01), exit: zone(0.01), straight: zone(0.01) },
    metrics: { brake_point_m: metric(120, 112, 0.8) },
  });

// ─────────────────────────────────────────────────────────────────────────────

describe("the real fixture sessions", () => {
  it("leads with a braking habit the quick laps showed, worth tenths", () => {
    const r = coach(fromPayload(sessions.healthy));
    expect(r.available).toBe(true);
    expect(r.oneThing.kind).toBe("suggestion");
    if (r.oneThing.kind !== "suggestion") return;
    const s = r.oneThing.suggestion;
    expect(s.aspect).toBe("braking");
    expect(s.atStakeS).toBeGreaterThan(0.1);
    expect(s.evidence).toMatch(/Lap \d+, your quickest entry/);
  });

  it("keeps every title and line of evidence short, and every one quotes a number", () => {
    for (const m of Object.values(sessions)) {
      for (const s of coach(fromPayload(m)).suggestions) {
        expect(words(s.title), s.title).toBeLessThanOrEqual(MAX_TITLE_WORDS);
        expect(words(s.evidence), s.evidence).toBeLessThanOrEqual(MAX_EVIDENCE_WORDS);
        expect(s.evidence, s.evidence).toMatch(/\d/);
      }
    }
  });

  it("bills every zone's time exactly once across the three billed aspects", () => {
    const inp = fromPayload(sessions.healthy);
    const r = coach(inp);
    const billed = r.aspects
      .filter((a) => !a.linked)
      .reduce((s, a) => s + (a.atStakeS ?? 0), 0);
    const da = inp.drivingAspects!;
    const zones = da.aspects.braking.at_stake_s + da.aspects.rotation.at_stake_s + da.aspects.exit.at_stake_s;
    expect(billed).toBeCloseTo(zones, 6);
  });

  it("says the gear is first on the short-pedal session", () => {
    const r = coach(fromPayload(sessions.short_pedal));
    const braking = r.aspects.find((a) => a.key === "braking")!;
    expect(braking.gear.verdict).toBe("gear-first");
    expect(braking.gear.findings[0].detail).toMatch(/82%/);
  });
});

describe("evidence gates every tip", () => {
  it("fires 'brake later' when the quick passes braked later and the link is strong", () => {
    const r = coach(bare(aspects([brakeLater(1)])));
    const s = r.suggestions.find((x) => x.key === "brake.later")!;
    expect(s.title).toBe("Brake later for T1");
    expect(s.evidence).toContain("8.0 m later");
    expect(s.laps).toEqual([4, 7, 9]);
  });

  it("does not fire on a link chance could explain", () => {
    const weak = corner(1, { metrics: { brake_point_m: metric(120, 112, 0.6, 0.4) } });
    expect(coach(bare(aspects([weak]))).suggestions).toHaveLength(0);
  });

  it("does not fire when the zone is not worth it", () => {
    expect(coach(bare(aspects([brakeLater(1, 0.01)]))).suggestions).toHaveLength(0);
  });

  it("takes every gate from the payload", () => {
    const strict = { ...GATES, brake_point_m: 20 };
    expect(coach(bare(aspects([brakeLater(1)], strict))).suggestions).toHaveLength(0);
  });

  it("will not copy a habit that won the zone and lost the corner", () => {
    const c = brakeLater(1);
    c.zones.braking.quick_corner_total_s = 6.3; // slower over the whole corner
    expect(coach(bare(aspects([c]))).suggestions).toHaveLength(0);
  });

  it("groups one habit across corners into one technique", () => {
    const r = coach(bare(aspects([brakeLater(1), brakeLater(4), brakeLater(7)])));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].title).toBe("Brake later for T1, T4 and T7");
    expect(r.suggestions[0].atStakeS).toBeCloseTo(0.18, 6);
    expect(r.oneThing.kind).toBe("suggestion");
  });

  it("needs two corners, or one very strong one, to be the one thing", () => {
    const one = (p: number) =>
      corner(1, {
        zones: { braking: zone(0.2), rotation: zone(0.01), exit: zone(0.01), straight: zone(0.01) },
        metrics: { brake_point_m: metric(120, 112, 0.9, p) },
      });
    // Strong enough to be a tip (one-sided p <= strong_p) but not, alone, the one thing.
    const middling = coach(bare(aspects([one(0.03)])));
    expect(middling.suggestions).toHaveLength(1);
    expect(middling.oneThing.kind).toBe("none");
    // One corner with chance well out of it is enough.
    expect(coach(bare(aspects([one(0.001)]))).oneThing.kind).toBe("suggestion");
  });

  it("states a negative result when nothing stands out", () => {
    const r = coach(bare(aspects([corner(1)])));
    expect(r.oneThing.kind).toBe("none");
    if (r.oneThing.kind === "none") expect(r.oneThing.reason).toContain("0.10 s");
  });
});

describe("gear comes first", () => {
  it("replaces the one thing with the fix when the pedal cannot report the press", () => {
    const capped = {
      brake: {
        measured: true as const,
        braking_ticks: 4000,
        pedal_ceiling_pct: 82,
        applied_ceiling_pct: 82,
        mean_held_back_pct: 0,
        max_held_back_pct: 0,
        ceiling_shape: {
          hard_stops: 40,
          min_peak_pct: 50,
          flat_tolerance_pct: 0.1,
          flat_min_ms: 150,
          gear_rule: { min_stops: 5, at_ceiling_share: 0.5, full_pct: 99.5 },
          at_ceiling: 38,
          flat_at_ceiling: 30,
          flat_with_abs: 0,
          median_peak_pct: 82,
          peak_spread_pct: 0,
        },
      },
      throttle: { measured: false as const, reason: "n/a" },
      steering: { measured: false as const, reason: "n/a" },
      caveat: "",
    };
    const r = coach(bare(aspects([brakeLater(1), brakeLater(4)]), { inputResponse: capped }));
    expect(r.oneThing.kind).toBe("gear");
    if (r.oneThing.kind === "gear") {
      expect(r.oneThing.finding.fix).toMatch(/recalibrate/i);
      expect(r.oneThing.suggestion.key).toBe("brake.later");
    }
  });
});

describe("the line", () => {
  const lined = (dir: "left" | "right", typical: number, quick: number) =>
    corner(3, {
      dir,
      zones: { braking: zone(0), rotation: zone(0), exit: zone(0), straight: zone(0) },
      corner_total: zone(0.08, { typical_s: 6 }),
      metrics: { offset_exit_m: { ...metric(typical, quick, -0.8), zone: "total" } },
    });

  it("calls running further right on a left-hander's exit 'wider'", () => {
    const s = coach(bare(aspects([lined("left", 0.2, -1.0)]))).suggestions[0];
    expect(s.title).toBe("Run 1.2 m wider on the exit of T3");
    expect(s.linked).toBe(true);
    expect(worthLine(s)).toMatch(/^went with/);
  });

  it("calls the same move 'tighter' on a right-hander", () => {
    const s = coach(bare(aspects([lined("right", 0.2, -1.0)]))).suggestions[0];
    expect(s.title).toBe("Run 1.2 m tighter on the exit of T3");
  });
});

describe("copy", () => {
  it("lists corners the way a driver reads them", () => {
    expect(where([4])).toBe("T4");
    expect(where([4, 6])).toBe("T4 and T6");
    expect(where([1, 4, 6])).toBe("T1, T4 and T6");
    expect(where([1, 2, 4, 6, 9])).toBe("T1, T2 and 3 more");
  });

  it("hedges billed time as 'seems to cost up to' and never says 'cost' for linked time", () => {
    const r = coach(fromPayload(sessions.healthy));
    for (const a of r.aspects) {
      const h = aspectHeadline(a, r.gates);
      if (a.linked) expect(h).not.toMatch(/cost/);
      else if ((a.atStakeS ?? 0) >= r.gates!.min_at_stake_s) expect(h).toMatch(/seems to cost up to/);
    }
  });

  it("keeps the general 'why' free of the driver's numbers", () => {
    for (const s of coach(fromPayload(sessions.healthy)).suggestions) {
      if (s.why) expect(s.why.body, s.why.body).not.toMatch(/\d/);
    }
  });

  it("says why when there is no aspect timing, and offers nothing in its place", () => {
    const r = coach(bare(null, { absentReason: "4 clean laps needed" }));
    expect(r.available).toBe(false);
    expect(r.suggestions).toHaveLength(0);
    expect(r.oneThing).toEqual({ kind: "none", reason: "4 clean laps needed" });
    expect(r.aspects.every((a) => a.atStakeS == null)).toBe(true);
  });
});
