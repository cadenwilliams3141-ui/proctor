"use client";

/* g-g scatter with the driver's own envelope (from the traction_circle
   metric). The envelope is the outer boundary of this session's data —
   self-comparison, not a physics model. */

type Loose = Record<string, any>;

export default function TractionCircle({ payload }: { payload: Loose | undefined }) {
  if (!payload || payload.insufficient_data) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(payload?.reason ?? "traction data not computed for this session")}
      </p>
    );
  }

  const scatter: [number, number][] = (payload.scatter ?? []).map(
    (p: [number, number]) => [Number(p[0]), Number(p[1])],
  );
  const envelope: { angle_deg: number; g: number | null }[] = payload.envelope ?? [];
  const laps: Loose = payload.laps ?? {};

  const W = 420, H = 420, C = W / 2;
  const maxG = Math.max(
    1.0,
    ...envelope.map((e) => (typeof e.g === "number" ? e.g : 0)),
    ...scatter.map(([a, b]) => Math.hypot(a, b)),
  );
  const scale = (W / 2 - 30) / maxG;
  const px = (latG: number) => C + latG * scale;
  const py = (longG: number) => C - longG * scale;

  const envPoints = envelope
    .filter((e) => typeof e.g === "number")
    .map((e) => {
      const rad = (e.angle_deg * Math.PI) / 180;
      // angle convention from the module: atan2(long_g, lat_g)
      return `${px(e.g! * Math.cos(rad))},${py(e.g! * Math.sin(rad))}`;
    })
    .join(" ");

  const rings = [];
  for (let g = 0.5; g <= maxG; g += 0.5) {
    rings.push(
      <circle key={g} cx={C} cy={C} r={g * scale} fill="none" stroke="#21262d" strokeWidth={1} />,
    );
  }

  return (
    <div className="grid2">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {rings}
        <line x1={C} y1={10} x2={C} y2={H - 10} stroke="#21262d" />
        <line x1={10} y1={C} x2={W - 10} y2={C} stroke="#21262d" />
        <text x={C + 4} y={16} fill="#8b949e" fontSize={10}>accel</text>
        <text x={C + 4} y={H - 8} fill="#8b949e" fontSize={10}>brake</text>
        <text x={12} y={C - 6} fill="#8b949e" fontSize={10}>left</text>
        <text x={W - 34} y={C - 6} fill="#8b949e" fontSize={10}>right</text>
        {scatter.map(([latG, longG], i) => (
          <circle key={i} cx={px(latG)} cy={py(longG)} r={1.2} fill="#58a6ff" opacity={0.35} />
        ))}
        {envPoints && (
          <polygon points={envPoints} fill="none" stroke="#f0883e" strokeWidth={1.8} />
        )}
        <text x={12} y={H - 8} fill="#8b949e" fontSize={10}>
          rings every 0.5 g · envelope = your session's outer boundary
        </text>
      </svg>
      <div>
        <h3 style={{ marginTop: 0 }}>Envelope utilization by lap</h3>
        <table>
          <thead><tr><th>lap</th><th>% of your own envelope</th></tr></thead>
          <tbody>
            {Object.entries(laps).map(([lap, v]) => (
              <tr key={lap}>
                <td>{lap}</td>
                <td className="mono">
                  {typeof (v as Loose).utilization_pct === "number"
                    ? `${((v as Loose).utilization_pct as number).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
