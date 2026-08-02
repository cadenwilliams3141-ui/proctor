"use client";

/* Plain English on screen.
 *
 * Every screen in this app can show a number. This component is what turns the
 * number into a sentence a driver can act on: what happened, how big it was,
 * where in the lap it was, and where to go and look at it.
 *
 * `lookAt` is deliberately a POINTER, never an instruction. "Turn 4, on entry"
 * tells the driver where the evidence is; "brake later into Turn 4" would be a
 * guess about a decision the telemetry never recorded. See lib/proctor/explain
 * for the reasoning behind that line and why it sits where it does. */

import { Lightbulb, Crosshair } from "lucide-react";

import { CH, dim } from "@/lib/proctor/channels";
import type { Explanation } from "@/lib/proctor/explain";

export default function Explain({
  items,
  compact = false,
  max,
}: {
  items: Explanation[];
  /** Headline only — for rails and cards where the detail would not fit. */
  compact?: boolean;
  max?: number;
}) {
  const shown = max != null ? items.slice(0, max) : items;
  if (shown.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : "var(--space-3)" }}>
      {shown.map((e, i) => (
        <div key={`${e.headline}-${i}`} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
          <Lightbulb
            size={13}
            strokeWidth={1.8}
            color={CH.a}
            style={{ flex: "none", marginTop: 3, opacity: 0.85 }}
            aria-hidden
          />
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: compact ? 12 : 12.5,
                lineHeight: 1.55,
                color: "var(--color-text)",
                textWrap: "pretty",
              }}
            >
              {e.headline}
            </p>
            {!compact && e.detail && (
              <p
                style={{
                  margin: "5px 0 0",
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  color: dim(58),
                  textWrap: "pretty",
                }}
              >
                {e.detail}
              </p>
            )}
            {!compact && e.lookAt && (
              <p
                style={{
                  margin: "6px 0 0",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: dim(48),
                }}
              >
                <Crosshair size={11} strokeWidth={2} color={CH.b} aria-hidden />
                <span>
                  <span style={{ color: dim(38) }}>where to look: </span>
                  {e.lookAt}
                </span>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The same, as one leading paragraph rather than a list. Used where a screen
 *  needs a single sentence at the top before any chart. */
export function Lede({ item }: { item: Explanation | null }) {
  if (!item) return null;
  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, textWrap: "pretty" }}>
        {item.headline}
      </p>
      {item.detail && (
        <p
          style={{
            margin: "7px 0 0",
            fontSize: 12,
            lineHeight: 1.65,
            color: dim(58),
            textWrap: "pretty",
          }}
        >
          {item.detail}
        </p>
      )}
    </div>
  );
}
