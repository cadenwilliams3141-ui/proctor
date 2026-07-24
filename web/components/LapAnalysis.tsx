"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LapRow, TraceRow } from "@/lib/types";
import TrackMap from "@/components/TrackMap";
import SpeedDeltaChart from "@/components/SpeedDeltaChart";
import InputOverlayChart from "@/components/InputOverlayChart";
import { atLeast, hiddenNote, type Tier } from "@/lib/tier";

type Loose = Record<string, any>;

function fmtLap(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export default function LapAnalysis({ sessionId, tier }: {
  sessionId: string; tier: Tier;
}) {
  const [data, setData] = useState<Loose | null>(null);
  const [lapA, setLapA] = useState<number | null>(null);
  const [lapB, setLapB] = useState<number | null>(null);
  const [traces, setTraces] = useState<Record<number, TraceRow>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/session/${sessionId}/data`)
      .then((r) => r.json())
      .then((d: Loose) => {
        setData(d);
        const laps: LapRow[] = d.laps ?? [];
        const clean = laps.filter((l) => l.is_valid && l.lap_time_s != null);
        const sorted = [...clean].sort((a, b) => a.lap_time_s! - b.lap_time_s!);
        const ref = d.metrics?.delta_time?.reference_lap;
        const a = sorted[0]?.lap_number ?? laps[0]?.lap_number ?? null;
        const b =
          typeof ref === "number" && ref !== a
            ? ref
            : sorted.find((l) => l.lap_number !== a)?.lap_number ?? null;
        setLapA(a);
        setLapB(b ?? a);
      })
      .catch((e) => setError(String(e)));
  }, [sessionId]);

  const loadTraces = useCallback(
    (nums: number[]) => {
      const missing = nums.filter((n) => !(n in traces));
      if (missing.length === 0) return;
      fetch(`/api/session/${sessionId}/traces?laps=${missing.join(",")}`)
        .then((r) => r.json())
        .then((d: { traces: TraceRow[] }) => {
          setTraces((prev) => {
            const next = { ...prev };
            for (const t of d.traces ?? []) next[t.lap_number] = t;
            return next;
          });
        })
        .catch((e) => setError(String(e)));
    },
    [sessionId, traces],
  );

  useEffect(() => {
    const wanted = [lapA, lapB].filter((v): v is number => v != null);
    if (wanted.length) loadTraces(wanted);
  }, [lapA, lapB, loadTraces]);

  if (error) return <p className="pos">failed to load: {error}</p>;
  if (!data) return <p style={{ color: "var(--muted)" }}>loading…</p>;

  const laps: LapRow[] = data.laps ?? [];
  const metrics: Loose = data.metrics ?? {};
  const tA = lapA != null ? traces[lapA] : undefined;
  const tB = lapB != null ? traces[lapB] : undefined;

  const deltaLaps: Loose = metrics.delta_time?.laps ?? {};
  const refLap: number | undefined = metrics.delta_time?.reference_lap;
  const curve = (n: number | null): number[] | null => {
    if (n == null) return null;
    if (n === refLap) return new Array(1000).fill(0);
    const c = deltaLaps[String(n)]?.delta_curve_s;
    return Array.isArray(c) ? c.map(Number) : null;
  };
  const curveA = curve(lapA);
  const curveB = curve(lapB);
  const deltaAB =
    curveA && curveB ? curveA.map((v, i) => v - curveB[i]) : null;

  const corners: Loose[] = metrics.corner_sections?.corners ?? [];

  const selector = (value: number | null, onChange: (n: number) => void) => (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {laps.map((l) => (
        <option key={l.lap_number} value={l.lap_number}>
          lap {l.lap_number} — {fmtLap(l.lap_time_s)}
          {l.is_valid ? "" : " (invalid)"}
          {l.is_anomalous ? " (anomalous)" : ""}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <h1>Lap analysis</h1>
      <div className="panel">
        <span style={{ color: "var(--accent)" }}>■</span> lap A{" "}
        {selector(lapA, setLapA)}{" "}
        <span style={{ color: "var(--lap-b)", marginLeft: 16 }}>■</span> lap B{" "}
        {selector(lapB, setLapB)}
        {refLap != null && (
          <span className="badge" title="fastest valid non-anomalous lap">
            delta reference: lap {refLap}
          </span>
        )}
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Track map</h3>
          <TrackMap
            map={metrics.track_map}
            speed={tA?.speed?.map(Number)}
            corners={corners}
          />
          <p className="caveat">
            driven line from lap GPS, colored by lap A speed — native data, no
            reconstruction
          </p>
        </div>
        <div className="panel">
          <h3>Speed & time delta (A − B)</h3>
          {tA && tB && (
            <SpeedDeltaChart
              speedA={tA.speed.map(Number)}
              speedB={tB.speed.map(Number)}
              delta={deltaAB}
              corners={corners}
            />
          )}
          {(!tA || !tB) && <p style={{ color: "var(--muted)" }}>loading traces…</p>}
          {!deltaAB && tA && tB && (
            <p className="caveat">
              delta-time metric not computed for these laps — showing speed only
            </p>
          )}
        </div>
      </div>

      {/* Map and delta are the core loop at every tier; the input overlay and
          the dense per-section table step up from there. */}
      {atLeast(tier, "intermediate") && (
        <div className="panel">
          <h3>Input overlay</h3>
          {tA && tB ? (
            <InputOverlayChart a={tA} b={tB} />
          ) : (
            <p style={{ color: "var(--muted)" }}>loading traces…</p>
          )}
        </div>
      )}

      {atLeast(tier, "advanced") && corners.length > 0 && lapA != null && (
        <div className="panel">
          <h3>Corner sections — time vs reference lap {refLap} (s)</h3>
          <CornerTable metrics={metrics} lapA={lapA} lapB={lapB} refLap={refLap} />
          <p className="caveat">
            {String(metrics.corner_sections?.caveat ?? "")}
          </p>
        </div>
      )}

      {hiddenNote(tier, atLeast(tier, "intermediate") ? 1 : 2) && (
        <p className="caveat">
          {hiddenNote(tier, atLeast(tier, "intermediate") ? 1 : 2)}
        </p>
      )}
    </>
  );
}

function CornerTable({ metrics, lapA, lapB, refLap }: {
  metrics: Loose; lapA: number; lapB: number | null; refLap: number | undefined;
}) {
  const corners: Loose[] = metrics.corner_sections?.corners ?? [];
  const perLap: Loose = metrics.corner_sections?.per_lap ?? {};

  const Cell = ({ v }: { v: unknown }) => {
    if (typeof v !== "number") return <td>—</td>;
    const cls = v > 0.005 ? "pos" : v < -0.005 ? "neg" : "";
    return <td className={`mono ${cls}`}>{v >= 0 ? "+" : ""}{v.toFixed(3)}</td>;
  };

  const entries = [
    { key: "a", lap: lapA, color: "var(--accent)" },
    ...(lapB != null && lapB !== lapA ? [{ key: "b", lap: lapB, color: "var(--lap-b)" }] : []),
  ];

  return (
    <table>
      <thead>
        <tr>
          <th>corner</th><th>lap</th>
          <th>S1 (entry)</th><th>S2 (→apex)</th><th>S3 (apex→)</th><th>S4 (exit)</th>
        </tr>
      </thead>
      <tbody>
        {corners.flatMap((c) => {
          const id = String(c.id);
          return entries.map((e, idx) => {
            const vals = perLap[String(e.lap)]?.[id] as number[] | undefined;
            return (
              <tr key={`${id}-${e.key}`}>
                <td>{idx === 0 ? `T${id}` : ""}</td>
                <td style={{ color: e.color }}>{e.key.toUpperCase()} · lap {e.lap}</td>
                {vals ? (
                  vals.map((v, i) => <Cell key={i} v={v} />)
                ) : (
                  <td colSpan={4} style={{ color: "var(--muted)" }}>
                    {e.lap === refLap
                      ? "reference lap — zero by definition"
                      : "not computed (invalid lap)"}
                  </td>
                )}
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}
