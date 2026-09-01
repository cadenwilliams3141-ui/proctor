/* The technique layer's rules are the product identity, so they are tested
 * rather than trusted to review: a note may only exist where a measurement
 * resolved, and it may never quote the driver's own numbers. */

import { describe, expect, it } from "vitest";

import {
  LABEL,
  techniqueForGrade,
  techniqueForInputResponse,
  techniqueForLap,
  techniqueForSlip,
  techniqueForSteerTorque,
} from "./technique";
import type { ContactPatchData, CornerLedger, InputResponseData } from "./types";

const emptyCp = (over: Partial<ContactPatchData> = {}): ContactPatchData => ({
  slip: { measured: false },
  rotation: { measured: false },
  steerTorque: { measured: false, bands: [] },
  grade: { measured: false, braking: { measured: false } },
  corners: { measured: false, corners: [] },
  perTireLoad: { available: false, reason: "needs car geometry" },
  ...over,
});

describe("technique notes require a measured finding", () => {
  it("says nothing at all when nothing was measured", () => {
    const cp = emptyCp();
    expect(techniqueForSteerTorque(cp)).toEqual([]);
    expect(techniqueForSlip(cp)).toEqual([]);
    expect(techniqueForGrade(cp)).toEqual([]);
    expect(techniqueForLap(null)).toEqual([]);
    expect(techniqueForInputResponse(null)).toEqual([]);
  });

  it("says nothing on a null bundle", () => {
    expect(techniqueForSteerTorque(null)).toEqual([]);
    expect(techniqueForSlip(null)).toEqual([]);
    expect(techniqueForGrade(null)).toEqual([]);
  });

  it("stays silent on a measured block that found no falloff", () => {
    const cp = emptyCp({
      steerTorque: {
        measured: true,
        bands: [],
        most_torque_band: "150°+",
        falloff_past_peak_nm: null,
      },
    });
    expect(techniqueForSteerTorque(cp)).toEqual([]);
  });

  it("speaks once the falloff is real", () => {
    const cp = emptyCp({
      steerTorque: {
        measured: true,
        bands: [],
        most_torque_band: "45-75°",
        falloff_past_peak_nm: 3.2,
      },
    });
    const notes = techniqueForSteerTorque(cp);
    expect(notes).toHaveLength(1);
    expect(notes[0].because).toContain("45-75°");
    expect(notes[0].body.length).toBeGreaterThan(40);
  });
});

describe("technique notes never quote the driver's numbers", () => {
  const allNotes = () => {
    const cp = emptyCp({
      slip: { measured: true, peak_deg: 7.3, median_deg: 2.4 },
      steerTorque: {
        measured: true,
        bands: [],
        most_torque_band: "45-75°",
        falloff_past_peak_nm: 3.2,
      },
      grade: {
        measured: true,
        steepest_climb_pct: 6.1,
        braking: {
          measured: true,
          peak_decel_g_uncorrected: 1.44,
          peak_decel_g_grade_corrected: 1.31,
          difference_g: -0.13,
        },
      },
      corners: {
        measured: true,
        corners: [],
        most_slip: { id: 4, peak_slip_deg: 7.3 },
        least_slip: { id: 9, peak_slip_deg: 1.9 },
      },
    });
    const ir = {
      brake: {
        measured: true,
        abs: { engaged_pct_of_braking: 18.4, activation_events: 12 },
      },
      throttle: { measured: true, slip: { share_of_on_power_pct: 4.2, peak_excess_pct: 31 } },
      steering: { measured: true, falloff_past_peak_g: 0.21, bands: [] },
      wheel: { measured: true, clipping_pct_of_moving: 0 },
    } as unknown as InputResponseData;

    return [
      ...techniqueForSteerTorque(cp),
      ...techniqueForSlip(cp),
      ...techniqueForGrade(cp),
      ...techniqueForInputResponse(ir),
    ];
  };

  it("produces notes for every measured finding", () => {
    expect(allNotes().length).toBeGreaterThanOrEqual(6);
  });

  it("puts no measured value in any note body", () => {
    // The measurement beside the note supplies the size. A note that carried a
    // number would read as a finding, which is exactly the line this file
    // exists to hold. Turn numbers are allowed in `because`, never in `body`.
    for (const note of allNotes()) {
      expect(note.body).not.toMatch(/\d/);
    }
  });

  it("names the finding it hangs off, so the pairing is traceable", () => {
    for (const note of allNotes()) {
      expect(note.because.trim().length).toBeGreaterThan(0);
      expect(note.because).not.toMatch(/^[A-Z]/); // reads as "Shown because ..."
    }
  });
});

describe("the lap note follows the corner it is about", () => {
  const ledger = (dominant: number): CornerLedger =>
    ({
      lapDelta: 0.4,
      remainder: 0,
      corners: [
        {
          corner: { id: 3, apex_pct: 0.4 },
          delta: 0.31,
          dominant,
          sections: [0, 0, 0, 0],
          minSpeedA: 30,
          minSpeedB: 28,
        },
      ],
    }) as unknown as CornerLedger;

  it("reads an entry-half loss differently from an exit-half one", () => {
    const entry = techniqueForLap(ledger(0))[0].body;
    const exit = techniqueForLap(ledger(3))[0].body;
    expect(entry).not.toEqual(exit);
    expect(entry).toContain("entry");
    expect(exit).toContain("apex");
  });

  it("stays silent when no corner lost time", () => {
    const flat = { lapDelta: 0, remainder: 0, corners: [] } as unknown as CornerLedger;
    expect(techniqueForLap(flat)).toEqual([]);
  });
});

describe("the label", () => {
  it("says both what it is and what it is not", () => {
    expect(LABEL).toContain("not a reading of your file");
    expect(LABEL).toContain("cannot see why");
  });
});
