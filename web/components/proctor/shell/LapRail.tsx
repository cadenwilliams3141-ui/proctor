"use client";

/* 248px lap rail. Replaces the two <select> elements the old LapAnalysis used
 * to pick laps with — the comparison is the primary act on this screen, so it
 * gets persistent chrome rather than a dropdown.
 *
 * The honesty rule that shapes this component: unusable laps (out/in, partial,
 * anomalous) stay VISIBLE and stay EXCLUDED. Dimmed, never dropped. A lap that
 * vanishes from the list is a lap the driver cannot reason about. */

import { useMemo } from "react";

import { dim } from "@/lib/proctor/channels";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";

export default function LapRail() {
  const { bundle, state, dispatch, referenceLap } = useProctor();

  const scale = useMemo(() => {
    if (!bundle) return null;
    const times = bundle.laps.filter(isUsable).map((l) => l.lap_time_s as number);
    if (times.length === 0) return null;
    return { best: Math.min(...times), worst: Math.max(...times) };
  }, [bundle]);

  if (!bundle) return <aside style={RAIL} aria-label="Laps" />;

  const { session, laps } = bundle;

  return (
    <aside style={RAIL} aria-label="Laps">
      {/* Session header */}
      <div style={{ padding: "var(--space-4) var(--space-4) var(--space-3)" }}>
        <div
          style={{
            font: "500 10px var(--font-heading)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--color-accent-300)",
          }}
        >
          session
        </div>
        <div style={{ font: "500 15px/1.3 var(--font-heading)", marginTop: 4 }}>
          {session.track_name ?? "Unknown track"}
        </div>
        <div style={{ fontSize: 11.5, color: dim(48), marginTop: 3 }}>
          {[session.car_name, session.session_type, fmtDay(session.recorded_at)]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 9, flexWrap: "wrap" }}>
          <span className="tag tag-neutral" style={{ fontSize: 10, padding: "2px 8px" }}>
            {session.lap_count} laps
          </span>
          {/* Wear masked travels with the session onto every view of it. */}
          {session.wear_masked && (
            <span
              className="tag-warn"
              title="iRacing froze tire wear for this session, so nothing about wear is claimed from it."
            >
              wear masked
            </span>
          )}
        </div>
      </div>

      <div className="rule" style={{ "--fade": "40px" } as React.CSSProperties} />

      {/* Lap list */}
      <div
        className="scrollpane"
        style={{ flex: 1, minHeight: 0, padding: "0 var(--space-2) var(--space-2)" }}
      >
        {laps.map((lap, i) => {
          const usable = isUsable(lap);
          const hasTrace = bundle.traces[lap.lap_number] != null;
          const isA = lap.lap_number === state.lapA;
          const isB = lap.lap_number === state.lapB;
          const t = lap.lap_time_s;

          // Bar is the gap to the driver's OWN best valid lap, not to a target.
          const width =
            usable && scale && t != null
              ? `${Math.max(3, ((t - scale.best) / Math.max(scale.worst - scale.best, 1e-6)) * 100).toFixed(1)}%`
              : "0%";

          const why = isA
            ? `Lap ${lap.lap_number} is your reference — your own fastest clean lap. Everything is measured against it.`
            : !usable
            ? lap.is_out_lap
              ? "Out or in lap — not a representative flying lap."
              : lap.is_anomalous
                ? "Flagged as anomalous. Shown, but excluded from comparisons."
                : "Not a valid lap. Shown, but excluded from comparisons."
            : !hasTrace
              ? "No trace stored for this lap, so it cannot be compared."
              : `Compare lap ${lap.lap_number} against lap ${state.lapA ?? referenceLap}`;

          const selectable = usable && hasTrace && !isA;

          return (
            <button
              key={lap.lap_number}
              type="button"
              className={selectable ? "lrow" : undefined}
              disabled={!selectable}
              title={why}
              onClick={() => selectable && dispatch({ t: "lapB", lap: lap.lap_number })}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "5px 6px",
                borderRadius: 6,
                marginBottom: 2,
                border: 0,
                textAlign: "left",
                font: "inherit",
                cursor: selectable ? "pointer" : "default",
                background: isA
                  ? "color-mix(in srgb, var(--color-accent) 13%, transparent)"
                  : isB
                    ? "rgba(224,168,106,.11)"
                    : "transparent",
                boxShadow: isA
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)"
                  : isB
                    ? "inset 0 0 0 1px rgba(224,168,106,.32)"
                    : "none",
                // Entrance delay is written once per row and never rebuilt, so a
                // re-render (a new lap B, say) does not replay the whole list.
                animation: "fadeUp .4s both",
                animationDelay: `${(i * 0.018).toFixed(3)}s`,
              }}
            >
              <span
                className="num"
                style={{
                  width: 17,
                  textAlign: "right",
                  font: "500 11px var(--font-heading)",
                  color: usable ? "var(--color-text)" : dim(28),
                }}
              >
                {lap.lap_number}
              </span>
              <span
                style={{
                  width: 13,
                  fontSize: 11,
                  fontWeight: 500,
                  color: isA ? "var(--ch-a)" : isB ? "var(--ch-b)" : "transparent",
                }}
              >
                {isA ? "A" : isB ? "B" : ""}
              </span>
              <span
                className="num"
                style={{
                  width: 60,
                  fontSize: 11.5,
                  color: usable ? dim(80) : dim(34),
                }}
              >
                {fmtLap(t)}
              </span>
              <span
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 3,
                  background: dim(7),
                  overflow: "hidden",
                  display: "block",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width,
                    borderRadius: 3,
                    background: isA ? "var(--ch-a)" : isB ? "var(--ch-b)" : dim(24),
                    transformOrigin: "left",
                    animation: "growX .5s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${(0.1 + i * 0.018).toFixed(3)}s`,
                  }}
                />
              </span>
              <span
                className="num"
                style={{
                  width: 38,
                  textAlign: "right",
                  fontSize: 10.5,
                  color: usable ? dim(50) : dim(30),
                }}
              >
                {usable && scale && t != null
                  ? t === scale.best
                    ? "best"
                    : `+${(t - scale.best).toFixed(2)}`
                  : "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: "9px var(--space-4)",
          fontSize: 10.5,
          lineHeight: 1.45,
          color: dim(36),
          boxShadow: `inset 0 1px 0 ${dim(8)}`,
        }}
      >
        Click a lap to set B. Bars are the gap to your own best valid lap; out/in,
        partial and anomalous laps are dimmed, not hidden.
      </div>
    </aside>
  );
}

const RAIL: React.CSSProperties = {
  width: 248,
  flex: "none",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  background: "var(--color-bg)",
  boxShadow: `inset -1px 0 0 ${dim(8)}`,
};
