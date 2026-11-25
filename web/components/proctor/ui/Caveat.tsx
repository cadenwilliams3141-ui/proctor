"use client";

/* Caveats are kept in full but DEMOTED.
 *
 * Every panel that had an honesty note in the old UI still has it. They are
 * 10.5px, muted, and sit at the foot of the panel that owns them rather than
 * interrupting the reading order. Nothing was deleted — that distinction is the
 * whole design move, and it only holds if this component stays quiet enough to
 * live under every panel without anyone wanting to remove it. */

import { Info } from "lucide-react";


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
        fontSize: 11,
        lineHeight: 1.5,
        // The honesty line has to be readable: muted, at 4.5:1 or better.
        color: "var(--color-neutral-500)",
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
  size = 11,
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
        font: `var(--font-heading-weight) ${size}px var(--font-heading)`,
        letterSpacing: ".13em",
        textTransform: "uppercase",
        // Muted, not dimmed: a dimmed label on Carbon's graphite fell under 4.5:1.
        color: color ?? "var(--color-neutral-500)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
