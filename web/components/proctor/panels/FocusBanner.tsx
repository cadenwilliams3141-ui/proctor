"use client";

/* The focus the driver pinned, and how this session reads against it.
 *
 * Shown above the one thing, because "did last time's work stick?" is the
 * question a driver opens a new session with. The reading is in their own
 * numbers (lib/proctor/focus.ts) and carries its caveat: a different day moves
 * these figures as much as a habit can. */

import { Target, X } from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import { CH, dim } from "@/lib/proctor/channels";
import { FOCUS_CAVEAT, progressLine, type FocusState } from "@/lib/proctor/focus";
import { fmtDay } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";

const TONE: Record<FocusState, string> = {
  quicker: CH.gain,
  slower: CH.loss,
  held: "rgba(232,234,246,.6)",
  "same-session": CH.a,
  "cant-compare": "rgba(232,234,246,.5)",
};

const WORD: Record<FocusState, string> = {
  quicker: "moved",
  slower: "went the other way",
  held: "held",
  "same-session": "pinned here",
  "cant-compare": "can't compare",
};

export default function FocusBanner({ compact = false }: { compact?: boolean }) {
  const { focus, focusProgress: p, focusError, clearFocus } = useProctor();

  if (focusError) {
    return (
      <div style={{ marginBottom: "var(--space-4)", fontSize: 11.5, color: dim(60) }}>
        Your focus could not be read or saved: <span style={{ color: CH.loss }}>{focusError}</span>
      </div>
    );
  }
  if (!focus || !p) return null;
  const tone = TONE[p.state];

  return (
    <section
      aria-label="Your focus"
      style={{
        marginBottom: "var(--space-4)",
        padding: compact ? "var(--space-3) var(--space-4)" : "var(--space-4) var(--space-5)",
        borderRadius: "var(--radius-md)",
        background: `color-mix(in srgb, ${tone} 6%, var(--color-surface))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 22%, transparent)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Target size={14} strokeWidth={1.7} color={tone} aria-hidden />
        <Eyebrow color={tone}>
          Your focus{focus.baseline.recorded_at ? ` · since ${fmtDay(focus.baseline.recorded_at)}` : ""} · {WORD[p.state]}
        </Eyebrow>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pk"
          onClick={clearFocus}
          title="Clear this focus"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", color: dim(50), fontSize: 11, cursor: "pointer" }}
        >
          <X size={12} strokeWidth={1.8} aria-hidden /> clear
        </button>
      </div>
      <div style={{ marginTop: 6, font: `500 ${compact ? 14 : 15}px/1.35 var(--font-heading)` }}>{focus.title}</div>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.6, color: dim(72), maxWidth: 720 }}>
        {progressLine(focus, p)}
      </p>
      {p.unmatched.length > 0 && p.state !== "cant-compare" && (
        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: dim(52) }}>
          Not found this session: {p.unmatched.map((c) => `T${c.id}`).join(", ")} (last time&apos;s numbering).
        </p>
      )}
      {p.state !== "same-session" && <Caveat maxWidth={720}>{FOCUS_CAVEAT}</Caveat>}
    </section>
  );
}
