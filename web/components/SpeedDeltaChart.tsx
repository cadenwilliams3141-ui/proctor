"use client";

import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Loose = Record<string, any>;

const ACCENT = "#58a6ff";
const LAP_B = "#f0883e";
const DELTA = "#d29922";

export default function SpeedDeltaChart({ speedA, speedB, delta, corners }: {
  speedA: number[];
  speedB: number[];
  delta: number[] | null;
  corners: Loose[];
}) {
  const rows = speedA.map((v, i) => ({
    pct: +(i / 10).toFixed(1), // grid index → % of lap
    a: +(v * 3.6).toFixed(1),
    b: +((speedB[i] ?? 0) * 3.6).toFixed(1),
    delta: delta ? +delta[i].toFixed(3) : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
      <ComposedChart data={rows} syncId="lap-compare">
        <CartesianGrid stroke="#21262d" />
        <XAxis
          dataKey="pct"
          stroke="#8b949e"
          fontSize={11}
          label={{ value: "% of lap", position: "insideBottomRight", fill: "#8b949e", fontSize: 11, offset: -2 }}
        />
        <YAxis yAxisId="speed" stroke="#8b949e" fontSize={11} domain={["auto", "auto"]}
          label={{ value: "km/h", angle: -90, position: "insideLeft", fill: "#8b949e", fontSize: 11 }} />
        {delta && (
          <YAxis yAxisId="delta" orientation="right" stroke={DELTA} fontSize={11}
            label={{ value: "Δt s", angle: 90, position: "insideRight", fill: DELTA, fontSize: 11 }} />
        )}
        <Tooltip
          contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 12 }}
          labelFormatter={(v) => `${v}% of lap`}
        />
        {corners.map((c, i) => (
          <ReferenceArea
            key={String(c.id)}
            yAxisId="speed"
            x1={+(Number(c.start_pct) * 100).toFixed(1)}
            x2={+(Number(c.end_pct) * 100).toFixed(1)}
            fill={i % 2 ? "#58a6ff" : "#8b949e"}
            fillOpacity={0.07}
            label={{ value: `T${c.id}`, position: "insideTop", fill: "#8b949e", fontSize: 10 }}
          />
        ))}
        <Line yAxisId="speed" dataKey="a" stroke={ACCENT} dot={false} strokeWidth={1.6} name="lap A" isAnimationActive={false} />
        <Line yAxisId="speed" dataKey="b" stroke={LAP_B} dot={false} strokeWidth={1.6} name="lap B" isAnimationActive={false} />
        {delta && (
          <Line yAxisId="delta" dataKey="delta" stroke={DELTA} dot={false} strokeWidth={1.4} name="Δt (A−B)" isAnimationActive={false} />
        )}
        <Brush dataKey="pct" height={22} stroke="#30363d" fill="#0d1117" travellerWidth={8} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
