/* Focus memory: pin on one session, read the next against it.
 *
 * The two fixture sessions in __fixtures__/coach-sessions.json are the same
 * circuit driven twice (healthy, then on a short-calibrated pedal), which is
 * exactly the case focus memory exists for. */

import { describe, expect, it } from "vitest";

import data from "./__fixtures__/coach-sessions.json";
import { coach } from "./coach";
import {
  FOCUS_APEX_TOLERANCE,
  focusBaseline,
  focusProgress,
  matchCorner,
  parseFocusRequest,
  progressLine,
  type DriverFocus,
} from "./focus";
import {
  balanceFrom,
  drivingAspectsFrom,
  hardwareFrom,
  inputResponseFrom,
  reportCardFrom,
  trailBrakingFrom,
} from "./server/shape";
import type { DrivingAspectsData, MetricPayloads } from "./types";

const sessions = data as unknown as Record<"healthy" | "short_pedal", MetricPayloads>;

function readOf(m: MetricPayloads) {
  const da = drivingAspectsFrom(m)!;
  const tb = trailBrakingFrom(m);
  const r = coach({
    drivingAspects: da,
    trailBraking: tb,
    inputResponse: inputResponseFrom(m),
    hardware: hardwareFrom(m),
    reportCard: reportCardFrom(m),
    balance: balanceFrom(m),
    trackWidth: null,
  });
  return { da, tb, r };
}

function pinnedFrom(sessionId: number): DriverFocus {
  const { da, tb, r } = readOf(sessions.healthy);
  if (r.oneThing.kind !== "suggestion") throw new Error("fixture lost its one thing");
  const s = r.oneThing.suggestion;
  return {
    id: 1,
    car_name: "Test Car GT3",
    track_name: "Testland",
    aspect: s.aspect,
    rule_key: s.key,
    title: s.title,
    baseline_session_id: sessionId,
    baseline: focusBaseline(s, da, tb, "2026-08-30T19:04:11Z"),
    created_at: "2026-08-30T20:00:00Z",
  };
}

describe("the baseline", () => {
  it("keeps, per corner, where it is, the claimed stretch's time and the habit", () => {
    const f = pinnedFrom(1);
    expect(f.rule_key).toBe("trail.carry");
    expect(f.baseline.zone).toBe("rotation");
    expect(f.baseline.corners.length).toBeGreaterThan(1);
    for (const c of f.baseline.corners) {
      expect(c.apex_pct).toBeGreaterThan(0);
      expect(c.zone_typical_s).not.toBeNull();
      expect(c.habit_typical).not.toBeNull();
      expect(c.habit_quick).not.toBeNull();
    }
  });
});

describe("this session against it", () => {
  it("says a focus pinned from this very session is not yet a comparison", () => {
    const { da, tb } = readOf(sessions.healthy);
    const p = focusProgress(pinnedFrom(1), 1, da, tb);
    expect(p.state).toBe("same-session");
    expect(progressLine(pinnedFrom(1), p)).toMatch(/next session/);
  });

  it("reads a later session at the same circuit, corner by corner, in the driver's numbers", () => {
    const f = pinnedFrom(1);
    const { da, tb } = readOf(sessions.short_pedal);
    const p = focusProgress(f, 4, da, tb);
    expect(["quicker", "slower", "held"]).toContain(p.state);
    expect(p.matched.length).toBe(f.baseline.corners.length);
    expect(p.unmatched).toHaveLength(0);
    expect(p.habitThen).not.toBeNull();
    expect(p.habitNow).not.toBeNull();
    const line = progressLine(f, p);
    expect(line).toMatch(/turn-in to apex/);
    expect(line).toMatch(/Brake held past turn-in: \d/);
  });

  it("calls a change smaller than the payload's own min_at_stake_s 'held'", () => {
    const f = pinnedFrom(1);
    const { da, tb } = readOf(sessions.healthy);
    // Same numbers, read as if from a different session.
    const p = focusProgress(f, 99, da, tb);
    expect(p.state).toBe("held");
    expect(p.zoneDeltaS).toBeCloseTo(0, 9);
    expect(p.habitMoved).toBe("same");
  });

  it("can't compare when none of the corners is where it was, and says why", () => {
    const f = pinnedFrom(1);
    const { da, tb } = readOf(sessions.short_pedal);
    const moved: DrivingAspectsData = {
      ...da,
      corners: da.corners.map((c) => ({ ...c, apex_pct: (c.apex_pct + 0.04) % 1 })),
    };
    const p = focusProgress(f, 4, moved, tb);
    expect(p.state).toBe("cant-compare");
    expect(p.reason).toMatch(/was found where it was last time/);
  });

  it("can't compare against a session without aspect timing", () => {
    expect(focusProgress(pinnedFrom(1), 4, null, null).state).toBe("cant-compare");
  });
});

describe("matching corners by place", () => {
  it("matches across the start line and refuses anything further than the tolerance", () => {
    const { da } = readOf(sessions.healthy);
    const c = da.corners[0];
    expect(matchCorner(c.apex_pct, da)).toBe(c.id);
    expect(matchCorner(c.apex_pct + FOCUS_APEX_TOLERANCE / 2, da)).toBe(c.id);
    const wrapped: DrivingAspectsData = { ...da, corners: [{ ...c, apex_pct: 0.995 }] };
    expect(matchCorner(0.002, wrapped)).toBe(c.id);
    expect(matchCorner(0.5, wrapped)).toBeNull();
  });
});

describe("the request the route accepts", () => {
  it("takes a session number, a pinnable rule and corner numbers — nothing else", () => {
    expect(parseFocusRequest({ sessionId: 4, key: "brake.later", corners: [6, 2] })).toEqual({
      sessionId: "4",
      key: "brake.later",
      corners: [2, 6],
    });
  });

  it.each([
    [null, "JSON object"],
    [{ sessionId: "4; drop table", key: "brake.later", corners: [1] }, "session number"],
    [{ sessionId: 4, key: "drift.improving", corners: [1] }, "pinned"],
    [{ sessionId: 4, key: "brake.sooner", corners: [1] }, "pinned"],
    [{ sessionId: 4, key: "brake.later", corners: [] }, "corners"],
    [{ sessionId: 4, key: "brake.later", corners: [1.5] }, "corner numbers"],
    [{ sessionId: 4, key: "brake.later", corners: Array.from({ length: 41 }, (_, i) => i + 1) }, "corners"],
  ])("refuses %j", (body, why) => {
    const r = parseFocusRequest(body);
    expect("error" in r && r.error).toContain(why);
  });
});
