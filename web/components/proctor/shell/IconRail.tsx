"use client";

/* 56px icon rail, full height. The whole app lives behind eight items, which is
 * the point of the redesign: the five Next routes became one shell, so moving
 * between them no longer loses lap selection, cursor or scroll position. */

import {
  Armchair,
  ChartLine,
  CirclePlay,
  Gauge,
  Layers,
  LayoutGrid,
  NotebookText,
  Upload,
} from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import { useProctor, type Screen } from "@/lib/proctor/store";

import ViewSwitch from "@/components/proctor/ui/ViewSwitch";

/* Phosphor is what the design specifies; lucide is what is vendored in this
   app, so each glyph is mapped to its nearest lucide equivalent. The one that
   is not a like-for-like is `steering-wheel` -> Gauge: lucide has no steering
   wheel, and Gauge reads as instrumentation, which is what Physics is.

   The `rig` id is deliberately unchanged though the label is not: it appears in
   ?screen= links people may have kept.

   That leaves the screen that IS about the rig without the obvious id, so it is
   `hardware`, labelled "Rig". Its glyph is a seat because the rig is the thing
   you sit in, and because a second dial next to Physics would read as the same
   screen twice.

   Anatomy is the exploded car. Its glyph is a stack of layers lifting apart,
   which is what the screen does; a car glyph would promise the driver's own. */
/* Each item carries a SHORT word under its glyph as well as its full name.
   Eight unlabelled glyphs asked a driver to learn the app before using it; a
   word under each costs 8px of width and nothing else. */
const NAV: { id: Screen; label: string; short: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "Sessions", short: "Sessions", Icon: LayoutGrid },
  { id: "report", label: "Session report", short: "Report", Icon: NotebookText },
  { id: "analyze", label: "Analyze", short: "Analyze", Icon: ChartLine },
  { id: "live", label: "Live trace", short: "Live", Icon: CirclePlay },
  { id: "rig", label: "Physics", short: "Physics", Icon: Gauge },
  { id: "hardware", label: "Rig", short: "Rig", Icon: Armchair },
  { id: "anatomy", label: "Anatomy", short: "Anatomy", Icon: Layers },
  { id: "upload", label: "Upload", short: "Upload", Icon: Upload },
];

export default function IconRail() {
  const { state, dispatch } = useProctor();

  return (
    <nav
      className="icon-rail"
      aria-label="Screens"
      style={{
        width: 64,
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

      {NAV.map(({ id, label, short, Icon }) => {
        const active = state.screen === id;
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => dispatch({ t: "screen", screen: id })}
            className="pk rail-item"
            style={{
              width: 56,
              height: 46,
              flex: "none",
              borderRadius: "var(--radius-md)",
              border: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              color: active ? "var(--ch-a)" : dim(46),
              background: active
                ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                : "transparent",
            }}
          >
            <Icon size={18} strokeWidth={1.6} />
            <span className="rail-label">{short}</span>
          </button>
        );
      })}

      {/* A Settings button used to sit here with no handler and nowhere to go.
          There is no settings screen; the one preference the app has — the
          detail tier — is a control in the top bar. A button that does nothing
          is the same lie as a number that describes nothing, so it is gone
          rather than wired to a placeholder. */}

      {/* Pushed to the foot: the way to the phone app, for anyone who pinned
          the desktop view on a phone or wants to send themselves the link. */}
      <div className="rail-foot" style={{ marginTop: "auto", paddingBottom: "var(--space-2)" }}>
        <ViewSwitch to="phone" compact />
      </div>
    </nav>
  );
}
