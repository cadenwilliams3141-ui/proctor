/* Goal-tier: how much detail each screen surfaces. Pure UI logic, no telemetry.

   The tier lives in a cookie rather than localStorage because every analysis
   screen is a server component — localStorage is invisible to them, so a
   client-only store would render the toggle inert. */

export const TIERS = ["casual", "intermediate", "advanced"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_COOKIE = "proctor-tier";
export const DEFAULT_TIER: Tier = "intermediate";

export function parseTier(value: string | undefined | null): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : DEFAULT_TIER;
}

// Gating is monotonic: advanced sees everything intermediate sees, and so on.
export function atLeast(current: Tier, min: Tier): boolean {
  return TIERS.indexOf(current) >= TIERS.indexOf(min);
}

/* Copy for the "you are hiding things" note. Hidden-by-preference is NOT
   missing data, and the two must never look alike — an empty panel would
   otherwise read as "no data", which is exactly the confusion the honesty
   rules exist to prevent. */
export function hiddenNote(tier: Tier, hidden: number): string | null {
  if (tier === "advanced" || hidden <= 0) return null;
  return `${hidden} panel${hidden === 1 ? "" : "s"} hidden at "${tier}" detail — the data exists, switch detail above to see it.`;
}
