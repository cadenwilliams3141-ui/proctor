import { cookies } from "next/headers";

import { parseTier, TIER_COOKIE, type Tier } from "@/lib/tier";

/* Server-side tier read. Separate from lib/tier.ts so the shared pure helpers
   stay importable from client components (next/headers is server-only). */
export async function readTier(): Promise<Tier> {
  const store = await cookies();
  return parseTier(store.get(TIER_COOKIE)?.value);
}
