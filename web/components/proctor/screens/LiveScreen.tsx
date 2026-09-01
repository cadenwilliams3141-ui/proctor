"use client";

/* Live trace — the lap played back in the time it actually took.
 *
 * ┌ WHAT CHANGED, AND WHY IT MATTERS ───────────────────────────────────────┐
 * │ This screen used to advance one distance sample per tick of the clock.  │
 * │ The traces are resampled to even spacing in DISTANCE, so that put the   │
 * │ car round the lap at a single constant speed — inching down the         │
 * │ straights and rocketing through the slow corners. The timing was not    │
 * │ slightly off; it was inverted.                                          │
 * │                                                                         │
 * │ It now advances WALL-CLOCK TIME and asks lib/proctor/timebase where the │
 * │ car was at that moment. The time base is the integral of the recorded   │
 * │ speed along the distance grid, normalised onto the recorded lap time,   │
 * │ so at 1x the marker reaches every point of the circuit at the moment    │
 * │ the driver reached it and the lap takes exactly as long as it did.      │
 * │                                                                         │
 * │ It is a replay of WHERE THE CAR WAS, not a re-simulation. Between two   │
 * │ stored samples the position is interpolated, and the screen says so.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `t` is deliberately local state rather than store state. At 60fps a store
 * update would re-render the whole app and restart every CSS entrance
 * animation on screen; here it re-renders one screen. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtLap, kmh, pct, toG } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import NotDrawable from "@/components/proctor/ui/NotDrawable";
import { derivePlaybackReadiness } from "@/lib/proctor/readiness";
import { useProctor } from "@/lib/proctor/store";
import { buildTimebase, sampleAt, stepAt } from "@/lib/proctor/timebase";

const SPEEDS = [1, 2, 4, 8] as const;
const STORAGE_KEY = "proctor-speed-mul";
/** Trail length in SECONDS, not samples. A fixed sample count draws a long tail
 *  on a straight and a stub through a hairpin, because the samples are evenly
 *  spaced in distance — the same mistake in miniature that the sweep had. */
const TRAIL_S = 1.6;

export default function LiveScreen() {
  const { bundle, state, dispatch, traceA, error, referenceLap } = useProctor();
  const [t, setT] = useState(0);
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

  const tb = useMemo(() => (traceA ? buildTimebase(traceA) : null), [traceA]);
  const lapTime = tb?.lapTime ?? 0;

  // A different lap starts at its own beginning rather than at the elapsed time
  // of the lap before it, which would land somewhere arbitrary.
  useEffect(() => {
    setT(0);
  }, [traceA?.lap_number]);

  useEffect(() => {
    if (!playing || lapTime <= 0) return;
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = ((now - last.current) / 1000) * state.speedMul;
        setT((v) => (v + dt) % lapTime);
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
  }, [playing, lapTime, state.speedMul]);

  const onScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = scrub.current?.getBoundingClientRect();
      if (!r || lapTime <= 0) return;
      setPlaying(false);
      setT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * lapTime);
    },
    [lapTime],
  );

  /* Not "Reading…" for everything. A session with no clean lap never seats a
     lap A, so traceA stays null forever and the old guard promised a load that
     could not arrive. Same rule the four comparison views already follow. */
  const readiness = derivePlaybackReadiness({
    error,
    lapCount: bundle ? bundle.laps.length : null,
    referenceLap,
    lapA: state.lapA,
    traceA,
  });
  if (readiness.state !== "ready" || !bundle || !traceA || !tb) {
    return <NotDrawable readiness={readiness.state === "ready" ? { state: "loading" } : readiness} />;
  }

  const n = traceA.speed.length;
  const idx = tb.indexAt(t);
  // The scrub bar is a TIME bar. Filling it by distance would put the handle
  // three-quarters along while only half the lap had elapsed.
  const timePct = lapTime > 0 ? (t / lapTime) * 100 : 0;
  const distPct = n > 1 ? (idx / (n - 1)) * 100 : 0;
  // How many samples the trail covers depends on how fast the car is going
  // right here, which is the whole point of measuring it in seconds.
  const trailSamples = Math.max(4, Math.round(idx - tb.indexAt(Math.max(0, t - TRAIL_S))));

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Control bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-4) var(--space-6) var(--space-3)",
          flex: "none",
          // The scrubber, the two readouts and the speed control are all fixed
          // width; on a narrow window they ran off the edge and took the speed
          // control with them. Wrapping costs a row of height and keeps every
          // control reachable.
          flexWrap: "wrap",
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
        <button
          type="button"
          className="pk"
          title="Back to the start of the lap"
          aria-label="Back to the start of the lap"
          onClick={() => setT(0)}
          style={{
            flex: "none",
            border: 0,
            background: "transparent",
            color: dim(45),
            display: "grid",
            placeItems: "center",
            width: 30,
            height: 30,
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          <RotateCcw size={14} />
        </button>

        <span className="num" style={{ fontSize: 12.5, color: dim(60), flex: "none", width: 108 }}>
          {fmtLap(t)} <span style={{ color: dim(35) }}>/ {fmtLap(lapTime)}</span>
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
                width: `${timePct}%`,
                borderRadius: 2,
                background: "var(--ch-a)",
              }}
            />
            {/* Where the car is round the LAP, against where it is in TIME. The
                two only line up on a circuit driven at a constant speed, and
                the gap between them is exactly what this screen was getting
                wrong before. */}
            <div
              title="how far round the lap the car is"
              style={{
                position: "absolute",
                left: `${distPct}%`,
                top: -3,
                width: 2,
                height: 10,
                marginLeft: -1,
                background: CH.b,
                opacity: 0.75,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${timePct}%`,
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

        {/* Two different answers to "where is the car", both true, and until now
            neither was labelled: the handle is how far through the LAP TIME you
            are, the tick is how far round the ROAD the car has got. They only
            coincide at a constant speed, so on any real circuit they sit apart
            and the readout below disagreed with the handle for no stated
            reason. Naming them is the whole fix — the numbers were right. */}
        <span
          className="num"
          style={{
            fontSize: 11,
            color: dim(42),
            // Wide enough that "through the time" does not wrap onto a third
            // line; the row wraps as a whole below ~1080px instead.
            width: 158,
            flex: "none",
            lineHeight: 1.35,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: CH.b }}>▏</span> {distPct.toFixed(1)}%{" "}
          <span style={{ color: dim(30) }}>round the lap</span>
          <br />
          <span style={{ color: dim(55) }}>●</span> {timePct.toFixed(1)}%{" "}
          <span style={{ color: dim(30) }}>through the time</span>
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

        <span style={{ fontSize: 10.5, color: dim(40), flex: "none", width: 168, lineHeight: 1.35 }}>
          {state.speedMul === 1
            ? `real time — ${fmtLap(lapTime)}, the lap's own time`
            : `${state.speedMul}× real time · ${(lapTime / state.speedMul).toFixed(1)} s a lap`}
        </span>
      </div>

      <div
        className="live-split"
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: "var(--space-3)",
          padding: "0 var(--space-6) var(--space-6)",
        }}
      >
        <Panel
          title="Driven line"
          sub="brightness = speed · the trail is the last 1.6 seconds"
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
              car={idx}
              trail={trailSamples}
            />
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0 }}>
          <GGPanel idx={idx} tb={tb} t={t} />
          <Readouts idx={idx} />
        </div>
      </div>
    </div>
  );
}

function GGPanel({
  idx,
  tb,
  t,
}: {
  idx: number;
  tb: ReturnType<typeof buildTimebase>;
  t: number;
}) {
  const { bundle, traceA } = useProctor();

  const geom = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (150 - 26) / maxG;
    const X = (lat: number) => 150 + lat * s;
    const Y = (lon: number) => 150 - lon * s;
    const rings: number[] = [];
    // Same spacing rule as the Rig screen's plot: never more than five rings,
    // or the labels pile up in the middle of a high-g session.
    const step = maxG <= 2.5 ? 0.5 : maxG <= 5 ? 1 : Math.ceil(maxG / 5);
    for (let g = step; g <= maxG; g += step) rings.push(g * s);
    const poly = bundle.traction.envelope
      .map((e) => {
        const r = (e.angle_deg * Math.PI) / 180;
        return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
      })
      .join(" ");
    return { X, Y, rings, poly };
  }, [bundle]);

  if (!bundle || !traceA || !geom) return null;

  /* The trail behind the dot is the last second of driving, sampled in TIME.
     Sampled by index it would sweep the g-g plot at a different rate depending
     on where the car was — fast where the samples are close in time, slow where
     they are far apart — which is the same distortion the map had. */
  const STEPS = 40;
  const WINDOW_S = 1.0;
  const trail: string[] = [];
  for (let k = STEPS; k >= 0; k--) {
    const at = tb.indexAt(Math.max(0, t - (WINDOW_S * k) / STEPS));
    trail.push(
      `${geom.X(sampleAt(traceA.lat_accel, at) / 9.81).toFixed(1)},${geom
        .Y(sampleAt(traceA.long_accel, at) / 9.81)
        .toFixed(1)}`,
    );
  }
  const cx = geom.X(sampleAt(traceA.lat_accel, idx) / 9.81);
  const cy = geom.Y(sampleAt(traceA.long_accel, idx) / 9.81);

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

function Readouts({ idx }: { idx: number }) {
  const { traceA } = useProctor();
  if (!traceA) return null;

  const maxSteer = Math.max(...traceA.steer.map(Math.abs), 1e-6);
  const steer = sampleAt(traceA.steer, idx);
  const steerPct = (steer / maxSteer) * 50;
  const throttle = sampleAt(traceA.throttle, idx);
  const brake = sampleAt(traceA.brake, idx);

  return (
    <Panel fill padding="var(--space-4)" style={{ minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "var(--space-3) var(--space-4)" }}>
        {[
          { l: "speed", v: kmh(sampleAt(traceA.speed, idx)), u: "km/h" },
          // Gear and rpm are stepped, not interpolated: there is no gear 3.4.
          { l: "gear", v: String(stepAt(traceA.gear, idx)), u: "" },
          { l: "engine", v: String(Math.round(sampleAt(traceA.rpm, idx))), u: "rpm" },
          { l: "lateral", v: toG(sampleAt(traceA.lat_accel, idx)), u: "g", c: CH.a },
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
          { l: "throttle", v: throttle, c: CH.gain },
          { l: "brake", v: brake, c: CH.loss },
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
            <span className="num">{fixed((steer * 180) / Math.PI, 1)}°</span>
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
