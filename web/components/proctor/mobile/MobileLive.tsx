"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, dim } from "@/lib/proctor/channels";
import { fmtLap, kmh, pct, toG } from "@/lib/proctor/format";
import { wrapIndex } from "@/lib/proctor/geometry";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

const SPEEDS = [1, 2, 4, 8] as const;

export default function MobileLive() {
  const { bundle, state, dispatch, traceA } = useProctor();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);

  const n = traceA?.speed.length ?? 0;
  const lapTime = traceA?.lap_time_s ?? 0;

  useEffect(() => {
    if (!playing || n === 0) return;
    const tick = (now: number) => {
      if (last.current != null) {
        const sweep = lapTime / state.speedMul;
        setIdx((v) => (v + (((now - last.current!) / 1000) * n) / sweep) % n);
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

  if (!bundle || !traceA) {
    return <div style={{ padding: "var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const i = wrapIndex(Math.round(idx), n);
  const percent = (i / (n - 1)) * 100;

  return (
    <div>
      <header style={{ padding: "var(--space-3) var(--space-6) var(--space-3)" }}>
        <h1 style={{ font: "500 24px var(--font-heading)", margin: 0 }}>Live trace</h1>
        <div style={{ fontSize: 12, color: dim(45), marginTop: 2 }}>
          lap {traceA.lap_number} · your reference lap
        </div>
      </header>

      <div style={{ padding: "0 var(--space-4)", height: 300 }}>
        <TrackMap
          x={bundle.map.x_m}
          y={bundle.map.y_m}
          w={360}
          h={300}
          pad={22}
          baseWidth={9}
          segWidth={3.6}
          speed={traceA.speed}
          car={i}
          trail={80}
          events={bundle.events.filter((e) => e.lap_number === traceA.lap_number)}
        />
      </div>

      <div
        style={{
          padding: "var(--space-2) var(--space-6) 0",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <button
          type="button"
          className="tap"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          style={{
            width: 46,
            height: 46,
            flex: "none",
            borderRadius: "50%",
            border: "1px solid var(--color-accent)",
            background: "transparent",
            color: CH.a,
            display: "grid",
            placeItems: "center",
          }}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 5, borderRadius: 3, background: dim(10), position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${percent}%`,
                borderRadius: 3,
                background: CH.a,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${percent}%`,
                top: -4,
                width: 13,
                height: 13,
                marginLeft: -6.5,
                borderRadius: "50%",
                background: "var(--color-text)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="num" style={{ fontSize: 10.5, color: dim(42) }}>
              {percent.toFixed(0)}% of lap
            </span>
            <span style={{ fontSize: 10.5, color: dim(42) }}>
              {state.speedMul === 1
                ? `1× · ${fmtLap(lapTime)}`
                : `${(lapTime / state.speedMul).toFixed(0)} s a lap`}
            </span>
          </div>
        </div>

        <div className="seg" style={{ flex: "none" }}>
          {SPEEDS.map((m) => (
            <button
              key={m}
              type="button"
              className="seg-opt num"
              data-active={state.speedMul === m}
              onClick={() => dispatch({ t: "speedMul", mul: m })}
              style={{ fontSize: 11, padding: "6px 7px" }}
            >
              {m}×
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "var(--space-4) var(--space-6) 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "var(--space-2)",
        }}
      >
        {[
          { l: "speed", v: kmh(traceA.speed[i]), u: "km/h" },
          { l: "gear", v: String(traceA.gear[i]), u: "" },
          { l: "lateral", v: toG(traceA.lat_accel[i]), u: "g", c: CH.a },
        ].map((s) => (
          <Panel key={s.l} padding="var(--space-3)">
            <div
              style={{
                font: "500 9px var(--font-heading)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: dim(40),
              }}
            >
              {s.l}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 1 }}>
              <span className="num" style={{ font: "500 20px/1.1 var(--font-heading)", color: s.c ?? "var(--color-text)" }}>
                {s.v}
              </span>
              <span style={{ fontSize: 9.5, color: dim(35) }}>{s.u}</span>
            </div>
          </Panel>
        ))}
      </div>

      <div style={{ padding: "var(--space-3) var(--space-6) 0" }}>
        {[
          { l: "throttle", v: traceA.throttle[i], c: CH.gain },
          { l: "brake", v: traceA.brake[i], c: CH.loss },
        ].map((b) => (
          <div key={b.l} style={{ marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: dim(45) }}>
              <span>{b.l}</span>
              <span className="num">{pct(b.v)}%</span>
            </div>
            <div style={{ height: 9, borderRadius: 5, background: dim(8), overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct(b.v)}%`, borderRadius: 5, background: b.c }} />
            </div>
          </div>
        ))}
        <Caveat>{noteFor("live.sweep")}</Caveat>
      </div>
    </div>
  );
}
