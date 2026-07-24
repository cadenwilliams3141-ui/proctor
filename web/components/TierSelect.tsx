"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DEFAULT_TIER, parseTier, TIER_COOKIE, TIERS, type Tier } from "@/lib/tier";

function cookieTier(): Tier {
  if (typeof document === "undefined") return DEFAULT_TIER;
  const hit = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${TIER_COOKIE}=`));
  return parseTier(hit?.split("=")[1]);
}

// Goal-tier toggle: gates how much detail each screen surfaces. Writes a
// cookie (not localStorage) so the server components that render the panels
// can read it, then refreshes so they re-render at the new tier.
export default function TierSelect() {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);

  useEffect(() => {
    setTier(cookieTier());
  }, []);

  const change = (value: string) => {
    const next = parseTier(value);
    setTier(next);
    document.cookie = `${TIER_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <label style={{ color: "var(--muted)", fontSize: 12 }}>
      detail:{" "}
      <select value={tier} onChange={(e) => change(e.target.value)}>
        {TIERS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </label>
  );
}
