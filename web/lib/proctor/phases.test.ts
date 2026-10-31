/* The corner, phase by phase: braking, turn-in, apex, exit.
 *
 * These pin the three things the new corner card leans on: the phase times add
 * up to the corner's own delta (no time invented or lost between phases), the
 * points are found the way a driver would point at them (and a one-frame sensor
 * jump cannot move a braking point), and the copy stays short, specific and
 * free of instructions. */

import { describe, expect, it } from "vitest";

import { buildLedger } from "./ledger";
import { factText, readCorner, readLap, type ReadingInput } from "./phases";
import type { Corner, Trace } from "./types";

const N = 400;
const MPS = 5; // metres per sample: a 2 km lap

/** One corner at sample 200. `shift` moves this lap's brake point (samples). */
function lap(opts: {
  number?: number;
  brakeAt?: number | null;
  apexSpeed?: number;
  throttleAt?: number;
  spikeAt?: number;
  lateralOffset?: number;
} = {}): Trace {
  const brakeAt = opts.brakeAt === undefined ? 160 : opts.brakeAt;
  const apexSpeed = opts.apexSpeed ?? 30;
  const throttleAt = opts.throttleAt ?? 225;
  const speed: number[] = [];
  const throttle: number[] = [];
  const brake: number[] = [];
  const lat: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = (i - 200) / 30;
    speed.push(60 - (60 - apexSpeed) * Math.exp(-x * x));
    const braking = brakeAt != null && i >= brakeAt && i < 196;
    brake.push(braking ? Math.min(0.9, (196 - i) / 12) : 0);
    throttle.push(braking || (i >= 196 && i < throttleAt) ? 0 : 1);
    lat.push(14 * Math.exp(-(((i - 205) / 18) ** 2)));
  }
  if (opts.spikeAt != null) brake[opts.spikeAt] = 0.31;
  // A straight track along +x near a fixed origin; the offset moves the line
  // sideways (to the left of travel when positive).
  const lat_gps: number[] = [];
  const lon_gps: number[] = [];
  for (let i = 0; i < N; i++) {
    lat_gps.push(50 + (opts.lateralOffset ?? 0) / 111320);
    lon_gps.push(0 + (i * MPS) / (111320 * Math.cos((50 * Math.PI) / 180)));
  }
  return {
    lap_number: opts.number ?? 2,
    lap_time_s: speed.reduce((s, v) => s + MPS / v, 0),
    grid_pct: speed.map((_, i) => i / N),
    speed,
    throttle,
    brake,
    brake_raw: brake.slice(),
    steer: lat.map((v) => v / 30),
    gear: speed.map(() => 3),
    rpm: speed.map(() => 6000),
    lat_accel: lat,
    long_accel: speed.map(() => 0),
    lat_gps,
    lon_gps,
    abs_active: null,
  };
}

const corner: Corner = {
  id: 4,
  start_pct: 170 / N,
  apex_pct: 200 / N,
  end_pct: 240 / N,
  radius_m: 80,
  dir: "left",
};

function read(best: Trace, mine: Trace, extra: Partial<ReadingInput> = {}) {
  const ledger = buildLedger([corner], best, mine);
  return {
    ledger,
    reading: readCorner({
      cd: ledger.corners[0],
      best,
      lap: mine,
      prevApex: 200 - N,
      nextApex: 200 + N,
      metresPerSample: MPS,
      ...extra,
    }),
  };
}

const BANNED = /\b(should|try|ideal|might|consider|potentially|suggest|need to|could|better|worse|too)\b/i;

describe("phase times", () => {
  it("add up to the corner's own delta", () => {
    const { ledger, reading } = read(lap({ number: 1 }), lap({ apexSpeed: 27, brakeAt: 168 }));
    const sum = reading.phases.reduce((s, ph) => s + ph.delta, 0);
    expect(sum).toBeCloseTo(ledger.corners[0].delta, 9);
    expect(reading.delta).toBeCloseTo(ledger.corners[0].delta, 9);
  });

  it("are cut at the best lap's own turn-in, apex and throttle", () => {
    const { reading } = read(lap({ number: 1 }), lap());
    expect(reading.fromEvents).toBe(true);
    const [, turnin, apex, exit] = reading.phases;
    expect(turnin.from).toBe(reading.marks.best.turnIn);
    expect(apex.from).toBe(reading.marks.best.apex);
    expect(exit.from).toBe(reading.marks.best.throttle);
  });

  it("names the phase that cost the most", () => {
    const { reading } = read(lap({ number: 1 }), lap({ apexSpeed: 24 }));
    expect(reading.worst).not.toBeNull();
    const worst = reading.phases.find((ph) => ph.id === reading.worst)!;
    expect(worst.delta).toBe(Math.max(...reading.phases.map((ph) => ph.delta)));
  });

  it("falls back to equal quarters, and says why, when the best lap never got back to full throttle", () => {
    const { reading } = read(lap({ number: 1, throttleAt: 500 }), lap());
    expect(reading.fromEvents).toBe(false);
    expect(reading.fallback).toBe("no-throttle");
    const sum = reading.phases.reduce((s, ph) => s + ph.delta, 0);
    expect(sum).toBeCloseTo(reading.delta, 12);
  });

  it("names none when the laps matched", () => {
    const { reading } = read(lap({ number: 1 }), lap());
    expect(reading.worst).toBeNull();
  });
});

describe("the points", () => {
  it("measures the braking point in metres along the lap", () => {
    const { reading } = read(lap({ number: 1, brakeAt: 160 }), lap({ brakeAt: 168 }));
    expect(factText(reading.phases[0].facts[0])).toBe(`Braked ${8 * MPS} m later`);
  });

  it("calls two points a sample apart the same point, not 0 m", () => {
    const { reading } = read(lap({ number: 1, brakeAt: 160 }), lap({ brakeAt: 161 }));
    expect(factText(reading.phases[0].facts[0])).toBe("Braked at the same point");
  });

  it("is not moved by a one-frame jump of the brake sensor", () => {
    const clean = read(lap({ number: 1 }), lap());
    const spiked = read(lap({ number: 1 }), lap({ spikeAt: 120 }));
    expect(spiked.reading.marks.lap.brake).toBe(clean.reading.marks.lap.brake);
  });

  it("says so when neither lap braked, and calls the phase Entry", () => {
    const { reading } = read(lap({ number: 1, brakeAt: null }), lap({ brakeAt: null }));
    expect(reading.phases[0].label).toBe("Entry");
    expect(factText(reading.phases[0].facts[0])).toBe("Neither lap braked here");
  });

  it("says which lap braked when only one did", () => {
    const { reading } = read(lap({ number: 1, brakeAt: null }), lap({ brakeAt: 160 }));
    expect(reading.phases[0].label).toBe("Braking");
    expect(factText(reading.phases[0].facts[0])).toBe("This lap braked; your best did not");
  });

  it("reports the slowest point in km/h against the best lap", () => {
    const { reading } = read(lap({ number: 1, apexSpeed: 30 }), lap({ apexSpeed: 27 }));
    expect(factText(reading.phases[2].facts[0])).toBe("Slowest point 11 km/h slower");
  });
});

describe("the line at the apex", () => {
  const centre = (() => {
    const t = lap();
    const cos = Math.cos((50 * Math.PI) / 180);
    return {
      x: t.lon_gps.map((lon) => lon * 111320 * cos),
      y: t.lat_gps.map(() => 0),
      normalX: t.lat_gps.map(() => 0),
      normalY: t.lat_gps.map(() => 1), // left of travel along +x
      origin: { lat: 50, lon: 0 },
    };
  })();

  it("is tighter when this lap sat further inside a left-hander", () => {
    const { reading } = read(lap({ number: 1 }), lap({ lateralOffset: 2 }), { centre });
    const text = reading.phases[2].facts.map(factText);
    expect(text).toContain("Line at the apex 2.0 m tighter");
  });

  it("is wider the other way", () => {
    const { reading } = read(lap({ number: 1 }), lap({ lateralOffset: -1.5 }), { centre });
    expect(reading.phases[2].facts.map(factText)).toContain("Line at the apex 1.5 m wider");
  });

  it("does not claim a difference the file's rounding could make", () => {
    const { reading } = read(lap({ number: 1 }), lap({ lateralOffset: 0.3 }), { centre });
    expect(reading.phases[2].facts.map(factText)).toContain("Line at the apex matched your best");
  });
});

describe("the copy", () => {
  const cases = [
    read(lap({ number: 1 }), lap({ apexSpeed: 24, brakeAt: 170, throttleAt: 240 })),
    read(lap({ number: 1, brakeAt: null }), lap({ brakeAt: null })),
    read(lap({ number: 1, brakeAt: null }), lap()),
    read(lap({ number: 1, throttleAt: 500 }), lap()),
  ];
  const all = cases.flatMap(({ reading }) => reading.phases.flatMap((ph) => ph.facts.map(factText)));

  it("is short enough to read at a glance", () => {
    for (const s of all) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(10);
  });

  it("describes and never prescribes", () => {
    for (const s of all) expect(s, s).not.toMatch(BANNED);
  });

  it("never leaves a phase with nothing to say", () => {
    for (const { reading } of cases) for (const ph of reading.phases) expect(ph.facts.length).toBeGreaterThan(0);
  });

  it("bolds a number or a short claim in every fact", () => {
    for (const { reading } of cases)
      for (const ph of reading.phases) for (const f of ph.facts) expect(f.some((s) => s.strong)).toBe(true);
  });
});

describe("a whole lap", () => {
  it("reads every corner and keeps each one's own delta", () => {
    const best = lap({ number: 1 });
    const mine = lap({ apexSpeed: 26 });
    const ledger = buildLedger([corner], best, mine);
    const readings = readLap(ledger.corners, best, mine, { metresPerSample: MPS });
    expect(readings).toHaveLength(1);
    expect(readings[0].delta).toBeCloseTo(ledger.corners[0].delta, 9);
  });
});
