/* The guided setup: pick a level of detail, then build your rig. Pure logic, no
   telemetry, in the same shape as lib/tier.ts.

   Whether it has been through lives in a cookie for the same reason the tier
   does: the page is rendered on the server, and a flag only the browser can
   read would paint the app first and cover it a moment later. */

export const SETUP_STEPS = ["detail", "rig"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_COOKIE = "proctor-setup";
export const SETUP_DONE = "done";
/** ?setup=1 runs it again, whatever the cookie says. */
export const SETUP_PARAM = "setup";

export function isSetupDone(cookie: string | undefined | null): boolean {
  return cookie === SETUP_DONE;
}

/* Which step a visit opens on, or null for straight into the app.
 *
 *   asked    the address says ?setup=1: run it, even for someone who has been
 *            through it. This is how it is shown to someone again.
 *   linked   the address names a screen or a view. Someone sent this driver to
 *            look at a particular thing, and a setup in front of it would be in
 *            the way for the same reason the launch screen would be.
 *   done     it has been finished, skipped or walked away from before. All
 *            three are an answer, and asking again every visit is nagging. */
export function openingStep({
  done,
  linked,
  asked,
}: {
  done: boolean;
  linked: boolean;
  asked: boolean;
}): SetupStep | null {
  if (asked) return SETUP_STEPS[0];
  if (done || linked) return null;
  return SETUP_STEPS[0];
}

/** "1 of 2", for the step's eyebrow. */
export function stepOf(step: SetupStep): string {
  return `${SETUP_STEPS.indexOf(step) + 1} of ${SETUP_STEPS.length}`;
}
