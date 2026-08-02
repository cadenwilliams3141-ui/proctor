"use client";

/* 56px icon rail, full height. The whole app lives behind six items, which is
 * the point of the redesign: the five Next routes became one shell, so moving
 * between them no longer loses lap selection, cursor or scroll position. */

import {
  ChartLine,
  CirclePlay,
  Gauge,
  LayoutGrid,
  NotebookText,
  Settings,
  Upload,
} from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import { useProctor, type Screen } from "@/lib/proctor/store";

/* Phosphor is what the design specifies; lucide is what is vendored in this
   app, so each glyph is mapped to its nearest lucide equivalent. The one that
   is not a like-for-like is `steering-wheel` -> Gauge: lucide has no steering
   wheel, and Gauge reads as instrumentation, which is what Rig health is. */
const NAV: { id: Screen; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "Sessions", Icon: LayoutGrid },
  { id: "report", label: "Session report", Icon: NotebookText },
  { id: "analyze", label: "Analyze", Icon: ChartLine },
  { id: "live", label: "Live trace", Icon: CirclePlay },
  { id: "rig", label: "Rig health", Icon: Gauge },
  { id: "upload", label: "Upload", Icon: Upload },
];

export default function IconRail() {
  const { state, dispatch } = useProctor();

  return (
    <nav
      aria-label="Screens"
      style={{
        width: 56,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: "14px 0 12px",
        background: "var(--color-bg)",
        boxShadow: `inset -1px 0 0 ${dim(8)}`,
      }}
    >
      <button
        type="button"
        className="pk"
        title="Replay the launch screen"
        onClick={() => dispatch({ t: "splash", on: true })}
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-accent)",
          background: "transparent",
          display: "grid",
          placeItems: "center",
          font: "500 13px var(--font-heading)",
          color: "var(--ch-a)",
          marginBottom: 12,
        }}
      >
        P
      </button>

      {NAV.map(({ id, label, Icon }) => {
        const active = state.screen === id;
        return (
          <button
            key={id}
            type="button"
            className="pk"
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => dispatch({ t: "screen", screen: id })}
            style={{
              width: 38,
              height: 38,
              flex: "none",
              borderRadius: "var(--radius-md)",
              border: 0,
              display: "grid",
              placeItems: "center",
              color: active ? "var(--ch-a)" : dim(40),
              background: active
                ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                : "transparent",
            }}
          >
            <Icon size={19} strokeWidth={1.6} />
          </button>
        );
      })}

      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="pk"
        title="Settings"
        aria-label="Settings"
        style={{
          width: 38,
          height: 38,
          flex: "none",
          borderRadius: "var(--radius-md)",
          border: 0,
          background: "transparent",
          display: "grid",
          placeItems: "center",
          color: dim(38),
        }}
      >
        <Settings size={19} strokeWidth={1.6} />
      </button>
    </nav>
  );
}
