"use client";

import { dim } from "@/lib/proctor/channels";

/** Surface card. Elevation on a dark ground is an edge plus ambient darkness —
 *  --shadow-sm for panels and nothing heavier. */
export default function Panel({
  title,
  sub,
  right,
  children,
  foot,
  fill,
  padding = "var(--space-3) var(--space-4) var(--space-4)",
  style,
}: {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** The panel's own honesty note, pinned to the bottom. */
  foot?: React.ReactNode;
  /** Grow to fill the parent and let the body take the slack. */
  fill?: boolean;
  padding?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
        padding,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...(fill ? { flex: 1 } : null),
        ...style,
      }}
    >
      {(title || right) && (
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-2)",
            marginBottom: "var(--space-2)",
            flex: "none",
          }}
        >
          {title && <span style={{ font: "500 12.5px var(--font-heading)" }}>{title}</span>}
          {sub && <span style={{ fontSize: 11, color: dim(42) }}>{sub}</span>}
          <span style={{ flex: 1 }} />
          {right}
        </header>
      )}

      <div style={{ flex: fill ? 1 : undefined, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>

      {foot}
    </section>
  );
}
