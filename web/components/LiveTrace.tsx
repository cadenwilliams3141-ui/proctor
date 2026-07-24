"use client";

/* Live trace tab: sweep one lap and watch the car move. At the current point on
   the lap it shows the car's position on the track map, the driver's inputs, and
   where the car sits on its own traction (g-g) envelope. The play control sweeps
   at a constant rate over track distance (the traces are distance-resampled, so
   this is a constant-distance sweep, not a real-time replay — labelled as such).
   All data is native: GPS path, pedal/steer channels, and lat/long acceleration. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LapRow, TraceRow } from "@/lib/types";
import TrackMap, { type SlipMarker } from "@/components/TrackMap";
import ResizablePanel from "@/components/ResizablePanel";
import type { Tier } from "@/lib/tier";

type Loose = Record<string, any>;
const G = 9.81;
const SWEEP_SECONDS = 9; // one full-lap distance sweep at play speed

function fmtLap(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export default function LiveTrace({ sessionId }: { sessionId: string; tier: Tier }) {
  const [data, setData] = useState<Loose | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const [trace, setTrace] = useState<TraceRow | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/session/${sessionId}/data`)
      .then((r) => r.json())
      .then((d: Loose) => {
        setData(d);
        const laps: LapRow[] = d.laps ?? [];
        const ref = d.metrics?.delta_time?.reference_lap;
        const clean = laps
          .filter((l) => l.is_valid && l.lap_time_s != null)
          .sort((a, b) => a.lap_time_s! - b.lap_time_s!);
        setLap(typeof ref === "number" ? ref : clean[0]?.lap_number ?? laps[0]?.lap_number ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [sessionId]);

  useEffect(() => {
    if (lap == null) return;
    setTrace(null);
    setI(0);
    fetch(`/api/session/${sessionId}/traces?laps=${lap}`)
      .then((r) => r.json())
      .then((d: { traces: TraceRow[] }) => setTrace(d.traces?.[0] ?? null))
      .catch((e) => setError(String(e)));
  }, [sessionId, lap]);

  // Constant-distance play loop: advance the index by wall-clock time.
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !trace) return;
    const n = trace.speed?.length ?? 1000;
    const tick = (t: number) => {
      if (last.current != null) {
        const dt = (t - last.current) / 1000;
        setI((prev) => {
          const next = prev + (dt * n) / SWEEP_SECONDS;
          return next >= n - 1 ? 0 : next;
        });
      }
      last.current = t;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = null;
    };
  }, [playing, trace]);

  const events: SlipMarker[] = useMemo(() => {
    const lw = data?.metrics?.lockup_wheelspin;
    if (!lw || lap == null) return [];
    const pick = (arr: Loose[] | undefined, kind: "lockup" | "wheelspin"): SlipMarker[] =>
      (arr ?? [])
        .filter((e) => Number(e.lap) === lap)
        .map((e) => ({
          start_pct: Number(e.start_pct),
          kind,
          wheels: e.wheels,
          peak_slip_ratio: Number(e.peak_slip_ratio),
          lap: Number(e.lap),
        }));
    return [...pick(lw.lockups, "lockup"), ...pick(lw.wheelspin, "wheelspin")];
  }, [data, lap]);

  const setIndex = useCallback((v: number) => {
    setPlaying(false);
    setI(v);
  }, []);

  if (error) return <p className="pos">failed to load: {error}</p>;
  if (!data) return <p style={{ color: "var(--muted)" }}>loading…</p>;

  const laps: LapRow[] = data.laps ?? [];
  const metrics: Loose = data.metrics ?? {};
  const idx = Math.round(i);
  const n = trace?.speed?.length ?? 1000;
  const pct = n > 1 ? (idx / (n - 1)) * 100 : 0;

  const val = (arr: number[] | null | undefined, def = 0) =>
    arr && idx < arr.length ? Number(arr[idx]) : def;

  const speedMs = val(trace?.speed);
  const latG = val(trace?.lat_accel) / G;
  const longG = val(trace?.long_accel) / G;

  return (
    <>
      <h1>Live trace</h1>
      <div className="panel">
        lap{" "}
        <select value={lap ?? ""} onChange={(e) => setLap(Number(e.target.value))}>
          {laps.map((l) => (
            <option key={l.lap_number} value={l.lap_number}>
              lap {l.lap_number} — {fmtLap(l.lap_time_s)}
              {l.is_valid ? "" : " (invalid)"}
              {l.is_anomalous ? " (anomalous)" : ""}
            </option>
          ))}
        </select>{" "}
        <button onClick={() => setPlaying((p) => !p)} disabled={!trace}>
          {playing ? "⏸ pause" : "▶ play"}
        </button>{" "}
        <span className="mono" style={{ color: "var(--muted)" }}>
          {pct.toFixed(1)}% of lap
        </span>
        <div style={{ marginTop: 10 }}>
          <input
            type="range"
            min={0}
            max={n - 1}
            value={idx}
            onChange={(e) => setIndex(Number(e.target.value))}
            style={{ width: "100%" }}
            disabled={!trace}
          />
        </div>
        <p className="caveat">
          Play sweeps at a constant rate over track distance — a constant-distance
          sweep, not a real-time replay (traces are distance-resampled).
        </p>
      </div>

      {!trace && <p style={{ color: "var(--muted)" }}>loading trace…</p>}

      {trace && (
        <>
          <div className="grid2">
            <ResizablePanel id="live-map">
              <h3>Track map</h3>
              <TrackMap
                map={metrics.track_map}
                speed={trace.speed.map(Number)}
                corners={metrics.corner_sections?.corners ?? []}
                events={events}
                carIndex={idx}
              />
              <p className="caveat">
                native GPS path, colored by speed · white dot = car position ·
                markers show lockups (red) & wheelspin (amber) on this lap
              </p>
            </ResizablePanel>

            <ResizablePanel id="live-traction">
              <h3>Traction — where the car is being pushed</h3>
              <LiveTractionCircle payload={metrics.traction_circle} latG={latG} longG={longG} />
              <p className="caveat">
                the dot is the car&apos;s current g-g point inside your own session
                envelope — not a physics limit
              </p>
            </ResizablePanel>
          </div>

          <ResizablePanel id="live-inputs">
            <h3>Inputs at this point</h3>
            <InputBars
              throttle={val(trace.throttle)}
              brake={val(trace.brake)}
              steerRad={val(trace.steer)}
              gear={val(trace.gear)}
              rpm={val(trace.rpm)}
              speedMs={speedMs}
            />
          </ResizablePanel>
        </>
      )}
    </>
  );
}

function Bar({ label, pct, color, text }: { label: string; pct: number; color: string; text: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
        <span>{label}</span>
        <span className="mono">{text}</span>
      </div>
      <div style={{ background: "#0d1117", border: "1px solid var(--border)", borderRadius: 4, height: 12 }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function InputBars({ throttle, brake, steerRad, gear, rpm, speedMs }: {
  throttle: number; brake: number; steerRad: number; gear: number; rpm: number; speedMs: number;
}) {
  const steerDeg = (steerRad * 180) / Math.PI;
  // Steering indicator: center line with a dot offset by the wheel angle,
  // clamped to ±180° of visual travel.
  const steerFrac = Math.max(-1, Math.min(1, steerDeg / 180));
  const gearLabel = gear <= 0 ? (gear < 0 ? "R" : "N") : String(Math.round(gear));

  return (
    <div className="grid2">
      <div>
        <Bar label="throttle" pct={throttle * 100} color="var(--good)" text={`${(throttle * 100).toFixed(0)}%`} />
        <Bar label="brake" pct={brake * 100} color="var(--bad)" text={`${(brake * 100).toFixed(0)}%`} />
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
            <span>steering</span>
            <span className="mono">{steerDeg.toFixed(0)}°</span>
          </div>
          <div style={{ position: "relative", height: 12, background: "#0d1117", border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
            <div style={{
              position: "absolute", top: 1, height: 8, width: 8, borderRadius: "50%", background: "var(--accent)",
              left: `calc(${50 + steerFrac * 50}% - 4px)`,
            }} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "center", justifyContent: "center" }}>
        <span className="stat"><span className="v">{gearLabel}</span><br /><span className="l">gear</span></span>
        <span className="stat"><span className="v mono">{Math.round(rpm)}</span><br /><span className="l">rpm</span></span>
        <span className="stat"><span className="v mono">{(speedMs * 3.6).toFixed(0)}</span><br /><span className="l">km/h</span></span>
      </div>
    </div>
  );
}

function LiveTractionCircle({ payload, latG, longG }: { payload: Loose | undefined; latG: number; longG: number }) {
  if (!payload || payload.insufficient_data) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(payload?.reason ?? "traction envelope not computed for this session")}
      </p>
    );
  }
  const envelope: { angle_deg: number; g: number | null }[] = payload.envelope ?? [];
  const W = 360, C = W / 2;
  const maxG = Math.max(1.0, Math.hypot(latG, longG), ...envelope.map((e) => (typeof e.g === "number" ? e.g : 0)));
  const scale = (W / 2 - 26) / maxG;
  const px = (lat: number) => C + lat * scale;
  const py = (lon: number) => C - lon * scale;

  const envPoints = envelope
    .filter((e) => typeof e.g === "number")
    .map((e) => {
      const rad = (e.angle_deg * Math.PI) / 180;
      return `${px(e.g! * Math.cos(rad))},${py(e.g! * Math.sin(rad))}`;
    })
    .join(" ");

  const rings = [];
  for (let g = 0.5; g <= maxG; g += 0.5) {
    rings.push(<circle key={g} cx={C} cy={C} r={g * scale} fill="none" stroke="#21262d" strokeWidth={1} />);
  }

  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ width: "100%", height: "auto", maxWidth: 360 }}>
      {rings}
      <line x1={C} y1={10} x2={C} y2={W - 10} stroke="#21262d" />
      <line x1={10} y1={C} x2={W - 10} y2={C} stroke="#21262d" />
      <text x={C + 4} y={16} fill="#8b949e" fontSize={10}>accel</text>
      <text x={C + 4} y={W - 8} fill="#8b949e" fontSize={10}>brake</text>
      <text x={12} y={C - 6} fill="#8b949e" fontSize={10}>left</text>
      <text x={W - 34} y={C - 6} fill="#8b949e" fontSize={10}>right</text>
      {envPoints && <polygon points={envPoints} fill="none" stroke="#f0883e" strokeWidth={1.6} />}
      <circle cx={px(latG)} cy={py(longG)} r={6} fill="#e6edf3" stroke="#0d1117" strokeWidth={1} />
      <text x={12} y={W - 8} fill="#8b949e" fontSize={10}>
        {Math.hypot(latG, longG).toFixed(2)} g
      </text>
    </svg>
  );
}
