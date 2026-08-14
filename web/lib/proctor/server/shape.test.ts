/* The join between the Python modules and the screens.
 *
 * Everything here is one rule stated five ways: a module that did not run must
 * not be able to produce a number. The screens render "—" for an absence and a
 * figure for a measurement, so a zero leaking out of this file is a fabricated
 * reading that looks exactly like a real one.
 */

import { describe, expect, it } from "vitest";

import {
  absencesFrom,
  eventPatternsFrom,
  eventsFrom,
  gripFrom,
  hardwareFrom,
  inputResponseFrom,
  stintFrom,
  trackBoundaryFrom,
  trackEdgesFrom,
  trackWidthFrom,
  tractionFrom,
} from "./shape";

const NOT_RUN = { insufficient_data: true, reason: "no moving ticks in this session" };
const FAILED = { error: "ValueError: boom", note: "module failed on this session" };

describe("a module that did not run produces nothing", () => {
  it.each([
    ["grip", gripFrom],
    ["input_response", inputResponseFrom],
    ["stint", stintFrom],
    ["track_width", trackWidthFrom],
    ["hardware", hardwareFrom],
  ] as const)("%s returns null rather than an empty shape", (key, fn) => {
    expect(fn({ [key]: NOT_RUN })).toBeNull();
    expect(fn({ [key]: FAILED })).toBeNull();
    expect(fn({})).toBeNull();
  });

  it("traction returns empty arrays, which the screens draw as nothing", () => {
    const t = tractionFrom({ traction_circle: NOT_RUN });
    expect(t.scatter).toEqual([]);
    expect(t.envelope).toEqual([]);
    expect(t.laps).toEqual({});
  });

  it("events return an empty list, not a list of zeroed events", () => {
    expect(eventsFrom({ lockup_wheelspin: NOT_RUN })).toEqual([]);
  });
});

describe("traction", () => {
  it("omits a lap the module could not score instead of drawing it at zero", () => {
    // Number(null) is 0, and a 0% bar reads as "you used none of your grip"
    // when the truth is "this lap was not measurable".
    const t = tractionFrom({
      traction_circle: {
        envelope: [{ angle_deg: 5, g: 1.2 }],
        scatter: [],
        laps: { "3": { utilization_pct: null }, "4": { utilization_pct: 71.2 } },
      },
    });
    expect(t.laps).toEqual({ 4: 71.2 });
  });

  it("closes the gaps the parser honestly left null in the envelope", () => {
    // The parser writes null for a bin with too few ticks to speak for. Drawn
    // raw that cuts a notch that reads as a hole in the driver's envelope.
    const envelope = Array.from({ length: 36 }, (_, i) => ({
      angle_deg: i * 10 + 5,
      g: i === 7 ? null : 1.4,
    }));
    const t = tractionFrom({ traction_circle: { envelope, scatter: [], laps: {} } });
    expect(t.envelope).toHaveLength(36);
    expect(t.envelope.every((e) => Number.isFinite(e.g) && e.g > 0)).toBe(true);
  });
});

describe("slip events", () => {
  const payload = {
    lockup_wheelspin: {
      lockups: [
        {
          lap: 4,
          start_pct: 0.31,
          wheels: ["lf"],
          duration_ms: 180,
          peak_slip_ratio: 0.34,
          inputs: { speed_kmh: 188.2, gear: 4, brake_pedal_pct: 96.1 },
        },
      ],
      wheelspin: [],
      counts: { lockup_events: 1, wheelspin_events: 0 },
      common_ground: {
        lockups: { measured: true, events: 1, most_affected_wheel: "lf" },
        wheelspin: { measured: false, reason: "no wheelspin events" },
      },
    },
  };

  it("carries the inputs that were on the car through to the screen", () => {
    const [event] = eventsFrom(payload);
    expect(event.kind).toBe("lockup");
    expect(event.wheels).toEqual(["lf"]);
    expect(event.inputs?.speed_kmh).toBe(188.2);
  });

  it("reads the pattern the module found rather than recomputing it", () => {
    // The stored event list is capped at the 50 most severe, so a summary
    // computed here would describe a truncated set as if it were all of them.
    const p = eventPatternsFrom(payload);
    expect(p.lockup.measured).toBe(true);
    expect(p.lockup.most_affected_wheel).toBe("lf");
    expect(p.wheelspin.measured).toBe(false);
  });

  it("says a session predates the context rather than inventing a pattern", () => {
    const p = eventPatternsFrom({
      lockup_wheelspin: { lockups: [], wheelspin: [], counts: {} },
    });
    expect(p.lockup.measured).toBe(false);
    expect(p.lockup.reason).toMatch(/re-ingest/i);
  });
});

describe("hardware", () => {
  it("passes absent readings through as null, never as zero", () => {
    const h = hardwareFrom({
      hardware: {
        brake_vs_raw: { brake_ceiling_pct: 89.8, stationary_ticks_excluded: 412 },
        abs: { insufficient_data: true, reason: "no moving braking ticks" },
        pedal_noise_floor: { spike_ticks: 69, max_spike: 0.0071, qualifying_ticks: 8812 },
        ffb: { clipping_pct: 0, finding: "no FFB clipping detected" },
        brake_bias: { available: false, reason: "not carried" },
        areas_of_concern: { concerns: [], finding: "nothing to flag" },
      },
    });
    expect(h?.brake_ceiling_pct).toBe(89.8);
    expect(h?.abs.engaged_pct_of_braking).toBeNull();
    expect(h?.abs.reason).toBe("no moving braking ticks");
    expect(h?.pedal_noise.spike_ticks).toBe(69);
    expect(h?.ffb.clipping_pct).toBe(0);
    expect(h?.concerns_finding).toBe("nothing to flag");
  });
});

describe("track width", () => {
  it("refuses a payload with no centreline to hang the band on", () => {
    expect(trackWidthFrom({ track_width: { summary: { measured: true }, left_m: [1, 2] } })).toBeNull();
  });

  it("carries the frame needed to draw any lap inside the band", () => {
    const tw = trackWidthFrom({
      track_width: {
        source_lap: 4,
        laps_used: [4, 5, 6],
        origin: { lat: 33.8, lon: -83.8 },
        centre_x_m: [0, 1, 2],
        centre_y_m: [0, 1, 2],
        normal_x: [1, 1, 1],
        normal_y: [0, 0, 0],
        left_m: [2, 2, 2],
        right_m: [-2, -2, -2],
        median_m: [0, 0, 0],
        p90_m: [1, 1, 1],
        p10_m: [-1, -1, -1],
        used_width_m: [4, 4, 4],
        summary: { measured: true, median_used_width_m: 4 },
        caveat: "not the track's width",
      },
    });
    expect(tw?.origin).toEqual({ lat: 33.8, lon: -83.8 });
    expect(tw?.normal_x).toHaveLength(3);
    expect(tw?.summary.median_used_width_m).toBe(4);
  });
});

describe("track boundary", () => {
  const row = {
    track_name: "Road Atlanta",
    origin_lat: 33.8,
    origin_lon: -83.8,
    centre_x_m: [0, 1, 2, 3],
    centre_y_m: [0, 0, 0, 0],
    normal_x: [0, 0, 0, 0],
    normal_y: [1, 1, 1, 1],
    left_m: [6, null, 5.5, 6.2],
    right_m: [-6, null, -5.5, -6.1],
    sessions_contributed: 3,
    laps_contributed: 41,
    updated_at: "2026-08-02T12:00:00Z",
  };

  it("keeps unmeasured bins as null rather than dropping or zeroing them", () => {
    // This is the whole risk of the shape: nums() filters non-finite values,
    // which would SHORTEN the array and misalign every bin after the gap. A
    // zero would be worse still — it draws the track pinching onto the
    // centreline, which is a claim nothing measured.
    const tb = trackBoundaryFrom(row);
    expect(tb?.left_m).toEqual([6, null, 5.5, 6.2]);
    expect(tb?.right_m).toHaveLength(4);
    expect(tb?.right_m[1]).toBeNull();
  });

  it("carries how much driving the boundary is built from", () => {
    const tb = trackBoundaryFrom(row);
    expect(tb?.sessions_contributed).toBe(3);
    expect(tb?.laps_contributed).toBe(41);
  });

  it("returns null for a track nothing has been measured at", () => {
    expect(trackBoundaryFrom(null)).toBeNull();
    expect(trackBoundaryFrom({ ...row, centre_x_m: [] })).toBeNull();
  });
});

describe("track edges", () => {
  it("passes the module's own reason through when it could not run", () => {
    const te = trackEdgesFrom({
      track_edges: {
        insufficient_data: true,
        reason: "this file does not carry PlayerTrackSurface",
      },
    });
    expect(te?.measured).toBe(false);
    expect(te?.reason).toMatch(/PlayerTrackSurface/);
  });

  it("carries the surface findings when it did", () => {
    const te = trackEdgesFrom({
      track_edges: {
        coverage_pct: 87.5,
        surface: { measured: true, kerb_pct: 3.2, excursion_count: 2 },
        caveat: "a lower bound",
      },
    });
    expect(te?.measured).toBe(true);
    expect(te?.coverage_pct).toBe(87.5);
    expect(te?.surface?.kerb_pct).toBe(3.2);
  });

  it("is null when the module produced no block at all", () => {
    expect(trackEdgesFrom({})).toBeNull();
  });
});

/* The three kinds of absence.
 *
 * Every absence used to render identically, so "the .ibt will never carry
 * this" and "re-ingest this file and it appears" were the same sentence to a
 * reader. They are not the same fact and only one of them is a dead end. */
describe("absences are classified by what would fix them", () => {
  const NO_METRICS = {};

  it("a channel the file format lacks is permanent", () => {
    const a = absencesFrom(NO_METRICS, { wear_masked: false });
    const brake = a.find((x) => x.key === "brake_temp");
    expect(brake?.kind).toBe("permanent");
    expect(brake?.permanent).toBe(true);

    const racecraft = a.find((x) => x.key === "racecraft");
    expect(racecraft?.kind).toBe("permanent");
  });

  it("a module that wrote no block at all is stale, and says a re-ingest fixes it", () => {
    const a = absencesFrom(NO_METRICS, { wear_masked: false });
    const grip = a.find((x) => x.key === "grip");
    expect(grip?.kind).toBe("stale");
    expect(grip?.permanent).toBe(false);
    // The remedy has to be in the sentence: this is the only kind with one.
    expect(grip?.reason).toMatch(/re-ingest/i);
  });

  it("a module that ran and declined to measure is about this run, not the ingest", () => {
    const a = absencesFrom({ grip: NOT_RUN }, { wear_masked: false });
    const grip = a.find((x) => x.key === "grip");
    expect(grip?.kind).toBe("this_run");
    // The module's own words survive verbatim — not replaced by a guess.
    expect(grip?.reason).toBe(NOT_RUN.reason);
  });

  it("a module that threw is reported as a failure, and nothing is fabricated", () => {
    const a = absencesFrom({ stint: FAILED }, { wear_masked: false });
    const stint = a.find((x) => x.key === "stint");
    expect(stint?.kind).toBe("this_run");
    expect(stint?.reason).toContain("ValueError: boom");
    expect(stint?.reason).toMatch(/nothing was fabricated/i);
  });

  it("masked wear is a fact about this run, not a missing channel", () => {
    const a = absencesFrom(NO_METRICS, { wear_masked: true });
    expect(a.find((x) => x.key === "tire_wear")?.kind).toBe("this_run");
  });

  it("every absence carries a kind and a non-empty reason", () => {
    for (const metrics of [NO_METRICS, { grip: NOT_RUN }, { stint: FAILED }]) {
      for (const a of absencesFrom(metrics, { wear_masked: true })) {
        expect(["permanent", "stale", "this_run"]).toContain(a.kind);
        expect(a.reason.trim().length).toBeGreaterThan(0);
        expect(a.title.trim().length).toBeGreaterThan(0);
        // The short form is what tight spots render; an empty one would put a
        // blank line where a reason belongs, which is the bug being fixed.
        expect(a.short.trim().length).toBeGreaterThan(0);
        expect(a.short.length).toBeLessThanOrEqual(a.reason.length);
        // `permanent` and `kind` must never disagree.
        expect(a.permanent).toBe(a.kind === "permanent");
      }
    }
  });

  it("a session that ran everything reports only the permanent walls", () => {
    // Every registered module present and healthy.
    const ok = { basis: "self-comparison within this session" };
    const metrics = Object.fromEntries(
      [
        "corner_sections", "corner_context", "delta_time", "input_overlay",
        "track_map", "traction_circle", "tire_temps", "lockup_wheelspin",
        "shift_analysis", "hardware", "balance", "report_card", "grip",
        "track_edges", "input_response", "stint", "track_width",
      ].map((k) => [k, k === "tire_temps" ? { ...ok, curve: [1, 2] } : ok]),
    );
    const a = absencesFrom(metrics, { wear_masked: false });
    expect(a.every((x) => x.kind === "permanent")).toBe(true);
    expect(a.map((x) => x.key).sort()).toEqual(["brake_temp", "racecraft"]);
  });
});
