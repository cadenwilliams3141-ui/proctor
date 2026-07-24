"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LapRow, TraceRow } from "@/lib/types";
import TrackMap, { type SlipMarker } from "@/components/TrackMap";
import SpeedDeltaChart from "@/components/SpeedDeltaChart";
import InputOverlayChart from "@/components/InputOverlayChart";
import ResizablePanel from "@/components/ResizablePanel";
import TireTempHeatmap from "@/components/TireTempHeatmap";
import BalanceExplainer from "@/components/BalanceExplainer";
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

  // Slip events on lap A, placed on the map at their track position.
  const slipEvents: SlipMarker[] = (() => {
    const lw = metrics.lockup_wheelspin;
    if (!lw || lapA == null) return [];
    const pick = (arr: Loose[] | undefined, kind: "lockup" | "wheelspin"): SlipMarker[] =>
      (arr ?? [])
        .filter((e) => Number(e.lap) === lapA)
        .map((e) => ({
          start_pct: Number(e.start_pct),
          kind,
          wheels: e.wheels,
          peak_slip_ratio: Number(e.peak_slip_ratio),
          lap: Number(e.lap),
        }));
    return [...pick(lw.lockups, "lockup"), ...pick(lw.wheelspin, "wheelspin")];
  })();

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
        <ResizablePanel id="laps-map">
          <h3>Track map</h3>
          <TrackMap
            map={metrics.track_map}
            speed={tA?.speed?.map(Number)}
            corners={corners}
            events={slipEvents}
          />
          <p className="caveat">
            driven line from lap GPS, colored by lap A speed · red diamonds =
            lockups, amber dots = wheelspin on lap A — native data, no
            reconstruction
          </p>
        </ResizablePanel>
        <ResizablePanel id="laps-delta">
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
        </ResizablePanel>
      </div>

      {/* Map and delta are the core loop at every tier; the input overlay, the
          tire-temp strip and the dense per-corner detail step up from there. */}
      {atLeast(tier, "intermediate") && (
        <ResizablePanel id="laps-inputs">
          <h3>Input overlay</h3>
          {tA && tB ? (
            <InputOverlayChart a={tA} b={tB} />
          ) : (
            <p style={{ color: "var(--muted)" }}>loading traces…</p>
          )}
        </ResizablePanel>
      )}

      {atLeast(tier, "intermediate") && (
        <ResizablePanel id="laps-tiretemp">
          <h3>Tire temp across the lap (left-front)</h3>
          <TireTempHeatmap payload={metrics.tire_temps} />
        </ResizablePanel>
      )}

      {atLeast(tier, "advanced") && corners.length > 0 && lapA != null && (
        <ResizablePanel id="laps-corner-sections">
          <h3>Corner sections — time vs reference lap {refLap} (s)</h3>
          <CornerTable metrics={metrics} lapA={lapA} lapB={lapB} refLap={refLap} />
          <p className="caveat">
            {String(metrics.corner_sections?.caveat ?? "")}
          </p>
        </ResizablePanel>
      )}

      {atLeast(tier, "advanced") && (
        <ResizablePanel id="laps-corner-context">
          <h3>Corner context — what the car was doing</h3>
          <CornerContext payload={metrics.corner_context} />
        </ResizablePanel>
      )}

      {atLeast(tier, "advanced") && (
        <ResizablePanel id="laps-balance">
          <h3>Balance — how the car rotated vs your steering</h3>
          <BalanceExplainer payload={metrics.balance} />
        </ResizablePanel>
      )}

      {/* Two intermediate panels (input overlay, tire temp) and three advanced
          panels (corner sections, corner context, balance) can be hidden. */}
      {(() => {
        const hidden =
          (atLeast(tier, "intermediate") ? 0 : 2) + (atLeast(tier, "advanced") ? 0 : 3);
        return hiddenNote(tier, hidden) && <p className="caveat">{hiddenNote(tier, hidden)}</p>;
      })()}
    </>
  );
}

function CornerContext({ payload }: { payload: Loose | undefined }) {
  if (!payload) {
    return (
      <p style={{ color: "var(--muted)" }}>
        corner context not computed for this session — re-upload to compute
      </p>
    );
  }
  if (payload.insufficient_data) {
    return <p style={{ color: "var(--muted)" }}>{String(payload.reason ?? "insufficient data")}</p>;
  }
  const corners: Loose[] = payload.corners ?? [];
  if (corners.length === 0) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(payload.finding ?? "no corners detected on the reference lap")}
      </p>
    );
  }
  const ms = (v: unknown) => (typeof v === "number" ? `${(v * 3.6).toFixed(0)}` : "—");
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>corner</th><th>min</th><th>entry</th><th>exit</th>
            <th>peak steer</th><th>lat g</th><th>brake g</th><th>LF temp L/M/R</th>
          </tr>
        </thead>
        <tbody>
          {corners.map((c) => {
            const t = c.lf_tire_temp ?? {};
            return (
              <tr key={String(c.id)}>
                <td>T{String(c.id)}</td>
                <td className="mono">{ms(c.min_speed_ms)}</td>
                <td className="mono">{ms(c.entry_speed_ms)}</td>
                <td className="mono">{ms(c.exit_speed_ms)}</td>
                <td className="mono">{typeof c.peak_abs_steer_rad === "number" ? `${((c.peak_abs_steer_rad * 180) / Math.PI).toFixed(0)}°` : "—"}</td>
                <td className="mono">{typeof c.peak_lat_g === "number" ? c.peak_lat_g.toFixed(2) : "—"}</td>
                <td className="mono">{typeof c.peak_brake_g === "number" ? c.peak_brake_g.toFixed(2) : "—"}</td>
                <td className="mono">
                  {t.available
                    ? `${t.left_c}/${t.middle_c}/${t.right_c}°`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="caveat">
        speeds in km/h · from the reference lap (lap {String(payload.reference_lap)}) ·
        {String(payload.caveat ?? "")}
      </p>
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
