"use client";

import { ListOrdered, Map as MapIcon, AudioWaveform, Spline } from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import { IS_FIXTURE } from "@/lib/proctor/data-source";
import { useProctor, type AnalysisView, type Screen } from "@/lib/proctor/store";
import { TIER_BLURB, TIERS } from "@/lib/tier";

const TITLE: Record<Screen, { title: string; sub: string }> = {
  sessions: { title: "Sessions", sub: "everything the rig watcher has sent" },
  report: { title: "Session report", sub: "what this session did, module by module" },
  analyze: { title: "Analyze", sub: "any lap of this session against any other" },
  /* NOT "in the time it actually took": playback defaults to 4x, so that
     sentence was false the moment the screen opened. The rate is a control on
     the screen and the readout beside it already states the truth; the subtitle
     now says what is true at every multiplier. */
  live: { title: "Live trace", sub: "where the car was, moment by moment, at a speed you choose" },
  rig: {
    title: "Physics",
    sub: "what you asked for, what the car did with it, and what the ground actually gave",
  },
  upload: { title: "Upload", sub: "add a session by hand" },
};

const VIEWS: { id: AnalysisView; label: string; Icon: typeof ListOrdered }[] = [
  { id: "loss", label: "Where it went", Icon: ListOrdered },
  { id: "ribbon", label: "Ribbon", Icon: AudioWaveform },
  { id: "map", label: "Map & delta", Icon: MapIcon },
  { id: "line", label: "Racing line", Icon: Spline },
];

export default function TopBar() {
  const { state, dispatch, setTier } = useProctor();
  const meta = TITLE[state.screen];

  return (
    <header
      style={{
        height: 46,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "0 var(--space-6)",
        // Every control in here is flex:none, so without this the row simply
        // spilled past the right edge and the tier switcher — the app's only
        // preference — became unreachable on a tablet. It sheds its decorative
        // parts first (see .tb-* rules in globals.css); this is the backstop
        // for whatever is left.
        minWidth: 0,
        overflowX: "auto",
        scrollbarWidth: "none",
        boxShadow: `inset 0 -1px 0 ${dim(8)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", minWidth: 0 }}>
        <span style={{ font: "500 14px var(--font-heading)" }}>{meta.title}</span>
        <span
          className="tb-sub"
          style={{
            fontSize: 11.5,
            color: dim(45),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {meta.sub}
        </span>
      </div>

      <span style={{ flex: 1 }} />

      {/* Fixture data is plausible enough to be mistaken for a real session,
          which is exactly why it gets said out loud rather than left to the
          reader to notice. Disappears the moment a real source is wired. */}
      {IS_FIXTURE && (
        <span
          className="tag-warn"
          title="Every number on screen is synthetic, produced by a physical model in lib/proctor/fixture. Nothing here came from a .ibt file."
          style={{ flex: "none" }}
        >
          sample data
        </span>
      )}

      {state.screen === "analyze" && (
        <div style={{ display: "flex", gap: 2, flex: "none" }}>
          {VIEWS.map(({ id, label, Icon }) => {
            const active = state.view === id;
            return (
              <button
                key={id}
                type="button"
                className="pk"
                onClick={() => dispatch({ t: "view", view: id })}
                aria-pressed={active}
                aria-label={label}
                title={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 7,
                  border: 0,
                  font: "500 12px var(--font-heading)",
                  color: active ? "var(--color-text)" : dim(52),
                  background: active ? dim(6) : "transparent",
                  boxShadow: active ? `inset 0 0 0 1px ${dim(12)}` : "none",
                }}
              >
                <Icon size={14} strokeWidth={1.7} />
                <span className="tb-view-label">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      <span className="tb-detail-word" style={{ width: 1, height: 18, background: dim(12), flex: "none" }} />
      <span className="tb-detail-word" style={{ fontSize: 11, color: dim(42), flex: "none" }}>
        detail
      </span>

      <div className="seg" style={{ flex: "none" }}>
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            className="seg-opt"
            data-active={state.tier === t}
            title={TIER_BLURB[t]}
            onClick={() => setTier(t)}
            style={{ fontSize: 11, padding: "4px 9px" }}
          >
            {t}
          </button>
        ))}
      </div>

      <div
        aria-hidden
        className="tb-avatar"
        style={{
          width: 26,
          height: 26,
          flex: "none",
          borderRadius: "50%",
          background: "var(--color-accent-900)",
          boxShadow: "0 0 0 1px var(--color-accent-800)",
          display: "grid",
          placeItems: "center",
          font: "500 10px var(--font-heading)",
          color: "var(--ch-a)",
        }}
      >
        C
      </div>
    </header>
  );
}
