/* Goal-tier: how much detail each screen surfaces. Pure UI logic, no telemetry.

   The tier lives in a cookie rather than localStorage because several analysis
   screens are server components — localStorage is invisible to them, so a
   client-only store would render the toggle inert. */

export const TIERS = ["glance", "deep", "everything"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_COOKIE = "proctor-tier";
export const DEFAULT_TIER: Tier = "deep";

/* The tiers were renamed casual/intermediate/advanced -> glance/deep/everything
   in the redesign. Cookies already in the wild carry the old words, so they map
   forward rather than silently falling back to the default and changing what a
   returning user sees without being asked. */
const LEGACY: Record<string, Tier> = {
  casual: "glance",
  intermediate: "deep",
  advanced: "everything",
};

export function parseTier(value: string | undefined | null): Tier {
  if (!value) return DEFAULT_TIER;
  if (TIERS.includes(value as Tier)) return value as Tier;
  return LEGACY[value] ?? DEFAULT_TIER;
}

// Gating is monotonic: everything sees all that deep sees, and so on.
export function atLeast(current: Tier, min: Tier): boolean {
  return TIERS.indexOf(current) >= TIERS.indexOf(min);
}

/* Copy for the "you are hiding things" note. Hidden-by-preference is NOT
   missing data, and the two must never look alike — an empty panel would
   otherwise read as "no data", which is exactly the confusion the honesty
   rules exist to prevent. */
export function hiddenNote(tier: Tier, hidden: number): string | null {
  if (tier === "everything" || hidden <= 0) return null;
  return `${hidden} panel${hidden === 1 ? "" : "s"} hidden at "${tier}" detail — the data exists, switch detail above to see it.`;
}

/** One-line description of each tier, for the control's title attribute. */
export const TIER_BLURB: Record<Tier, string> = {
  glance: "The answer and little else — which corners cost time, and how much.",
  deep: "The evidence behind the answer: traces, loads, per-corner detail.",
  everything: "Every panel the session produced, including the quiet ones.",
};
