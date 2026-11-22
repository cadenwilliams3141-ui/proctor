"use client";

/* Data. The whole session at full detail, for when the report is not enough.
 *
 * Up to four laps, any channel, on a time or a distance axis; zoom by dragging
 * across the lanes or jump to a corner; a shared cursor with every lap's value
 * under it; a sector table with the best of each corner stitched; scatter,
 * histogram and replay; the racing line and the physics read-outs as tabs.
 *
 * It reads full-rate laps (every tick, ~37 channels) when the session stored
 * them, and the 1000-point grid otherwise — and always says which, because a
 * time axis rebuilt from speed is an estimate and must not pass for the clock.
 *
 * Absorbs the old Analyze (ribbon, map & delta), Live trace and Physics
 * screens; their ?screen= links land here on the matching tab. */

import { useEffect, useMemo, useRef, useState } from "react";

import Lanes, { LAP_COLORS, xsOf, type Axis } from "@/components/proctor/data/Lanes";
import { HistogramTab, ReplayTab, ScatterTab, SectorTable } from "@/components/proctor/data/Tabs";
import ForcesScreen from "@/components/proctor/screens/ForcesScreen";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import TrackMap from "@/components/proctor/ui/TrackMap";
import RacingLine from "@/components/proctor/views/RacingLine";
import { CH, dim } from "@/lib/proctor/channels";
import {
  CHANNEL_BY_KEY,
  availableChannels,
  fromSamples,
  fromTrace,
  interpAt,
  type LapSeries,
} from "@/lib/proctor/dataSeries";
import { data } from "@/lib/proctor/data-source";
import { fmtLap } from "@/lib/proctor/format";
import type { LapSamples } from "@/lib/proctor/samples";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";

export type DataTab = "traces" | "scatter" | "histogram" | "replay" | "line" | "physics";

const TABS: { id: DataTab; label: string }[] = [
  { id: "traces", label: "Traces" },
  { id: "scatter", label: "Scatter" },
  { id: "histogram", label: "Histogram" },
  { id: "replay", label: "Replay" },
  { id: "line", label: "Racing line" },
  { id: "physics", label: "Physics" },
];

const DEFAULT_CHANNELS = ["delta", "speed", "throttle", "brake_raw", "steer", "gear"];
const MAX_LAPS = 4;

export default function DataScreen({ initialTab = "traces" }: { initialTab?: DataTab }) {
  const { bundle, state, dispatch, ensureTraces, referenceLap } = useProctor();
  const [tab, setTab] = useState<DataTab>(initialTab);
  const [laps, setLaps] = useState<number[]>([]);
  const [axis, setAxis] = useState<Axis>("distance");
  const [channels, setChannels] = useState<string[]>(DEFAULT_CHANNELS);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [samples, setSamples] = useState<Record<number, LapSamples>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const asked = useRef(new Set<number>());

  useEffect(() => setTab(initialTab), [initialTab]);

  // Seed with the selected pair once the store has seated it.
  useEffect(() => {
    if (laps.length === 0 && state.lapA != null) {
      setLaps([state.lapA, state.lapB].filter((n): n is number => n != null));
    }
  }, [state.lapA, state.lapB, laps.length]);

  // Keep the store's A/B (read by the Racing line and Physics tabs) on the
  // first two laps here.
  useEffect(() => {
    if (laps[0] != null && laps[0] !== state.lapA) dispatch({ t: "lapA", lap: laps[0] });
    if (laps[1] != null && laps[1] !== state.lapB) dispatch({ t: "lapB", lap: laps[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps]);

  const sessionId = bundle ? String(bundle.session.id) : null;
  useEffect(() => {
    setSamples({});
    asked.current = new Set();
  }, [sessionId]);

  // Full-rate where stored, the grid otherwise.
  useEffect(() => {
    if (!bundle || !sessionId) return;
    const full = laps.filter((n) => bundle.laps.find((l) => l.lap_number === n)?.has_samples);
    const want = full.filter((n) => !(n in samples) && !asked.current.has(n));
    if (want.length) {
      want.forEach((n) => asked.current.add(n));
      data
        .loadSamples(sessionId, want)
        .then((ls) => setSamples((prev) => ({ ...prev, ...Object.fromEntries(ls.map((l) => [l.lap, l])) })))
        .catch((e) => setLoadErr(String(e?.message ?? e)));
    }
    ensureTraces(laps.filter((n) => !full.includes(n)));
  }, [laps, bundle, sessionId, samples, ensureTraces]);

  const lengthM = bundle?.segments?.length_m ?? (bundle?.session.track_length_km ?? 0) * 1000;

  const series: LapSeries[] = useMemo(() => {
    if (!bundle) return [];
    return laps
      .map((n) => {
        if (samples[n]) return fromSamples(samples[n]);
        const tr = bundle.traces[n];
        return tr && lengthM > 0 ? fromTrace(tr, lengthM) : null;
      })
      .filter((s): s is LapSeries => s != null);
  }, [laps, samples, bundle, lengthM]);

  const options = useMemo(() => availableChannels(series), [series]);
  const shown = channels.filter((k) => options.some((o) => o.key === k));

  const values = useMemo(() => {
    const ref = series[0] ?? null;
    const out: Record<string, (Float64Array | null)[]> = {};
    for (const k of new Set([...shown, "speed"])) {
      const def = CHANNEL_BY_KEY[k];
      if (def) out[k] = series.map((s) => def.compute(s, ref));
    }
    return out;
  }, [series, shown]);

  const full: [number, number] = useMemo(() => {
    let hi = 0;
    for (const s of series) {
      const xs = xsOf(s, axis);
      if (xs.length) hi = Math.max(hi, xs[xs.length - 1]);
    }
    return [0, hi || 1];
  }, [series, axis]);
  const range = zoom ?? full;

  useEffect(() => setZoom(null), [axis]);

  if (!bundle) return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;

  const pickable = bundle.laps.filter((l) => l.has_trace !== false || l.has_samples);
  const toggle = (n: number) =>
    setLaps((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : cur.length >= MAX_LAPS ? [...cur.slice(1), n] : [...cur, n]));
  const sources = new Set(series.map((s) => s.source));
  const waiting = laps.length > series.length;

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Eyebrow>laps</Eyebrow>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {pickable.map((l) => {
            const k = laps.indexOf(l.lap_number);
            const on = k >= 0;
            return (
              <button key={l.lap_number} type="button" className="pk" onClick={() => toggle(l.lap_number)}
                aria-pressed={on}
                title={`${fmtLap(l.lap_time_s)}${isUsable(l) ? "" : " · not a clean lap"}${l.lap_number === referenceLap ? " · your best clean lap" : ""}`}
                style={{
                  all: "unset", cursor: "pointer", padding: "4px 9px", borderRadius: 6, fontSize: 12,
                  border: `1px solid ${on ? LAP_COLORS[k % LAP_COLORS.length] : "var(--color-divider)"}`,
                  color: on ? LAP_COLORS[k % LAP_COLORS.length] : isUsable(l) ? dim(70) : dim(38),
                }}>
                {l.lap_number}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="Axis">
          {(["distance", "time"] as const).map((a) => (
            <button key={a} type="button" className="seg-opt" data-active={axis === a} onClick={() => setAxis(a)}
              style={{ fontSize: 11.5 }}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <Caveat>
        {laps.length === 0
          ? "Pick up to four laps. The first is the reference for the time delta."
          : `${sources.has("samples") ? "Full rate: every tick at the sim's 60 Hz, on its own clock." : ""}${
              sources.has("grid")
                ? ` ${sources.has("samples") ? "Some laps" : "These laps"} have only the 1000-point distance grid (ingested before full-rate storage); their time axis is rebuilt from speed — an estimate. Re-ingest from the rig for full rate.`
                : ""
            } Lap ${laps[0]} is the reference for the time delta.`}
        {loadErr ? ` Full-rate data could not be read: ${loadErr}.` : ""}
      </Caveat>

      <div className="seg" role="tablist" style={{ marginTop: "var(--space-4)", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="seg-opt"
            data-active={tab === t.id} onClick={() => setTab(t.id)} style={{ fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        {waiting && series.length === 0 && tab !== "physics" && tab !== "line" ? (
          <p style={{ color: dim(55), fontSize: 13 }}>Loading the selected laps…</p>
        ) : tab === "traces" ? (
          <TracesTab
            series={series} values={values} shown={shown} options={options} setChannels={setChannels}
            axis={axis} range={range} full={full} zoom={zoom} setZoom={setZoom} cursor={cursor} setCursor={setCursor}
            lengthM={lengthM} laps={laps} toggle={toggle}
          />
        ) : tab === "scatter" ? (
          <ScatterTab series={series} values={values} options={options} axis={axis} range={range} />
        ) : tab === "histogram" ? (
          <HistogramTab series={series} values={values} options={options} axis={axis} range={range} />
        ) : tab === "replay" ? (
          <ReplayTab series={series} lengthM={lengthM} />
        ) : tab === "line" ? (
          <RacingLine />
        ) : (
          <div style={{ display: "flex", minHeight: 600 }}>
            <ForcesScreen />
          </div>
        )}
      </div>
    </div>
  );
}

function TracesTab({
  series, values, shown, options, setChannels, axis, range, full, zoom, setZoom, cursor, setCursor, lengthM, laps, toggle,
}: {
  series: LapSeries[];
  values: Record<string, (Float64Array | null)[]>;
  shown: string[];
  options: ReturnType<typeof availableChannels>;
  setChannels: (f: (c: string[]) => string[]) => void;
  axis: Axis;
  range: [number, number];
  full: [number, number];
  zoom: [number, number] | null;
  setZoom: (z: [number, number] | null) => void;
  cursor: number | null;
  setCursor: (x: number | null) => void;
  lengthM: number;
  laps: number[];
  toggle: (n: number) => void;
}) {
  const { bundle } = useProctor();
  if (!bundle) return null;
  const n = bundle.map.x_m.length;
  const ref = series[0];
  // Map positions follow the reference lap; on a time axis, where IT was then.
  const dAt = (x: number) => (!ref ? 0 : axis === "distance" ? x : interpAt(ref.t, ref.d, x));
  const toIdx = (d: number) => (lengthM > 0 && n > 1 ? (d / lengthM) * (n - 1) : 0);
  const zr = zoom ? { from: Math.floor(toIdx(dAt(zoom[0]))), to: Math.ceil(toIdx(dAt(zoom[1]))) } : null;
  const seg = bundle.segments;

  const zoomToCorner = (cid: number) => {
    const c = seg?.corners.find((x) => x.id === cid);
    if (!c || !ref) return;
    const a = c.seg_start_m;
    const b = Math.min(c.seg_end_m, lengthM);
    if (axis === "distance") setZoom([a, b]);
    else setZoom([interpAt(ref.d, ref.t, a), interpAt(ref.d, ref.t, b)]);
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 300px)", gap: "var(--space-4)" }}
        className="data-traces">
        <Panel
          title={`${shown.length} channels against ${axis}`}
          sub={zoom ? "drag to zoom further · double-click to zoom out" : "drag across the lanes to zoom"}
          right={zoom ? (
            <button type="button" className="btn btn-secondary" onClick={() => setZoom(null)} style={{ padding: "3px 8px", fontSize: 11 }}>
              whole lap
            </button>
          ) : null}>
          {series.length ? (
            <Lanes series={series} values={values} channels={shown} axis={axis} range={range}
              cursor={cursor} onCursor={setCursor} onZoom={setZoom} />
          ) : (
            <p style={{ fontSize: 12, color: dim(55) }}>Pick a lap above.</p>
          )}
          <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: dim(42), marginTop: 4 }}>
            <span>{range[0].toFixed(axis === "distance" ? 0 : 2)} {axis === "distance" ? "m" : "s"}</span>
            <span>{range[1].toFixed(axis === "distance" ? 0 : 2)} {axis === "distance" ? "m" : "s"} · lap {full[1].toFixed(axis === "distance" ? 0 : 2)}</span>
          </div>
        </Panel>

        <div style={{ display: "grid", gap: "var(--space-4)", alignContent: "start" }}>
          <Panel title="Where">
            <div style={{ height: 200 }}>
              <TrackMap x={bundle.map.x_m} y={bundle.map.y_m} w={280} h={200} pad={14} baseWidth={7}
                highlight={zr ? { ...zr, color: CH.a } : null}
                car={cursor != null && ref ? toIdx(dAt(cursor)) : null} trail={0} />
            </div>
            {seg && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {seg.corners.map((c) => (
                  <button key={c.id} type="button" className="pk" onClick={() => zoomToCorner(c.id)}
                    style={{ all: "unset", cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 11.5,
                      border: "1px solid var(--color-divider)" }}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </Panel>
          <Panel title={cursor == null ? "At the cursor" : `At ${cursor.toFixed(axis === "distance" ? 0 : 2)} ${axis === "distance" ? "m" : "s"}`}>
            <table className="num" style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
              <tbody>
                {shown.map((k) => {
                  const def = CHANNEL_BY_KEY[k];
                  return (
                    <tr key={k} style={{ borderTop: "1px solid var(--color-divider)" }}>
                      <td style={{ padding: "4px 4px", color: dim(55) }}>{def.label}</td>
                      {series.map((s, li) => {
                        const v = values[k]?.[li];
                        const at = cursor == null || !v ? null : interpAt(xsOf(s, axis), v, cursor);
                        return (
                          <td key={s.lap} style={{ padding: "4px 4px", textAlign: "right", color: LAP_COLORS[li % LAP_COLORS.length] }}>
                            {at == null || !Number.isFinite(at) ? "—" : at.toFixed(def.dp)}
                          </td>
                        );
                      })}
                      <td style={{ padding: "4px 2px", color: dim(38), fontSize: 10 }}>{def.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <Panel title="Channels">
            <div style={{ display: "grid", gap: 2, maxHeight: 220, overflowY: "auto" }}>
              {options.map((o) => (
                <label key={o.key} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: dim(68) }}>
                  <input type="checkbox" checked={shown.includes(o.key)}
                    onChange={(e) => setChannels((c) => (e.target.checked ? [...c, o.key] : c.filter((x) => x !== o.key)))} />
                  {o.label}
                  {o.math && <span style={{ fontSize: 9.5, color: dim(38) }}>math</span>}
                </label>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <div style={{ marginTop: "var(--space-4)" }}>
        <SectorTable selected={laps} onToggle={toggle} />
      </div>
    </>
  );
}
