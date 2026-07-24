"use client";

/* SVG track map from the track_map metric payload (local-meter projection of
   the reference lap's GPS), optionally colored by a speed trace. Optional
   overlays: slip-event markers (lockups/wheelspin at their track position) and
   a moving car dot at a given grid index (used by the live-trace tab). */

type Loose = Record<string, any>;

export type SlipMarker = {
  start_pct: number;
  kind: "lockup" | "wheelspin";
  wheels?: string[];
  peak_slip_ratio?: number;
  lap?: number;
};

function speedColor(v: number, min: number, max: number): string {
  // blue (slow) → red (fast); hue 220 → 0
  const t = max > min ? (v - min) / (max - min) : 0.5;
  return `hsl(${220 - 220 * t}, 75%, 55%)`;
}

export default function TrackMap({ map, speed, corners, events, carIndex }: {
  map: Loose | undefined;
  speed: number[] | undefined;
  corners: Loose[];
  events?: SlipMarker[];
  carIndex?: number | null;
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

  // Map a 0..1 track fraction onto a point index in the projected path.
  const at = (pct: number) => Math.min(xs.length - 1, Math.max(0, Math.round(pct * (xs.length - 1))));

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
    const idx = at(Number(c.apex_pct));
    return (
      <g key={String(c.id)}>
        <circle cx={px(xs[idx])} cy={py(ys[idx])} r={5} fill="none" stroke="#e6edf3" strokeWidth={1.5} />
        <text x={px(xs[idx]) + 8} y={py(ys[idx]) - 6} fill="#8b949e" fontSize={11}>
          T{String(c.id)}
        </text>
      </g>
    );
  });

  const slipMarks = (events ?? []).map((e, i) => {
    const idx = at(Number(e.start_pct));
    const cx = px(xs[idx]), cy = py(ys[idx]);
    const label = `${e.kind}${e.lap != null ? ` · lap ${e.lap}` : ""}${
      e.wheels?.length ? ` · ${e.wheels.join(",")}` : ""
    }${e.peak_slip_ratio != null ? ` · ratio ${e.peak_slip_ratio}` : ""}`;
    return e.kind === "lockup" ? (
      // red diamond = lockup under braking
      <rect key={i} x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`}
        fill="#f85149" stroke="#0d1117" strokeWidth={0.8}>
        <title>{label}</title>
      </rect>
    ) : (
      // amber circle = wheelspin under power
      <circle key={i} cx={cx} cy={cy} r={4.5} fill="#d29922" stroke="#0d1117" strokeWidth={0.8}>
        <title>{label}</title>
      </circle>
    );
  });

  const car =
    carIndex != null && carIndex >= 0 && carIndex < xs.length ? (
      <g>
        <circle cx={px(xs[carIndex])} cy={py(ys[carIndex])} r={9} fill="none" stroke="#e6edf3" strokeWidth={1.5} opacity={0.6} />
        <circle cx={px(xs[carIndex])} cy={py(ys[carIndex])} r={4.5} fill="#e6edf3" />
      </g>
    ) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {segments}
      {apexMarks}
      {slipMarks}
      {car}
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
