/* The join between the Python modules and the screens.
 *
 * Everything here is one rule stated five ways: a module that did not run must
 * not be able to produce a number. The screens render "—" for an absence and a
 * figure for a measurement, so a zero leaking out of this file is a fabricated
 * reading that looks exactly like a real one.
 */

import { describe, expect, it } from "vitest";

import {
  contactPatchFrom,
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

  it("leaves a short boundary alone — too few neighbours to call anything wrong", () => {
    // The 4-bin row above has nothing like a neighbourhood. Throwing a bin away
    // on that evidence would be guessing, so nothing is thrown away.
    expect(trackBoundaryFrom(row)?.discarded_bins).toBe(0);
  });
});

describe("an edge that leaps off the road", () => {
  /* The stored boundary only ever widens, so one bad sample is permanent: it
     draws as a wedge fanning out of the circuit, and because the view fits its
     frame to the outermost geometry it shrinks the real track to make room. */
  const N = 400;
  const circuit = (over: Record<number, number> = {}) => ({
    track_name: "Long Beach",
    origin_lat: 33.76,
    origin_lon: -118.19,
    centre_x_m: Array.from({ length: N }, (_, i) => i * 8),
    centre_y_m: Array(N).fill(0),
    normal_x: Array(N).fill(0),
    normal_y: Array(N).fill(1),
    left_m: Array.from({ length: N }, (_, i) => over[i] ?? 6),
    right_m: Array.from({ length: N }, (_, i) => -(over[-i - 1] ?? 6)),
    sessions_contributed: 5,
    laps_contributed: 80,
    updated_at: "2026-08-14T12:00:00Z",
  });

  it("discards a bin whose edge reaches far past the road either side of it", () => {
    const tb = trackBoundaryFrom(circuit({ 120: 52, 121: 47 }));
    expect(tb?.left_m[120]).toBeNull();
    expect(tb?.left_m[121]).toBeNull();
    expect(tb?.discarded_bins).toBe(2);
    // …and leaves the road it was sitting on untouched.
    expect(tb?.left_m[119]).toBe(6);
    expect(tb?.left_m[122]).toBe(6);
  });

  it("discards outward on the right edge too, where outward means negative", () => {
    const tb = trackBoundaryFrom({
      ...circuit(),
      right_m: Array.from({ length: N }, (_, i) => (i === 200 ? -48 : -6)),
    });
    expect(tb?.right_m[200]).toBeNull();
    expect(tb?.discarded_bins).toBe(1);
  });

  it("keeps a bin that reads NARROW — a lower bound is allowed to be low", () => {
    // Nothing but a middle-of-road sample ever landed here. That is this
    // measurement doing exactly what it says on the tin, not an artifact, and
    // discarding it would throw away a real reading to tidy the picture.
    const tb = trackBoundaryFrom(circuit({ 300: 0.5 }));
    expect(tb?.left_m[300]).toBe(0.5);
    expect(tb?.discarded_bins).toBe(0);
  });

  it("keeps a widening that the road actually does — a runoff, not a glitch", () => {
    // 60 bins of genuinely wider road: the local median moves with it, so the
    // neighbourhood agrees and none of it is discarded.
    const wide: Record<number, number> = {};
    for (let i = 150; i < 210; i++) wide[i] = 14;
    const tb = trackBoundaryFrom(circuit(wide));
    expect(tb?.discarded_bins).toBe(0);
    expect(tb?.left_m[180]).toBe(14);
  });

  it("wraps the window across the start/finish line", () => {
    // Bin 0's neighbours run backwards into the end of the lap. Without the
    // wrap it would be judged against half a window and survive.
    const tb = trackBoundaryFrom(circuit({ 0: 50 }));
    expect(tb?.left_m[0]).toBeNull();
  });

  it("does not invent edges where the survey has none", () => {
    const holed = circuit();
    holed.left_m = holed.left_m.map((v, i) => (i > 40 && i < 380 ? v : null)) as number[];
    const tb = trackBoundaryFrom(holed);
    expect(tb?.left_m[10]).toBeNull();
    expect(tb?.left_m[100]).toBe(6);
    expect(tb?.left_m).toHaveLength(N);
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
        "contact_patch",
      ].map((k) => [k, k === "tire_temps" ? { ...ok, curve: [1, 2] } : ok]),
    );
    const a = absencesFrom(metrics, { wear_masked: false });
    expect(a.every((x) => x.kind === "permanent")).toBe(true);
    expect(a.map((x) => x.key).sort()).toEqual(["brake_temp", "racecraft"]);
  });
});

describe("contactPatchFrom", () => {
  const full = {
    contact_patch: {
      basis: "b",
      slip: { measured: true, peak_deg: 3.4, median_deg: 1.1, ticks: 900 },
      rotation: { measured: true, path_agreement: 0.98, rotated_more_than_path_pct: 12.5 },
      steer_torque: {
        measured: true,
        bands: [
          { band: "0-20°", ticks: 500, measured: true, median_torque_nm: 9.5 },
          { band: "20-45°", ticks: 3, measured: false, reason: "only 3 ticks at this much lock" },
        ],
        most_torque_band: "0-20°",
        falloff_past_peak_nm: 2.5,
      },
      grade: {
        measured: true,
        steepest_climb_pct: 4.2,
        braking: {
          measured: true,
          peak_decel_g_uncorrected: 1.4,
          peak_decel_g_grade_corrected: 1.32,
          difference_g: -0.08,
        },
      },
      corners: {
        measured: true,
        reference_lap: 4,
        corners: [
          { id: 1, start_pct: 0.1, apex_pct: 0.15, end_pct: 0.2, measured: true, ticks: 300, peak_slip_deg: 5.1, dir: "left", radius_m: 90 },
          { id: 2, start_pct: 0.4, apex_pct: 0.45, end_pct: 0.5, measured: false, reason: "only 4 ticks", ticks: 4 },
        ],
        most_slip: { id: 1, peak_slip_deg: 5.1 },
      },
      per_tire_load: { available: false, reason: "needs wheelbase and track width" },
    },
  };

  it("carries slip, torque, grade and corners through", () => {
    const cp = contactPatchFrom(full)!;
    expect(cp.slip.peak_deg).toBe(3.4);
    expect(cp.rotation.path_agreement).toBe(0.98);
    expect(cp.steerTorque.falloff_past_peak_nm).toBe(2.5);
    expect(cp.grade.braking.peak_decel_g_grade_corrected).toBe(1.32);
    expect(cp.corners.corners).toHaveLength(2);
    expect(cp.corners.most_slip).toEqual({ id: 1, peak_slip_deg: 5.1 });
  });

  it("keeps an unmeasured band's reason and gives it no number", () => {
    const band = contactPatchFrom(full)!.steerTorque.bands[1];
    expect(band.measured).toBe(false);
    expect(band.reason).toContain("only 3 ticks");
    expect(band.median_torque_nm).toBeNull();
  });

  it("keeps an unmeasured corner's reason rather than dropping the corner", () => {
    const corner = contactPatchFrom(full)!.corners.corners[1];
    expect(corner.measured).toBe(false);
    expect(corner.reason).toBe("only 4 ticks");
    expect(corner.peak_slip_deg).toBeNull();
  });

  it("always reports the per-tire-load wall, never a number", () => {
    const wall = contactPatchFrom(full)!.perTireLoad;
    expect(wall.available).toBe(false);
    expect(wall.reason).toContain("wheelbase");
  });

  it("carries the wall even when the module itself measured nothing", () => {
    const cp = contactPatchFrom({
      contact_patch: { basis: "b", slip: { measured: false, reason: "too slow" } },
    })!;
    expect(cp.slip.measured).toBe(false);
    expect(cp.slip.reason).toBe("too slow");
    expect(cp.perTireLoad.available).toBe(false);
    expect(cp.perTireLoad.reason.length).toBeGreaterThan(0);
  });

  it("is null when the module never ran", () => {
    expect(contactPatchFrom({})).toBeNull();
    expect(contactPatchFrom({ contact_patch: { insufficient_data: true } })).toBeNull();
  });
});
