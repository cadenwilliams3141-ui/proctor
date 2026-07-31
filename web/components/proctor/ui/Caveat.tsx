"use client";

/* Caveats are kept in full but DEMOTED.
 *
 * Every panel that had an honesty note in the old UI still has it. They are
 * 10.5px, muted, and sit at the foot of the panel that owns them rather than
 * interrupting the reading order. Nothing was deleted — that distinction is the
 * whole design move, and it only holds if this component stays quiet enough to
 * live under every panel without anyone wanting to remove it. */

import { Info } from "lucide-react";

import { dim } from "@/lib/proctor/channels";

export default function Caveat({
  children,
  icon = true,
  maxWidth,
  style,
}: {
  children: React.ReactNode;
  icon?: boolean;
  maxWidth?: number;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        margin: "var(--space-3) 0 0",
        fontSize: 10.5,
        lineHeight: 1.5,
        color: dim(36),
        maxWidth,
        textWrap: "pretty",
        ...style,
      }}
    >
      {icon && (
        <Info size={12} strokeWidth={1.7} style={{ flex: "none", marginTop: 2 }} aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

/** An eyebrow: 9.5-10px, uppercase, wide tracking. */
export function Eyebrow({
  children,
  size = 10,
  color,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        font: `500 ${size}px var(--font-heading)`,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: color ?? dim(42),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
