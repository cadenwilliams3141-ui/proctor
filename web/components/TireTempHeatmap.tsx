"use client";

/* Left-front tire surface temperature across the lap as a heat strip. Three
   bands (L / M / R edges) coloured blue→red by temperature, drawn against track
   distance from the tire_temps `curve` payload. LF only — the sole tire-temp
   channel carried; no brake temp exists, so none is shown. */

type Loose = Record<string, any>;

function tempColor(v: number, min: number, max: number): string {
  const t = max > min ? (v - min) / (max - min) : 0.5;
  return `hsl(${220 - 220 * t}, 80%, 50%)`;
}

export default function TireTempHeatmap({ payload }: { payload: Loose | undefined }) {
  const curve = payload?.curve;
  if (!curve?.left_c) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(payload?.reason ?? "no left-front temp curve for this session — re-upload to compute")}
      </p>
    );
  }

  const edges: { key: "left_c" | "middle_c" | "right_c"; label: string }[] = [
    { key: "left_c", label: "L" },
    { key: "middle_c", label: "M" },
    { key: "right_c", label: "R" },
  ];
  const all: number[] = [
    ...curve.left_c.map(Number),
    ...curve.middle_c.map(Number),
    ...curve.right_c.map(Number),
  ];
  const min = Math.min(...all), max = Math.max(...all);
  const n = curve.left_c.length;

  const W = 720, PAD_L = 26, PAD_B = 18, ROW = 26, GAP = 4;
  const H = PAD_B + edges.length * (ROW + GAP);
  const cellW = (W - PAD_L) / n;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {edges.map((e, r) => {
          const y = r * (ROW + GAP);
          const vals: number[] = curve[e.key].map(Number);
          return (
            <g key={e.key}>
              <text x={0} y={y + ROW / 2 + 4} fill="#8b949e" fontSize={11}>{e.label}</text>
              {vals.map((v, c) => (
                <rect key={c} x={PAD_L + c * cellW} y={y} width={cellW + 0.5} height={ROW} fill={tempColor(v, min, max)}>
                  <title>{`${e.label} · ${(c / n * 100).toFixed(0)}% of lap · ${v.toFixed(1)}°C`}</title>
                </rect>
              ))}
            </g>
          );
        })}
        <text x={PAD_L} y={H - 4} fill="#8b949e" fontSize={10}>0%</text>
        <text x={W - 30} y={H - 4} fill="#8b949e" fontSize={10}>100%</text>
      </svg>
      <p className="caveat">
        left-front only · {min.toFixed(0)}°C (blue) → {max.toFixed(0)}°C (red) ·
        lap {String(curve.source_lap)} · L/M/R are the tire&apos;s recorded edges,
        no inner/outer or ideal window asserted
      </p>
    </div>
  );
}
