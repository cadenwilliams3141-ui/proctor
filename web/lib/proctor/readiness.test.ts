/* "Loading" must mean loading.
 *
 * The four analysis views used to collapse four different conditions into one
 * "Reading the session…". Three of the nine sessions in the database have no
 * clean lap, so for those the message was a promise the screen could not keep:
 * it read as loading and it never resolved, forever.
 *
 * Every test here is one version of the same rule — a settled fact must not be
 * reported as a pending one.
 */

import { describe, expect, it } from "vitest";

import { deriveReadiness, type ReadinessInput } from "./readiness";
import type { Trace } from "@/lib/proctor/types";

const TRACE = { lap_number: 1 } as unknown as Trace;

const base: ReadinessInput = {
  error: null,
  lapCount: 10,
  referenceLap: 3,
  lapA: 3,
  lapB: 7,
  traceA: TRACE,
  traceB: TRACE,
};

describe("a comparison that can be drawn", () => {
  it("is ready when both laps and both traces are present", () => {
    expect(deriveReadiness(base)).toEqual({ state: "ready" });
  });
});

describe("loading means loading, and nothing else does", () => {
  it("is loading only while the bundle is in flight", () => {
    expect(deriveReadiness({ ...base, lapCount: null }).state).toBe("loading");
  });

  it("is loading while the opening lap selection is being seated", () => {
    expect(deriveReadiness({ ...base, lapA: null, lapB: null }).state).toBe("loading");
  });

  it("is NOT loading when the session has arrived and has no clean lap", () => {
    // This is the bug: a settled fact rendered as a pending one.
    const r = deriveReadiness({ ...base, referenceLap: null, lapA: null, lapB: null });
    expect(r.state).not.toBe("loading");
    expect(r.state).toBe("no-reference");
  });
});

describe("no reference lap", () => {
  it("says so, and says what would change it", () => {
    const r = deriveReadiness({ ...base, lapCount: 9, referenceLap: null });
    expect(r.state).toBe("no-reference");
    if (r.state !== "no-reference") throw new Error("unreachable");
    expect(r.reason).toContain("9 laps");
    expect(r.reason).toMatch(/clean lap/i);
  });

  it("distinguishes a session with no laps at all from one with only dirty laps", () => {
    const none = deriveReadiness({ ...base, lapCount: 0, referenceLap: null });
    const dirty = deriveReadiness({ ...base, lapCount: 4, referenceLap: null });
    if (none.state !== "no-reference" || dirty.state !== "no-reference") {
      throw new Error("unreachable");
    }
    expect(none.reason).toMatch(/no completed laps/i);
    expect(dirty.reason).toMatch(/out lap/i);
    expect(none.reason).not.toBe(dirty.reason);
  });

  it("gets the grammar right for a single lap", () => {
    const r = deriveReadiness({ ...base, lapCount: 1, referenceLap: null });
    if (r.state !== "no-reference") throw new Error("unreachable");
    expect(r.reason).toContain("1 lap is");
    expect(r.reason).not.toContain("1 laps");
  });
});

describe("one clean lap", () => {
  it("is a finding, not a self-comparison", () => {
    // Lap A seated, lap B deliberately null: the store no longer falls back to
    // putting the reference lap in both slots, which drew a flat delta and an
    // empty ledger that read as a bug.
    const r = deriveReadiness({ ...base, lapB: null, traceB: null });
    expect(r.state).toBe("no-comparison");
    if (r.state !== "no-comparison") throw new Error("unreachable");
    expect(r.reason).toContain("Lap 3");
    expect(r.reason).toMatch(/nothing to compare/i);
  });
});

describe("missing traces", () => {
  it("names which lap has no trace", () => {
    const r = deriveReadiness({ ...base, traceB: null });
    expect(r.state).toBe("no-traces");
    if (r.state !== "no-traces") throw new Error("unreachable");
    expect(r.reason).toContain("lap 7");
    expect(r.reason).not.toContain("lap 3");
  });

  it("names both when neither was stored", () => {
    const r = deriveReadiness({ ...base, traceA: null, traceB: null });
    if (r.state !== "no-traces") throw new Error("unreachable");
    expect(r.reason).toContain("lap 3");
    expect(r.reason).toContain("lap 7");
  });

  it("does not claim the lap is missing — only its trace", () => {
    const r = deriveReadiness({ ...base, traceA: null });
    if (r.state !== "no-traces") throw new Error("unreachable");
    expect(r.reason).toMatch(/recorded but/i);
  });
});

describe("a load failure", () => {
  it("outranks every other state and keeps the route's own words", () => {
    const r = deriveReadiness({
      ...base,
      error: "session 12: connection refused",
      lapCount: null,
      referenceLap: null,
    });
    expect(r.state).toBe("error");
    if (r.state !== "error") throw new Error("unreachable");
    expect(r.reason).toBe("session 12: connection refused");
  });
});

describe("every non-ready state explains itself", () => {
  it("carries a non-empty reason wherever one is expected", () => {
    const inputs: ReadinessInput[] = [
      { ...base, error: "boom" },
      { ...base, referenceLap: null },
      { ...base, lapCount: 0, referenceLap: null },
      { ...base, lapB: null, traceB: null },
      { ...base, traceA: null },
      { ...base, traceB: null },
    ];
    for (const i of inputs) {
      const r = deriveReadiness(i);
      expect(r.state).not.toBe("ready");
      expect(r.state).not.toBe("loading");
      if (r.state === "ready" || r.state === "loading") throw new Error("unreachable");
      expect(r.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
