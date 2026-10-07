import { describe, expect, it } from "vitest";

import { SETUP_DONE, SETUP_STEPS, isSetupDone, openingStep, stepOf } from "@/lib/setup";

describe("openingStep", () => {
  const first = SETUP_STEPS[0];

  it("opens a plain first visit on the setup", () => {
    expect(openingStep({ done: false, linked: false, asked: false })).toBe(first);
  });

  it("goes straight into the app once the setup has been through", () => {
    expect(openingStep({ done: true, linked: false, asked: false })).toBeNull();
  });

  it("does not stand in front of a link to a particular screen", () => {
    expect(openingStep({ done: false, linked: true, asked: false })).toBeNull();
  });

  it("runs again when asked, whatever else is true", () => {
    expect(openingStep({ done: true, linked: false, asked: true })).toBe(first);
    expect(openingStep({ done: true, linked: true, asked: true })).toBe(first);
    expect(openingStep({ done: false, linked: true, asked: true })).toBe(first);
  });
});

describe("isSetupDone", () => {
  it("is done only when the cookie says so", () => {
    expect(isSetupDone(SETUP_DONE)).toBe(true);
    expect(isSetupDone(undefined)).toBe(false);
    expect(isSetupDone(null)).toBe(false);
    expect(isSetupDone("")).toBe(false);
    expect(isSetupDone("1")).toBe(false);
  });
});

describe("stepOf", () => {
  it("counts the steps from one, in order", () => {
    expect(SETUP_STEPS.map(stepOf)).toEqual(SETUP_STEPS.map((_, i) => `${i + 1} of ${SETUP_STEPS.length}`));
  });

  it("asks for the detail level before the rig", () => {
    expect(SETUP_STEPS).toEqual(["detail", "rig"]);
  });
});
