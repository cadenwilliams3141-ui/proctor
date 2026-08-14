"use client";

/* 248px lap rail. Replaces the two <select> elements the old LapAnalysis used
 * to pick laps with — the comparison is the primary act on this screen, so it
 * gets persistent chrome rather than a dropdown.
 *
 * ┌ WHY EVERY LAP IS SELECTABLE NOW ────────────────────────────────────────┐
 * │ Lap A used to be pinned to the reference lap, and only clean laps could │
 * │ go in lap B. Between them those two rules made most comparisons         │
 * │ unaskable: lap 7 against lap 12 when neither is the fastest, or the     │
 * │ flagged lap against the clean one either side of it — which is exactly  │
 * │ the comparison you want when you are trying to understand what the      │
 * │ flagged lap did.                                                        │
 * │                                                                         │
 * │ So both slots are selectable, and the only thing that disqualifies a    │
 * │ lap is having no stored trace — with no channels there is nothing to    │
 * │ compare. Choosing an excluded lap is allowed and SAYS SO: the row keeps │
 * │ its tag, and the screen carries a banner naming what is unusual about   │
 * │ it. The honesty rule is that an excluded lap is never silently averaged │
 * │ in; it was never that you may not look at one deliberately.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Unusable laps stay VISIBLE and stay EXCLUDED from anything automatic —
 * dimmed, never dropped. A lap that vanishes from the list is a lap the driver
 * cannot reason about. */

import { useMemo } from "react";

import { CH, dim } from "@/lib/proctor/channels";
import { fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import { isUsable, type Lap } from "@/lib/proctor/types";

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
          {[session.car_name, session.session_type].filter(Boolean).join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 9, flexWrap: "wrap" }}>
          <span className="tag tag-neutral" style={{ fontSize: 10, padding: "2px 8px" }}>
            {session.lap_count} {session.lap_count === 1 ? "lap" : "laps"}
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

      {/* Which slot a click fills. Two buttons rather than a modifier key,
          because a modifier key is a thing you have to already know. */}
      <div style={{ padding: "0 var(--space-4) var(--space-3)" }}>
        <div
          style={{
            font: "500 9.5px var(--font-heading)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: dim(38),
            marginBottom: 5,
          }}
        >
          clicking a lap sets
        </div>
        <div className="seg" style={{ width: "100%" }}>
          {(["A", "B"] as const).map((which) => (
            <button
              key={which}
              type="button"
              className="seg-opt"
              data-active={state.pick === which}
              onClick={() => dispatch({ t: "pick", which })}
              title={
                which === "A"
                  ? "Lap A is the lap everything is measured against."
                  : "Lap B is the lap being measured."
              }
              style={{ flex: 1, fontSize: 11, padding: "4px 8px" }}
            >
              <span style={{ color: which === "A" ? CH.a : CH.b, fontWeight: 600 }}>{which}</span>
              <span style={{ marginLeft: 5, color: dim(50) }}>
                {which === "A" ? state.lapA ?? "—" : state.lapB ?? "—"}
              </span>
            </button>
          ))}
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
          const isReference = lap.lap_number === referenceLap;
          const t = lap.lap_time_s;

          // Bar is the gap to the driver's OWN best valid lap, not to a target.
          const width =
            usable && scale && t != null
              ? `${Math.max(3, ((t - scale.best) / Math.max(scale.worst - scale.best, 1e-6)) * 100).toFixed(1)}%`
              : "0%";

          // The ONLY disqualifier: no channels means nothing to compare.
          const selectable = hasTrace;
          const why = !hasTrace
            ? "No trace was stored for this lap, so there is nothing to compare."
            : `${isA || isB ? "Already " : ""}Set lap ${lap.lap_number} as ${state.pick}${
                excludedReason(lap) ? ` — ${excludedReason(lap)}` : ""
              }${isReference ? " · your fastest clean lap" : ""}`;

          return (
            <button
              key={lap.lap_number}
              type="button"
              className={selectable ? "lrow" : undefined}
              disabled={!selectable}
              title={why}
              onClick={() =>
                selectable &&
                dispatch(
                  state.pick === "A"
                    ? { t: "lapA", lap: lap.lap_number }
                    : { t: "lapB", lap: lap.lap_number },
                )
              }
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
                  color: usable ? "var(--color-text)" : dim(34),
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
                  width: 58,
                  fontSize: 11.5,
                  color: usable ? dim(80) : dim(40),
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
              {/* An excluded lap keeps a mark on it wherever it is shown, so a
                  comparison against one can never look like a clean one. */}
              <span
                style={{
                  width: 40,
                  textAlign: "right",
                  fontSize: 10.5,
                  color: usable ? dim(50) : CH.warn,
                }}
                className={usable ? "num" : undefined}
              >
                {!hasTrace
                  ? "—"
                  : !usable
                    ? shortTag(lap)
                    : scale && t != null
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
        Any lap with a stored trace can go in either slot — including out, in and
        flagged laps, which stay marked wherever they appear. Bars are the gap to
        your own best valid lap.
      </div>
    </aside>
  );
}

/** Why a lap is excluded from anything automatic, in a few words. */
export function excludedReason(lap: Lap): string | null {
  if (isUsable(lap)) return null;
  if (lap.lap_time_s == null) return "no complete lap time was recorded for it";
  if (lap.is_out_lap) return "an out or in lap, so not a representative flying lap";
  if (lap.is_anomalous) {
    return lap.incident_delta > 0
      ? `flagged: ${lap.incident_delta} incident${lap.incident_delta === 1 ? "" : "s"} were logged on it`
      : "flagged: its speed profile is unlike your other laps this session";
  }
  return "not a valid lap";
}

function shortTag(lap: Lap): string {
  if (lap.lap_time_s == null) return "part";
  if (lap.is_out_lap) return "out";
  if (lap.is_anomalous) return "flag";
  return "excl";
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
