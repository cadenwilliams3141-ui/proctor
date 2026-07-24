"use client";

import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TraceRow } from "@/lib/types";

const ACCENT = "#58a6ff";
const LAP_B = "#f0883e";

function Pane({ rows, dataKeyA, dataKeyB, label, unit, withBrush }: {
  rows: Record<string, number>[];
  dataKeyA: string;
  dataKeyB: string;
  label: string;
  unit: string;
  withBrush?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={withBrush ? 150 : 120}>
      <ComposedChart data={rows} syncId="input-overlay">
        <CartesianGrid stroke="#21262d" />
        <XAxis dataKey="pct" stroke="#8b949e" fontSize={10} hide={!withBrush} />
        <YAxis stroke="#8b949e" fontSize={10} width={40}
          label={{ value: `${label} ${unit}`, angle: -90, position: "insideLeft", fill: "#8b949e", fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 12 }}
          labelFormatter={(v) => `${v}% of lap`}
        />
        <Line dataKey={dataKeyA} stroke={ACCENT} dot={false} strokeWidth={1.4} name={`${label} A`} isAnimationActive={false} />
        <Line dataKey={dataKeyB} stroke={LAP_B} dot={false} strokeWidth={1.4} name={`${label} B`} isAnimationActive={false} />
        {withBrush && <Brush dataKey="pct" height={20} stroke="#30363d" fill="#0d1117" travellerWidth={8} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function InputOverlayChart({ a, b }: { a: TraceRow; b: TraceRow }) {
  const rows = a.throttle.map((v, i) => ({
    pct: +(i / 10).toFixed(1),
    thA: +(Number(v) * 100).toFixed(1),
    thB: +(Number(b.throttle[i] ?? 0) * 100).toFixed(1),
    brA: +(Number(a.brake[i] ?? 0) * 100).toFixed(1),
    brB: +(Number(b.brake[i] ?? 0) * 100).toFixed(1),
    stA: +((Number(a.steer[i] ?? 0) * 180) / Math.PI).toFixed(1),
    stB: +((Number(b.steer[i] ?? 0) * 180) / Math.PI).toFixed(1),
  }));

  return (
    <>
      <Pane rows={rows} dataKeyA="thA" dataKeyB="thB" label="throttle" unit="%" />
      <Pane rows={rows} dataKeyA="brA" dataKeyB="brB" label="brake" unit="%" />
      <Pane rows={rows} dataKeyA="stA" dataKeyB="stB" label="steer" unit="°" withBrush />
    </>
  );
}
