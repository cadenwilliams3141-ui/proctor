"use client";

/* The launch screen is a REAL LOADING STATE, not decoration.
 *
 * Parsing a 16-lap .ibt is not instant, and this is where that wait belongs.
 * Two rules follow from that, and both are implemented below:
 *
 *   1. If the parse outlasts the animation, HOLD the screen and swap the
 *      bottom line for real progress. Finishing early into an empty app is
 *      worse than waiting — it reads as "there is nothing here".
 *   2. Under prefers-reduced-motion, show the finished frame briefly instead
 *      of animating. The circuit still draws the same shape; it just arrives
 *      already drawn.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { CH, INK } from "@/lib/proctor/channels";
import { fmtDay } from "@/lib/proctor/format";
import { pathFor, pathLength, project } from "@/lib/proctor/geometry";
import { useProctor } from "@/lib/proctor/store";

const HOLD_MS = 2600;

export default function LaunchScreen() {
  const { bundle, state, dispatch } = useProctor();
  const [reduced, setReduced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // The screen does not dismiss on a timer alone — it dismisses when the timer
  // has elapsed AND the session has actually arrived.
  useEffect(() => {
    if (!state.splash) return;
    if (!bundle) return; // still parsing: hold
    const wait = reduced ? 400 : HOLD_MS;
    timer.current = setTimeout(() => dispatch({ t: "splash", on: false }), wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.splash, bundle, reduced, dispatch]);

  const circuit = useMemo(() => {
    if (!bundle) return null;
    const p = project(bundle.map.x_m, bundle.map.y_m, 460, 320, 26);
    const d = `${pathFor(p, bundle.map.x_m, bundle.map.y_m, 0, bundle.gridSize, 4)} Z`;
    const len = pathLength(p, bundle.map.x_m, bundle.map.y_m, 0, bundle.gridSize, 4);
    return { d, len };
  }, [bundle]);

  if (!state.splash) return null;

  const skip = () => {
    if (timer.current) clearTimeout(timer.current);
    dispatch({ t: "splash", on: false });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={skip}
      title="Click to skip"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
        cursor: "pointer",
        // splashOut only runs once the data is in; while parsing, the overlay
        // simply stays at full opacity.
        animation: bundle && !reduced ? `splashOut ${HOLD_MS}ms both` : undefined,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 620,
          height: 420,
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 24%, transparent), transparent)",
          filter: "blur(34px)",
          animation: "glowPulse 3.4s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      <svg
        viewBox="0 0 460 320"
        style={{ width: 460, height: 320, maxWidth: "70vw", display: "block", position: "relative" }}
        aria-hidden
      >
        {circuit && (
          <>
            <path
              d={circuit.d}
              fill="none"
              stroke={INK.neutral800}
              strokeWidth={7}
              strokeLinejoin="round"
            />
            <path
              d={circuit.d}
              fill="none"
              stroke={CH.a}
              strokeWidth={2.4}
              strokeLinejoin="round"
              style={
                reduced
                  ? undefined
                  : ({
                      "--len": `${circuit.len}px`,
                      strokeDasharray: circuit.len,
                      strokeDashoffset: circuit.len,
                      animation: "drawIn 1.6s cubic-bezier(.3,.1,.25,1) both",
                      animationDirection: "reverse",
                    } as React.CSSProperties)
              }
            />
          </>
        )}
      </svg>

      <div style={{ position: "relative", textAlign: "center" }}>
        <div
          style={{
            font: "500 34px var(--font-heading)",
            animation: reduced ? undefined : "markIn 1s .35s both",
          }}
        >
          Proctor
        </div>
        <div
          style={{
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            marginTop: 8,
            animation: reduced ? undefined : "fadeUp .6s 1.05s both",
          }}
        >
          observations, not verdicts — you vs. you
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 64,
          fontSize: 11.5,
          color: "color-mix(in srgb, var(--color-text) 30%, transparent)",
        }}
      >
        {bundle
          ? `reading ${bundle.laps.length} laps · ${bundle.session.track_name} · ${fmtDay(bundle.session.recorded_at)}`
          : "reading the session…"}
      </div>
    </div>
  );
}
