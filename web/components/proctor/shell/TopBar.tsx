"use client";

import { dim } from "@/lib/proctor/channels";
import { IS_FIXTURE } from "@/lib/proctor/data-source";
import { useProctor, type Screen } from "@/lib/proctor/store";
import { TIER_BLURB, TIERS } from "@/lib/tier";

const TITLE: Record<Screen, { title: string; sub: string }> = {
  sessions: { title: "Sessions", sub: "everything the rig watcher has sent" },
  report: { title: "Session report", sub: "where the time is, and what your own fastest passes did differently" },
  corner: { title: "Corners", sub: "every pass through one corner, and the evidence behind its action" },
  data: { title: "Data", sub: "any lap, any channel, on time or distance — the whole session at full detail" },
  analyze: { title: "Data", sub: "any lap, any channel, on time or distance — the whole session at full detail" },
  /* NOT "in the time it actually took": playback defaults to 4x, so that
     sentence was false the moment the screen opened. The rate is a control on
     the screen and the readout beside it already states the truth; the subtitle
     now says what is true at every multiplier. */
  live: { title: "Data", sub: "every lap in its own time, side by side" },
  rig: { title: "Data", sub: "what you asked for, what the car did with it, and what the ground gave" },
  /* Labelled Rig, though its id is `hardware`: `rig` is the Physics screen's id
     and is in links people have kept. See shell/IconRail.tsx. */
  hardware: { title: "Rig", sub: "the layout you drive from, and what you have said is in each slot" },
  anatomy: {
    title: "Anatomy",
    sub: "a prototype racer taken apart, and the rig hardware that stands in for each system",
  },
  upload: { title: "Upload", sub: "add a session by hand" },
};

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
