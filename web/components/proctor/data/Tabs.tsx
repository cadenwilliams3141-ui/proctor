"use client";

/* The Data workspace's other readings: the sector table, scatter, histogram
 * and replay. Each reads the same LapSeries the lanes do. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import { LAP_COLORS, xsOf, type Axis } from "@/components/proctor/data/Lanes";
import Panel from "@/components/proctor/ui/Panel";
import Caveat from "@/components/proctor/ui/Caveat";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, INK, dim } from "@/lib/proctor/channels";
import { CHANNEL_BY_KEY, indexAt, interpAt, type ChannelDef, type LapSeries } from "@/lib/proctor/dataSeries";
import { fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";

// ─────────────────────────────────────────────────────────────────────────────
// Sector table: every lap, every corner segment, the best of each, stitched
// ─────────────────────────────────────────────────────────────────────────────

export function SectorTable({ selected, onToggle }: { selected: number[]; onToggle: (lap: number) => void }) {
  const { bundle } = useProctor();
  const seg = bundle?.segments;
  const cl = bundle?.cornerLaps;
  const rows = useMemo(() => {
    if (!seg) return null;
    const usable = new Map<string, boolean>();
    for (const c of cl?.corners ?? []) c.runs.lap.forEach((lap, i) => usable.set(`${lap}|${c.id}`, c.runs.usable[i]));
    const best = seg.corners.map((c, j) => {
      let b = Infinity;
      seg.laps.segment_s.forEach((row, r) => {
        const v = row[j];
        if (v != null && usable.get(`${seg.laps.lap[r]}|${c.id}`) !== false && v < b) b = v;
      });
      return Number.isFinite(b) ? b : null;
    });
    return { usable, best };
  }, [seg, cl]);
  if (!seg || !rows || seg.laps.lap.length === 0) {
    return <Caveat>Sector times need the corner model, which this session does not have.</Caveat>;
  }
  const theoretical = rows.best.every((b) => b != null) ? rows.best.reduce((s, b) => s + (b ?? 0), 0) : null;
  return (
    <Panel title="Sectors" sub="each corner's segment: brake zone, corner, exit and the straight after it"
      foot={<Caveat>Green is the fastest usable pass through each segment; greyed cells were left out of comparisons (off track, a tow, traffic, an incident). A segment that crosses the line includes the next lap&apos;s first metres. The bottom row stitches the best of each — optimistic by construction.</Caveat>}>
      <div style={{ overflowX: "auto" }}>
        <table className="num" style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr style={{ color: dim(45) }}>
              <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 500 }}>lap</th>
              {seg.corners.map((c) => (
                <th key={c.id} style={{ textAlign: "right", padding: "5px 8px", fontWeight: 500 }}>{c.name}</th>
              ))}
              <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 500 }}>sum</th>
            </tr>
          </thead>
          <tbody>
            {seg.laps.lap.map((lap, r) => {
              const row = seg.laps.segment_s[r];
              const sel = selected.indexOf(lap);
              const sum = row.every((v) => v != null) ? row.reduce((s, v) => s + (v ?? 0), 0) : null;
              return (
                <tr key={lap} className="lrow" onClick={() => onToggle(lap)}
                  style={{ borderTop: "1px solid var(--color-divider)" }}>
                  <td style={{ padding: "5px 8px", color: sel >= 0 ? LAP_COLORS[sel % LAP_COLORS.length] : undefined }}>
                    {lap}{sel >= 0 ? " ●" : ""}
                  </td>
                  {row.map((v, j) => {
                    const c = seg.corners[j];
                    const ok = rows.usable.get(`${lap}|${c.id}`) !== false;
                    const isBest = v != null && ok && rows.best[j] != null && Math.abs(v - (rows.best[j] as number)) < 1e-9;
                    return (
                      <td key={c.id} style={{ textAlign: "right", padding: "5px 8px",
                        color: !ok ? dim(32) : isBest ? CH.gain : undefined }}>
                        {v == null ? "—" : v.toFixed(3)}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right", padding: "5px 8px", color: dim(55) }}>{sum == null ? "—" : sum.toFixed(3)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "1px solid var(--color-divider)", color: CH.gain }}>
              <td style={{ padding: "6px 8px" }}>best</td>
              {rows.best.map((b, j) => (
                <td key={j} style={{ textAlign: "right", padding: "6px 8px" }}>{b == null ? "—" : b.toFixed(3)}</td>
              ))}
              <td style={{ textAlign: "right", padding: "6px 8px" }}>{theoretical == null ? "—" : fmtLap(theoretical)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scatter: any channel against any other — the g-g diagram by default
// ─────────────────────────────────────────────────────────────────────────────

function ChannelSelect({ value, options, onChange, label }: {
  value: string; options: ChannelDef[]; onChange: (v: string) => void; label: string;
}) {
  return (
    <label style={{ fontSize: 11.5, color: dim(55), display: "inline-flex", gap: 6, alignItems: "center" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-divider)",
          borderRadius: 6, padding: "4px 6px", fontSize: 12 }}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}{o.unit ? ` (${o.unit})` : ""}</option>
        ))}
      </select>
    </label>
  );
}

export function ScatterTab({ series, values, options, axis, range }: {
  series: LapSeries[];
  values: Record<string, (Float64Array | null)[]>;
  options: ChannelDef[];
  axis: Axis;
  range: [number, number];
}) {
  const has = (k: string) => options.some((o) => o.key === k);
  const [xk, setX] = useState(has("lat_g") ? "lat_g" : options[0]?.key ?? "speed");
  const [yk, setY] = useState(has("long_g") ? "long_g" : options[1]?.key ?? "speed");
  const pts = useMemo(() => {
    const out: { x: number; y: number; li: number }[] = [];
    series.forEach((s, li) => {
      const xv = values[xk]?.[li] ?? CHANNEL_BY_KEY[xk]?.compute(s, series[0] ?? null);
      const yv = values[yk]?.[li] ?? CHANNEL_BY_KEY[yk]?.compute(s, series[0] ?? null);
      if (!xv || !yv) return;
      const ax = xsOf(s, axis);
      const step = Math.max(1, Math.floor(s.n / 2500));
      for (let i = 0; i < s.n; i += step) {
        if (ax[i] < range[0] || ax[i] > range[1]) continue;
        if (Number.isFinite(xv[i]) && Number.isFinite(yv[i])) out.push({ x: xv[i], y: yv[i], li });
      }
    });
    return out;
  }, [series, values, xk, yk, axis, range]);
  const ext = (vs: number[]) => {
    const lo = Math.min(...vs), hi = Math.max(...vs);
    const p = (hi - lo || 1) * 0.06;
    return [lo - p, hi + p] as const;
  };
  const [x0, x1] = pts.length ? ext(pts.map((p) => p.x)) : [0, 1];
  const [y0, y1] = pts.length ? ext(pts.map((p) => p.y)) : [0, 1];
  const S = 520;
  const X = (v: number) => 40 + ((v - x0) / (x1 - x0 || 1)) * (S - 50);
  const Y = (v: number) => S - 30 - ((v - y0) / (y1 - y0 || 1)) * (S - 50);
  const xd = CHANNEL_BY_KEY[xk], yd = CHANNEL_BY_KEY[yk];
  return (
    <Panel title="Scatter" sub="every sample in the zoomed range, coloured by lap"
      right={<span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ChannelSelect label="x" value={xk} options={options} onChange={setX} />
        <ChannelSelect label="y" value={yk} options={options} onChange={setY} />
      </span>}>
      <svg viewBox={`0 0 ${S} ${S}`} style={{ width: "100%", maxWidth: 620, height: "auto", display: "block", margin: "0 auto" }}
        role="img" aria-label={`${yd?.label} against ${xd?.label}`}>
        {x0 < 0 && x1 > 0 && <line x1={X(0)} x2={X(0)} y1={20} y2={S - 30} stroke={INK.neutral700} />}
        {y0 < 0 && y1 > 0 && <line x1={40} x2={S - 10} y1={Y(0)} y2={Y(0)} stroke={INK.neutral700} />}
        {pts.map((p, i) => (
          <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={1.4} fill={LAP_COLORS[p.li % LAP_COLORS.length]} opacity={0.55} />
        ))}
        <text x={S / 2} y={S - 6} textAnchor="middle" fontSize={11} fill={INK.neutral500}>
          {xd?.label} {xd?.unit && `(${xd.unit})`} · {x0.toFixed(1)} … {x1.toFixed(1)}
        </text>
        <text x={12} y={S / 2} fontSize={11} fill={INK.neutral500} textAnchor="middle" transform={`rotate(-90 12 ${S / 2})`}>
          {yd?.label} {yd?.unit && `(${yd.unit})`} · {y0.toFixed(1)} … {y1.toFixed(1)}
        </text>
      </svg>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Histogram: how much of the TIME was spent at each value
// ─────────────────────────────────────────────────────────────────────────────

export function HistogramTab({ series, values, options, axis, range }: {
  series: LapSeries[];
  values: Record<string, (Float64Array | null)[]>;
  options: ChannelDef[];
  axis: Axis;
  range: [number, number];
}) {
  const [k, setK] = useState(options.some((o) => o.key === "throttle") ? "throttle" : options[0]?.key ?? "speed");
  const BINS = 20;
  const data = useMemo(() => {
    const per = series.map((s, li) => {
      const v = values[k]?.[li] ?? CHANNEL_BY_KEY[k]?.compute(s, series[0] ?? null);
      return { s, v };
    });
    let lo = Infinity, hi = -Infinity;
    for (const { s, v } of per) {
      if (!v) continue;
      const ax = xsOf(s, axis);
      for (let i = 0; i < s.n; i++) if (ax[i] >= range[0] && ax[i] <= range[1] && Number.isFinite(v[i])) {
        lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]);
      }
    }
    if (!Number.isFinite(lo)) return null;
    if (hi === lo) hi = lo + 1;
    const hists = per.map(({ s, v }) => {
      const h = new Array(BINS).fill(0);
      if (!v) return h;
      const ax = xsOf(s, axis);
      let total = 0;
      for (let i = 1; i < s.n; i++) {
        if (ax[i] < range[0] || ax[i] > range[1] || !Number.isFinite(v[i])) continue;
        const dt = Math.max(0, s.t[i] - s.t[i - 1]); // time-weighted, not sample-weighted
        const b = Math.min(BINS - 1, Math.floor(((v[i] - lo) / (hi - lo)) * BINS));
        h[b] += dt;
        total += dt;
      }
      return total > 0 ? h.map((x) => (x / total) * 100) : h;
    });
    return { lo, hi, hists, max: Math.max(...hists.flat(), 1) };
  }, [series, values, k, axis, range]);
  const def = CHANNEL_BY_KEY[k];
  const Wd = 900, Hd = 260;
  return (
    <Panel title="Histogram" sub="share of the time in the zoomed range spent at each value"
      right={<ChannelSelect label="channel" value={k} options={options} onChange={setK} />}
      foot={<Caveat>Weighted by time, not by sample, so a slow corner is not over-counted because the car spent more ticks in it.</Caveat>}>
      {data ? (
        <svg viewBox={`0 0 ${Wd} ${Hd}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
          aria-label={`time spent at each ${def?.label} value`}>
          {data.hists.map((h, li) => {
            const bw = (Wd - 40) / BINS;
            const sub = bw / Math.max(series.length, 1);
            return h.map((v, b) => {
              const hpx = (v / data.max) * (Hd - 40);
              return <rect key={`${li}-${b}`} x={30 + b * bw + li * sub} y={Hd - 25 - hpx} width={sub - 1} height={hpx}
                fill={LAP_COLORS[li % LAP_COLORS.length]} opacity={0.8} />;
            });
          })}
          <text x={30} y={Hd - 8} fontSize={11} fill={INK.neutral500}>{data.lo.toFixed(def?.dp ?? 1)}</text>
          <text x={Wd - 10} y={Hd - 8} fontSize={11} fill={INK.neutral500} textAnchor="end">
            {data.hi.toFixed(def?.dp ?? 1)} {def?.unit}
          </text>
          <text x={30} y={14} fontSize={11} fill={INK.neutral500}>{data.max.toFixed(0)}% of the time</text>
        </svg>
      ) : (
        <p style={{ fontSize: 12, color: dim(55) }}>No samples of this channel in the zoomed range.</p>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay: the laps run in their own time, side by side on the map
// ─────────────────────────────────────────────────────────────────────────────

const SPEEDS = [1, 2, 4] as const;

export function ReplayTab({ series, lengthM }: { series: LapSeries[]; lengthM: number }) {
  const { bundle } = useProctor();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mul, setMul] = useState<(typeof SPEEDS)[number]>(1);
  const last = useRef<number | null>(null);
  const tMax = Math.max(...series.map((s) => s.t[s.n - 1] ?? 0), 0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      setT((v) => {
        const nv = v + ((now - prev) / 1000) * mul;
        if (nv >= tMax) {
          setPlaying(false);
          return tMax;
        }
        return nv;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, mul, tMax]);

  if (!bundle || series.length === 0) return null;
  const n = bundle.map.x_m.length;
  const pos = series.map((s) => {
    const d = interpAt(s.t, s.d, t);
    return { d, idx: n > 1 ? (d / lengthM) * (n - 1) : 0, i: indexAt(s.t, t) };
  });
  const ref = series[0];
  const rows: { label: string; get: (s: LapSeries, i: number) => string }[] = [
    { label: "speed", get: (s, i) => `${((s.ch.speed?.[i] ?? NaN) * 3.6).toFixed(0)} km/h` },
    { label: "gear", get: (s, i) => (s.ch.gear ? String(Math.round(s.ch.gear[i])) : "—") },
    { label: "rpm", get: (s, i) => (s.ch.rpm ? Math.round(s.ch.rpm[i]).toString() : "—") },
    { label: "throttle", get: (s, i) => (s.ch.throttle ? `${Math.round(s.ch.throttle[i] * 100)}%` : "—") },
    { label: "brake", get: (s, i) => (s.ch.brake_raw ? `${Math.round(s.ch.brake_raw[i] * 100)}%` : "—") },
    { label: "steering", get: (s, i) => (s.ch.steer ? `${((s.ch.steer[i] * 180) / Math.PI).toFixed(0)}°` : "—") },
    {
      label: "behind lap " + ref.lap,
      // Distance-matched: how much later this lap reached the point it is at now.
      get: (s, i) => (s === ref ? "—" : `${(s.t[i] - interpAt(ref.d, ref.t, s.d[i])).toFixed(3)} s`),
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "var(--space-4)" }}>
      <Panel title="Replay" sub={`every lap in its own time — ${series[0].source === "samples" ? "60 Hz, the sim's own clock" : "time rebuilt from speed on the 1000-point grid"}`}>
        <div style={{ height: 340 }}>
          <TrackMap x={bundle.map.x_m} y={bundle.map.y_m} w={420} h={340} pad={18}
            car={pos[0]?.idx ?? null} trail={40}
            ghosts={pos.slice(1).map((p, k) => ({ index: p.idx, color: LAP_COLORS[(k + 1) % LAP_COLORS.length] }))} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "var(--space-3)" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play"} style={{ padding: "6px 10px" }}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { setT(0); setPlaying(false); }}
            aria-label="Back to the start" style={{ padding: "6px 10px" }}>
            <RotateCcw size={14} />
          </button>
          <input type="range" min={0} max={tMax} step={0.01} value={t} onChange={(e) => setT(Number(e.target.value))}
            style={{ flex: 1 }} aria-label="Time into the lap" />
          <span className="num" style={{ fontSize: 12, width: 64, textAlign: "right" }}>{t.toFixed(2)} s</span>
          <div className="seg">
            {SPEEDS.map((m) => (
              <button key={m} type="button" className="seg-opt" data-active={m === mul} onClick={() => setMul(m)}
                style={{ fontSize: 11 }}>{m}×</button>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="At this moment" sub="each lap where it was at the same time into its lap">
        <table className="num" style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
          <thead>
            <tr>
              <th />
              {series.map((s, li) => (
                <th key={s.lap} style={{ textAlign: "right", padding: "5px 8px", color: LAP_COLORS[li % LAP_COLORS.length], fontWeight: 500 }}>
                  lap {s.lap}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: "1px solid var(--color-divider)" }}>
                <td style={{ padding: "5px 8px", color: dim(55) }}>{r.label}</td>
                {series.map((s, li) => (
                  <td key={s.lap} style={{ textAlign: "right", padding: "5px 8px" }}>{r.get(s, pos[li].i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Caveat>A replay of where each car was, from its own recorded clock — not a re-simulation. Between two ticks, position is interpolated.</Caveat>
      </Panel>
    </div>
  );
}
