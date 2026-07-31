"use client";

/* Live trace — a constant-distance sweep of the reference lap.
 *
 * ┌ THE LABEL HAS TO STAY TRUE ─────────────────────────────────────────────┐
 * │ This is NOT a real-time replay, even at 1x. The traces are distance-    │
 * │ resampled, so wall-clock elapsed time matches the lap time but the car  │
 * │ does not decelerate where the driver decelerated. The UI says exactly   │
 * │ that, in those words.                                                   │
 * │                                                                         │
 * │ To make it a genuine replay the parser must keep the original time base │
 * │ alongside the distance grid, and playback must advance by TIME index    │
 * │ rather than distance index. Until then: do not relabel this a replay.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `liveIdx` is deliberately local state rather than store state. At 60fps a
 * store update would re-render the whole app and restart every CSS entrance
 * animation on screen; here it re-renders one screen. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtLap, kmh, pct, toG } from "@/lib/proctor/format";
import { wrapIndex } from "@/lib/proctor/geometry";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

const SPEEDS = [1, 2, 4, 8] as const;
const STORAGE_KEY = "proctor-speed-mul";

export default function LiveScreen() {
  const { bundle, state, dispatch, traceA } = useProctor();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const scrub = useRef<HTMLDivElement>(null);

  // The choice persists — it is a preference about how you like to watch, not
  // a per-visit decision.
  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (SPEEDS.includes(saved as (typeof SPEEDS)[number])) {
      dispatch({ t: "speedMul", mul: saved as 1 | 2 | 4 | 8 });
    }
  }, [dispatch]);

  const n = traceA?.speed.length ?? 0;
  const lapTime = traceA?.lap_time_s ?? 0;

  useEffect(() => {
    if (!playing || n === 0) return;
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) / 1000;
        // sweepSeconds is the lap's OWN time divided by the multiplier, so 1x
        // takes as long as the lap did rather than some fixed duration.
        const sweep = lapTime / state.speedMul;
        setIdx((v) => (v + (dt * n) / sweep) % n);
      }
      last.current = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      last.current = null;
    };
  }, [playing, n, lapTime, state.speedMul]);

  const onScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = scrub.current?.getBoundingClientRect();
      if (!r || n === 0) return;
      setPlaying(false);
      setIdx(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (n - 1));
    },
    [n],
  );

  if (!bundle || !traceA) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const i = wrapIndex(Math.round(idx), n);
  const percent = ((i / (n - 1)) * 100).toFixed(1);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Control bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-4) var(--space-6) var(--space-3)",
          flex: "none",
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setPlaying((p) => !p)}
          style={{ flex: "none", fontSize: 12.5 }}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause" : "Play"}
        </button>

        <span style={{ fontSize: 12.5, color: dim(60), flex: "none" }}>
          lap {traceA.lap_number}
        </span>

        <div
          ref={scrub}
          onPointerDown={onScrub}
          style={{ flex: 1, minWidth: 0, height: 20, display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          <div style={{ position: "relative", width: "100%", height: 4, borderRadius: 2, background: dim(10) }}>
            <div
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${percent}%`,
                borderRadius: 2,
                background: "var(--ch-a)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${percent}%`,
                top: -4,
                width: 12,
                height: 12,
                marginLeft: -6,
                borderRadius: "50%",
                background: "var(--color-text)",
                boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-accent) 30%, transparent)",
              }}
            />
          </div>
        </div>

        <span className="num" style={{ fontSize: 11.5, color: dim(45), width: 46, flex: "none" }}>
          {percent}%
        </span>

        <div className="seg" style={{ flex: "none" }}>
          {SPEEDS.map((m) => (
            <button
              key={m}
              type="button"
              className="seg-opt num"
              data-active={state.speedMul === m}
              onClick={() => {
                dispatch({ t: "speedMul", mul: m });
                localStorage.setItem(STORAGE_KEY, String(m));
              }}
              style={{ fontSize: 11, padding: "4px 9px" }}
            >
              {m}×
            </button>
          ))}
        </div>

        <span style={{ fontSize: 10.5, color: dim(40), flex: "none", width: 190 }}>
          {state.speedMul === 1
            ? `1× takes as long as the lap did — ${fmtLap(lapTime)}`
            : `${(lapTime / state.speedMul).toFixed(0)} s for the full lap`}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "var(--space-3)",
          padding: "0 var(--space-6) var(--space-6)",
        }}
      >
        <Panel
          title="Driven line"
          sub={`brightness = speed · trail is the last ${TRAIL} samples`}
          padding="var(--space-3)"
          style={{ minHeight: 0 }}
          foot={<Caveat>{noteFor("live.sweep")}</Caveat>}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <TrackMap
              x={bundle.map.x_m}
              y={bundle.map.y_m}
              w={560}
              h={430}
              speed={traceA.speed}
              apexes={bundle.corners}
              events={bundle.events.filter((e) => e.lap_number === traceA.lap_number)}
              car={i}
              trail={TRAIL}
            />
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0 }}>
          <GGPanel i={i} />
          <Readouts i={i} />
        </div>
      </div>
    </div>
  );
}

const TRAIL = 90;

function GGPanel({ i }: { i: number }) {
  const { bundle, traceA } = useProctor();

  const geom = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (150 - 26) / maxG;
    const X = (lat: number) => 150 + lat * s;
    const Y = (lon: number) => 150 - lon * s;
    const rings: number[] = [];
    for (let g = 0.5; g <= maxG; g += 0.5) rings.push(g * s);
    const poly = bundle.traction.envelope
      .map((e) => {
        const r = (e.angle_deg * Math.PI) / 180;
        return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
      })
      .join(" ");
    return { X, Y, rings, poly };
  }, [bundle]);

  if (!bundle || !traceA || !geom) return null;

  const n = traceA.speed.length;
  const trail: string[] = [];
  for (let k = 70; k >= 0; k--) {
    const j = wrapIndex(i - k, n);
    trail.push(
      `${geom.X(traceA.lat_accel[j] / 9.81).toFixed(1)},${geom.Y(traceA.long_accel[j] / 9.81).toFixed(1)}`,
    );
  }
  const cx = geom.X(traceA.lat_accel[i] / 9.81);
  const cy = geom.Y(traceA.long_accel[i] / 9.81);

  return (
    <Panel
      title="Grip you demonstrated"
      padding="var(--space-3)"
      style={{ flex: "none" }}
      foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}
    >
      <svg viewBox="0 0 300 300" style={{ width: "100%", height: 250, display: "block" }} aria-hidden>
        {geom.rings.map((r, k) => (
          <circle key={k} cx={150} cy={150} r={r} fill="none" stroke={inkA(0.07)} />
        ))}
        <line x1={150} y1={14} x2={150} y2={286} stroke={inkA(0.07)} />
        <line x1={14} y1={150} x2={286} y2={150} stroke={inkA(0.07)} />
        <polygon points={geom.poly} fill="rgba(145,132,217,.07)" stroke={INK.accent2_700} strokeWidth={1.4} />
        <polyline points={trail.join(" ")} fill="none" stroke={CH.a} strokeWidth={1.2} opacity={0.5} />
        <circle cx={cx} cy={cy} r={10} fill={CH.a} opacity={0.22} />
        <circle cx={cx} cy={cy} r={4.6} fill={INK.text} />
        <text x={154} y={20} fill={inkA(0.34)} fontSize={9}>
          accelerating
        </text>
        <text x={154} y={294} fill={inkA(0.34)} fontSize={9}>
          braking
        </text>
        <text x={16} y={144} fill={inkA(0.34)} fontSize={9}>
          left
        </text>
        <text x={262} y={144} fill={inkA(0.34)} fontSize={9}>
          right
        </text>
      </svg>
    </Panel>
  );
}

function Readouts({ i }: { i: number }) {
  const { traceA } = useProctor();
  if (!traceA) return null;

  const maxSteer = Math.max(...traceA.steer.map(Math.abs), 1e-6);
  const steerPct = (traceA.steer[i] / maxSteer) * 50;

  return (
    <Panel fill padding="var(--space-4)" style={{ minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3) var(--space-4)" }}>
        {[
          { l: "speed", v: kmh(traceA.speed[i]), u: "km/h" },
          { l: "gear", v: String(traceA.gear[i]), u: "" },
          { l: "engine", v: String(traceA.rpm[i]), u: "rpm" },
          { l: "lateral", v: toG(traceA.lat_accel[i]), u: "g", c: CH.a },
        ].map((r) => (
          <div key={r.l}>
            <div
              style={{
                font: "500 9px var(--font-heading)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: dim(40),
              }}
            >
              {r.l}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span className="num" style={{ font: `500 22px/1.1 var(--font-heading)`, color: r.c ?? "var(--color-text)" }}>
                {r.v}
              </span>
              <span style={{ fontSize: 9.5, color: dim(35) }}>{r.u}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {[
          { l: "throttle", v: traceA.throttle[i], c: CH.gain },
          { l: "brake", v: traceA.brake[i], c: CH.loss },
        ].map((b) => (
          <div key={b.l}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: dim(45) }}>
              <span>{b.l}</span>
              <span className="num">{pct(b.v)}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: dim(8), overflow: "hidden", marginTop: 2 }}>
              <div style={{ height: "100%", width: `${pct(b.v)}%`, borderRadius: 4, background: b.c }} />
            </div>
          </div>
        ))}

        <div style={{ marginTop: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: dim(45) }}>
            <span>steering</span>
            <span className="num">{fixed((traceA.steer[i] * 180) / Math.PI, 1)}°</span>
          </div>
          <div style={{ position: "relative", height: 8, borderRadius: 4, background: dim(8), marginTop: 2 }}>
            <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: dim(20) }} />
            <span
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                borderRadius: 4,
                background: CH.a,
                left: steerPct >= 0 ? "50%" : `${50 + steerPct}%`,
                width: `${Math.abs(steerPct).toFixed(1)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
