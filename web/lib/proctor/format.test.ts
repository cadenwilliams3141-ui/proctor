/* fmtAgo got the unit table off by one on its first outing: each divisor was
 * paired with the unit it came FROM rather than the unit it produced, so every
 * answer was one step too small and a file from twenty minutes ago reported as
 * "just now". It was caught by rendering it, not by reading it — hence these. */

import { describe, expect, it, vi, afterEach } from "vitest";

import { fmtAgo } from "./format";

const NOW = Date.parse("2026-08-14T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function at(now: number) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
}
afterEach(() => vi.useRealTimers());

describe("fmtAgo", () => {
  it("names each unit correctly rather than one step down", () => {
    at(NOW);
    expect(fmtAgo(ago(20 * MIN))).toBe("20 minutes ago");
    expect(fmtAgo(ago(3 * HOUR))).toBe("3 hours ago");
    expect(fmtAgo(ago(2 * DAY))).toBe("2 days ago");
    expect(fmtAgo(ago(3 * 7 * DAY))).toBe("3 weeks ago");
  });

  it("only says 'just now' for something actually recent", () => {
    at(NOW);
    expect(fmtAgo(ago(5 * S))).toBe("just now");
    expect(fmtAgo(ago(20 * MIN))).not.toBe("just now");
    expect(fmtAgo(ago(30 * DAY))).not.toBe("just now");
  });

  it("singularises one of a unit", () => {
    at(NOW);
    expect(fmtAgo(ago(1 * MIN))).toBe("1 minute ago");
    expect(fmtAgo(ago(1 * HOUR))).toBe("1 hour ago");
    expect(fmtAgo(ago(1 * DAY))).toBe("1 day ago");
  });

  it("returns null rather than a plausible-looking string for no timestamp", () => {
    at(NOW);
    expect(fmtAgo(null)).toBeNull();
    expect(fmtAgo(undefined)).toBeNull();
    expect(fmtAgo("not a date")).toBeNull();
  });

  it("does not go negative on a clock skewed into the future", () => {
    at(NOW);
    expect(fmtAgo(new Date(NOW + 5 * MIN).toISOString())).toBe("just now");
  });
});
