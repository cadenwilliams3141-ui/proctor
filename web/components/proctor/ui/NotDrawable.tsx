"use client";

/* What a comparison view shows when it cannot draw.
 *
 * The four analysis views all used to guard with
 * `!bundle || !ledger || !traceA || !traceB` and render one "Reading the
 * session…" for every one of those cases. Only the first is actually loading.
 * The rest are settled facts — this session has no clean lap, or only one, or
 * its traces were never stored — and a loading message for a settled fact is a
 * box that stays blank forever while promising it will not.
 *
 * So loading still says loading, and everything else says what is true and what
 * would change it. The reason text comes from the store's `readiness`, which
 * derives it in one place so no two views can disagree.
 */

import { Loader2, SearchX } from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import { Eyebrow } from "@/components/proctor/ui/Caveat";
import type { Readiness } from "@/lib/proctor/readiness";

const HEADINGS: Record<string, string> = {
  error: "This session could not be read",
  "no-reference": "No lap to measure against",
  "no-comparison": "Only one clean lap",
  "no-traces": "No stored trace for this lap",
};

export default function NotDrawable({ readiness }: { readiness: Readiness }) {
  if (readiness.state === "ready") return null;

  if (readiness.state === "loading") {
    return (
      <div
        style={{
          padding: "var(--space-8) var(--space-6)",
          color: dim(45),
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Loader2 size={13} strokeWidth={1.8} className="spin" aria-hidden />
        Reading the session…
      </div>
    );
  }

  const isError = readiness.state === "error";

  return (
    <div style={{ padding: "var(--space-8) var(--space-6)", maxWidth: 620 }}>
      <Eyebrow size={10} color={dim(40)}>
        nothing to draw
      </Eyebrow>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 6px" }}>
        <SearchX size={16} strokeWidth={1.7} color={dim(48)} aria-hidden />
        <h2 style={{ fontSize: 15, margin: 0, fontWeight: 500, color: dim(78) }}>
          {HEADINGS[readiness.state] ?? "Nothing to draw"}
        </h2>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          lineHeight: 1.65,
          color: dim(52),
          textWrap: "pretty",
          fontFamily: isError ? "var(--font-mono, monospace)" : undefined,
        }}
      >
        {readiness.reason}
      </p>
      <p style={{ margin: "var(--space-4) 0 0", fontSize: 11, lineHeight: 1.6, color: dim(36) }}>
        The session&apos;s other screens still work — the report, the lap list and the rig
        readings do not need a comparison.
      </p>
    </div>
  );
}
