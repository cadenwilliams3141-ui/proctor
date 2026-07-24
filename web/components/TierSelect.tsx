"use client";

import { useEffect, useState } from "react";

export type Tier = "casual" | "intermediate" | "advanced";

export function useTier(): Tier {
  const [tier, setTier] = useState<Tier>("intermediate");
  useEffect(() => {
    const stored = window.localStorage.getItem("proctor-tier") as Tier | null;
    if (stored) setTier(stored);
    const onChange = () => {
      const t = window.localStorage.getItem("proctor-tier") as Tier | null;
      if (t) setTier(t);
    };
    window.addEventListener("proctor-tier-change", onChange);
    return () => window.removeEventListener("proctor-tier-change", onChange);
  }, []);
  return tier;
}

// Goal-tier toggle: pure UI logic gating how much detail each screen
// surfaces. Stored per user in localStorage (single-user product).
export default function TierSelect() {
  const [tier, setTier] = useState<Tier>("intermediate");
  useEffect(() => {
    const stored = window.localStorage.getItem("proctor-tier") as Tier | null;
    if (stored) setTier(stored);
  }, []);
  const change = (value: string) => {
    setTier(value as Tier);
    window.localStorage.setItem("proctor-tier", value);
    window.dispatchEvent(new Event("proctor-tier-change"));
  };
  return (
    <label style={{ color: "var(--muted)", fontSize: 12 }}>
      detail:{" "}
      <select value={tier} onChange={(e) => change(e.target.value)}>
        <option value="casual">casual</option>
        <option value="intermediate">intermediate</option>
        <option value="advanced">advanced</option>
      </select>
    </label>
  );
}
