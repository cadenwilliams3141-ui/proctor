"use client";

import { ListOrdered, Map as MapIcon, AudioWaveform } from "lucide-react";

import { dim } from "@/lib/proctor/channels";
import { IS_FIXTURE } from "@/lib/proctor/data-source";
import { useProctor, type AnalysisView, type Screen } from "@/lib/proctor/store";
import { TIER_BLURB, TIERS } from "@/lib/tier";

const TITLE: Record<Screen, { title: string; sub: string }> = {
  sessions: { title: "Sessions", sub: "everything the rig watcher has sent" },
  report: { title: "Session report", sub: "what this session did, module by module" },
  analyse: { title: "Analyse", sub: "one lap against your own reference" },
  live: { title: "Live trace", sub: "the reference lap, swept at constant distance" },
  rig: { title: "Rig health", sub: "what your hardware produced this session" },
  upload: { title: "Upload", sub: "add a session by hand" },
};

const VIEWS: { id: AnalysisView; label: string; Icon: typeof ListOrdered }[] = [
  { id: "loss", label: "Where it went", Icon: ListOrdered },
  { id: "ribbon", label: "Ribbon", Icon: AudioWaveform },
  { id: "map", label: "Map & delta", Icon: MapIcon },
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
        boxShadow: `inset 0 -1px 0 ${dim(8)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", minWidth: 0 }}>
        <span style={{ font: "500 14px var(--font-heading)" }}>{meta.title}</span>
        <span
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

      {state.screen === "analyse" && (
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
                {label}
              </button>
            );
          })}
        </div>
      )}

      <span style={{ width: 1, height: 18, background: dim(12), flex: "none" }} />
      <span style={{ fontSize: 11, color: dim(42), flex: "none" }}>detail</span>

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
