"use client";

/* SVG track map from the track_map metric payload (local-meter projection of
   the reference lap's GPS), optionally colored by a speed trace. */

type Loose = Record<string, any>;

function speedColor(v: number, min: number, max: number): string {
  // blue (slow) → red (fast); hue 220 → 0
  const t = max > min ? (v - min) / (max - min) : 0.5;
  return `hsl(${220 - 220 * t}, 75%, 55%)`;
}

export default function TrackMap({ map, speed, corners }: {
  map: Loose | undefined;
  speed: number[] | undefined;
  corners: Loose[];
}) {
  const xs: number[] | undefined = map?.x_m?.map(Number);
  const ys: number[] | undefined = map?.y_m?.map(Number);
  if (!xs || !ys || map?.insufficient_data) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(map?.reason ?? "track map not available for this session")}
      </p>
    );
  }

  const W = 560, H = 400, PAD = 20;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
  const px = (x: number) => PAD + (x - minX) * scale + (W - 2 * PAD - (maxX - minX) * scale) / 2;
  // SVG y grows downward; latitude grows upward.
  const py = (y: number) => H - PAD - (y - minY) * scale - (H - 2 * PAD - (maxY - minY) * scale) / 2;

  const sMin = speed ? Math.min(...speed) : 0;
  const sMax = speed ? Math.max(...speed) : 1;

  const segments = [];
  for (let i = 1; i < xs.length; i++) {
    segments.push(
      <line
        key={i}
        x1={px(xs[i - 1])} y1={py(ys[i - 1])}
        x2={px(xs[i])} y2={py(ys[i])}
        stroke={speed ? speedColor(speed[i], sMin, sMax) : "var(--accent)"}
        strokeWidth={3}
        strokeLinecap="round"
      />,
    );
  }

  const apexMarks = corners.map((c) => {
    const idx = Math.min(999, Math.max(0, Math.round(Number(c.apex_pct) * 1000)));
    return (
      <g key={String(c.id)}>
        <circle cx={px(xs[idx])} cy={py(ys[idx])} r={5} fill="none" stroke="#e6edf3" strokeWidth={1.5} />
        <text x={px(xs[idx]) + 8} y={py(ys[idx]) - 6} fill="#8b949e" fontSize={11}>
          T{String(c.id)}
        </text>
      </g>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {segments}
      {apexMarks}
      {speed && (
        <g>
          <text x={PAD} y={H - 6} fill="#8b949e" fontSize={11}>
            {(sMin * 3.6).toFixed(0)} km/h
          </text>
          <text x={W - PAD - 60} y={H - 6} fill="#8b949e" fontSize={11}>
            {(sMax * 3.6).toFixed(0)} km/h
          </text>
          {Array.from({ length: 40 }, (_, i) => (
            <rect
              key={i}
              x={PAD + 50 + i * 3} y={H - 16}
              width={3} height={8}
              fill={speedColor(sMin + ((sMax - sMin) * i) / 39, sMin, sMax)}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
