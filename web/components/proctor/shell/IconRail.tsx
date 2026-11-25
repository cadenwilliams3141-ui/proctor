"use client";

/* 64px icon rail, full height (Carbon: the active screen is a filled cyan tile). The whole app lives behind eight items, which is
 * the point of the redesign: the five Next routes became one shell, so moving
 * between them no longer loses lap selection, cursor or scroll position. */

import {
  Armchair,
  ChartLine,
  CirclePlay,
  Disc3,
  Layers,
  LayoutGrid,
  RotateCw,
  Route,
  Sparkles,
  TrendingUp,
  Upload,
  Waves,
} from "lucide-react";

import type { AspectKey } from "@/lib/proctor/coach";
import { ASPECT_LABEL } from "@/lib/proctor/coach";
import { useProctor, type Screen } from "@/lib/proctor/store";

import ViewSwitch from "@/components/proctor/ui/ViewSwitch";

/* The rail is organised the way a driver thinks after a session: the coach
   first, then the five parts of the driving, each its own item, then the
   drill-downs and the rig.

   Two ids are kept for links people have saved, though their labels moved:
   `analyze` is labelled "Laps" (the lap-against-lap drill-down the coach points
   into) and `hardware` is labelled "Gear" (the rig, and whether it was the rig
   or you). The retired Physics (`rig`) and Session report (`report`) ids open
   the coach — see app/page.tsx.

   Lucide has no steering wheel or brake pedal, so the aspect glyphs are the
   nearest honest picture: a brake disc, rotation, the throttle's rising line,
   a route, and the friction of the road. */
const TOP: { id: Screen; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "Sessions", Icon: LayoutGrid },
  { id: "coach", label: "Coach", Icon: Sparkles },
];

const ASPECTS: { id: AspectKey; Icon: typeof LayoutGrid }[] = [
  { id: "braking", Icon: Disc3 },
  { id: "turn_in", Icon: RotateCw },
  { id: "throttle", Icon: TrendingUp },
  { id: "line", Icon: Route },
  { id: "grip", Icon: Waves },
];

const BOTTOM: { id: Screen; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "analyze", label: "Laps", Icon: ChartLine },
  { id: "live", label: "Live trace", Icon: CirclePlay },
  { id: "hardware", label: "Gear", Icon: Armchair },
  { id: "anatomy", label: "Anatomy", Icon: Layers },
  { id: "upload", label: "Upload", Icon: Upload },
];

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="pk rail-btn"
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Divider = () => (
  <span
    aria-hidden
    className="rail-divider"
    style={{ width: 22, height: 1, background: "var(--color-line)", margin: "6px 0", flex: "none" }}
  />
);

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
        gap: 6,
        padding: "18px 0 12px",
        background: "var(--color-rail)",
        boxShadow: "inset -1px 0 0 var(--color-line)",
      }}
    >
      <button
        type="button"
        className="pk"
        title="Replay the launch screen"
        onClick={() => dispatch({ t: "splash", on: true })}
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: 10,
          border: 0,
          background: "var(--color-accent)",
          display: "grid",
          placeItems: "center",
          font: "700 16px var(--font-heading)",
          color: "var(--color-on-accent)",
          marginBottom: 10,
          cursor: "pointer",
        }}
      >
        P
      </button>

      {TOP.map(({ id, label, Icon }) => (
        <RailButton
          key={id}
          label={label}
          active={state.screen === id}
          onClick={() => dispatch({ t: "screen", screen: id })}
        >
          <Icon size={20} strokeWidth={1.7} />
        </RailButton>
      ))}
      <Divider />
      {ASPECTS.map(({ id, Icon }) => (
        <RailButton
          key={id}
          label={ASPECT_LABEL[id]}
          active={state.screen === "aspect" && state.aspect === id}
          onClick={() => dispatch({ t: "aspect", aspect: id })}
        >
          <Icon size={19} strokeWidth={1.7} />
        </RailButton>
      ))}
      <Divider />
      {BOTTOM.map(({ id, label, Icon }) => (
        <RailButton
          key={id}
          label={label}
          active={state.screen === id}
          onClick={() => dispatch({ t: "screen", screen: id })}
        >
          <Icon size={20} strokeWidth={1.7} />
        </RailButton>
      ))}

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
