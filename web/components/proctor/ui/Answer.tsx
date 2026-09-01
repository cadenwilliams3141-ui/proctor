"use client";

/* Answer first, evidence second.
 *
 * ┌ THE PROBLEM THIS SOLVES ────────────────────────────────────────────────┐
 * │ Every honest sentence on a screen carried equal weight, so the report    │
 * │ opened with roughly twenty blocks and the rig screen with fourteen. None │
 * │ of them was wrong. The reader still could not tell which one mattered.   │
 * │                                                                          │
 * │ So each screen now opens with the ANSWER — a sentence or three and one   │
 * │ number — and everything that PROVES the answer moves behind <Evidence>.  │
 * │ Nothing is deleted and nothing is summarised away; the charts are one    │
 * │ click from where they were.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌ WHAT <Evidence> MAY NEVER CONTAIN ──────────────────────────────────────┐
 * │ Charts and tables. That is the whole list.                               │
 * │                                                                          │
 * │ It may NOT contain a Caveat, an absence, a NotDrawable, or any other     │
 * │ statement of what is missing or uncertain. The Decision of 2026-08-14 is │
 * │ explicit that nothing may hide behind a disclosure if hiding it changes  │
 * │ the meaning of what is left in front of the reader — and a chart with    │
 * │ its caveat folded away is exactly that. So caveats stay out here, beside │
 * │ the answer, where they qualify the sentence the reader actually reads.   │
 * │                                                                          │
 * │ `hint` is for naming what is under the fold ("4 charts, 2 tables"), so   │
 * │ a collapsed section still says what it holds. A disclosure the reader    │
 * │ cannot see into is how detail gets lost rather than tidied.              │
 * └──────────────────────────────────────────────────────────────────────────┘ */

import { useEffect, useState } from "react";

import { ChevronRight } from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import type { Explanation } from "@/lib/proctor/explain";
import { useProctor } from "@/lib/proctor/store";

import Explain from "@/components/proctor/ui/Explain";

/** The one number a screen is about, with its label. */
export function HeroNumber({
  value,
  unit,
  label,
  tone = "var(--color-text)",
}: {
  value: string;
  unit?: string;
  label: string;
  tone?: string;
}) {
  return (
    <div style={{ flex: "none" }}>
      <div
        className="num"
        style={{ font: `500 34px/1.05 var(--font-heading)`, color: tone, letterSpacing: "-.01em" }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: 15, marginLeft: 3, color: dim(46) }}>{unit}</span>
        )}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: dim(46), maxWidth: 190, textWrap: "pretty" }}>
        {label}
      </div>
    </div>
  );
}

/** The top of a screen: what this session showed, in sentences, plus one figure.
 *
 *  `caveat` sits HERE and not inside <Evidence>, on purpose — see the header. */
export default function Answer({
  items,
  hero,
  caveat,
  children,
  max = 3,
}: {
  items: Explanation[];
  hero?: React.ReactNode;
  caveat?: React.ReactNode;
  /** Anything that must be read alongside the answer — absences, notes. */
  children?: React.ReactNode;
  max?: number;
}) {
  const shown = items.slice(0, max);
  if (!shown.length && !hero && !children) return null;

  return (
    <section
      style={{
        display: "flex",
        gap: "var(--space-6)",
        alignItems: "flex-start",
        padding: "var(--space-5) var(--space-5) var(--space-4)",
        background: "var(--color-surface)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Explain items={shown} />
        {children}
        {caveat}
      </div>
      {hero}
    </section>
  );
}

/** The proof, one click away — or already in front of you at "everything".
 *
 *  Collapsed by default. `hint` names what is inside so a folded section is
 *  never a mystery, and the summary is a real <button> so it is reachable by
 *  keyboard and announced as expandable.
 *
 *  EXCEPT AT THE TOP DETAIL TIER. "everything" promises "every panel the
 *  session produced, including the quiet ones" (lib/tier.ts), and a reader who
 *  has deliberately asked for all of it should not then have to open nine folds
 *  to get it. Answer-first is a default for people who want the answer; it was
 *  never meant to outrank an explicit request for the evidence.
 *
 *  This does not weaken the 2026-08-27 rule about what may go in a fold — a
 *  fold still may not contain an absence, and a folded section still does not
 *  count as voicing one. It changes only whether the fold starts open. */
export function Evidence({
  children,
  label = "Show the evidence",
  hint,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  label?: string;
  /** What is under the fold, e.g. "grip curve, g-g plot, speed bands". */
  hint?: string;
  defaultOpen?: boolean;
}) {
  const { state } = useProctor();
  const openByTier = state.tier === "everything";
  const [open, setOpen] = useState(defaultOpen || openByTier);

  /* Follow the tier when it changes, rather than only at mount: switching to
     "everything" and finding the folds still shut would read as the control
     not working. Switching back down re-folds them. */
  useEffect(() => {
    setOpen(defaultOpen || openByTier);
  }, [defaultOpen, openByTier]);

  return (
    <section style={{ marginTop: "var(--space-4)" }}>
      <button
        type="button"
        className="pk"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "var(--space-2) var(--space-3)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          color: dim(62),
          font: "500 11.5px var(--font-heading)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <ChevronRight
          size={13}
          strokeWidth={2}
          aria-hidden
          style={{
            flex: "none",
            transition: "transform 140ms var(--ease-out, ease)",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        <span>{open ? "Hide the evidence" : label}</span>
        {hint && (
          <span style={{ fontWeight: 400, color: dim(34), fontSize: 11 }}>— {hint}</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-4)" }}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A run of screen sections, each with a step number.
 *
 *  Used by the Forces screen, where the order IS the content: what you asked
 *  for, what the car did with it, what came back, what the ground gave. A
 *  numbered step says "this follows from the last one" in a way a stack of
 *  equal panels cannot. */
export function Step({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
        <span
          className="num"
          aria-hidden
          style={{
            font: "500 11px var(--font-heading)",
            color: dim(30),
            letterSpacing: ".08em",
          }}
        >
          {String(n).padStart(2, "0")}
        </span>
        <h2 style={{ margin: 0, font: "500 15px var(--font-heading)" }}>{title}</h2>
        {sub && <span style={{ fontSize: 11.5, color: dim(42) }}>{sub}</span>}
      </header>
      <div className="rule" style={{ margin: "var(--space-2) 0 var(--space-4)" }} />
      {children}
    </section>
  );
}
