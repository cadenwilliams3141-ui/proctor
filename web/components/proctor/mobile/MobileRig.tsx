"use client";

import { useMemo } from "react";
import { Ban } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

export default function MobileRig() {
  const { bundle } = useProctor();

  const gg = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (150 - 26) / maxG;
    const X = (lat: number) => 150 + lat * s;
    const Y = (lon: number) => 150 - lon * s;
    const rings: number[] = [];
    for (let g = 0.5; g <= maxG; g += 0.5) rings.push(g * s);
    return {
      rings,
      dots: bundle.traction.scatter.filter((_, i) => i % 5 === 0).map(([lat, lon]) => ({ x: X(lat), y: Y(lon) })),
      poly: bundle.traction.envelope
        .map((e) => {
          const r = (e.angle_deg * Math.PI) / 180;
          return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
        })
        .join(" "),
    };
  }, [bundle]);

  if (!bundle || !gg) {
    return <div style={{ padding: "var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const lockups = bundle.events.filter((e) => e.kind === "lockup").length;

  const stats = [
    {
      label: "brake ceiling",
      value: "93.4",
      unit: "%",
      bar: "93.4%",
      color: "var(--color-text)",
      note: "Your own maximum over 187 applications while moving — not a hardware limit.",
    },
    {
      label: "ABS engagement",
      value: "6.2",
      unit: "% of braking",
      bar: "34%",
      color: CH.warn,
      note: `${lockups} lockups recorded, concentrated in the heaviest braking zones.`,
    },
    {
      label: "FFB clipping",
      value: "1.87",
      unit: "% of moving",
      bar: "19%",
      color: CH.a,
      note: "Brief, and clustered in the two heaviest braking zones.",
    },
    {
      label: "pedal noise floor",
      value: "41",
      unit: "of 8812",
      bar: "8%",
      color: "var(--color-text)",
      note: "Max spike 0.0071 — consistent with sensor noise rather than input.",
    },
  ];

  return (
    <div>
      <header style={{ padding: "var(--space-3) var(--space-6) var(--space-4)" }}>
        <h1 style={{ font: "500 24px var(--font-heading)", margin: 0 }}>Rig health</h1>
        <div style={{ fontSize: 12, color: dim(45), marginTop: 2 }}>
          what your hardware produced this session
        </div>
      </header>

      <div style={{ padding: "0 var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {stats.map((s, i) => (
          <Panel
            key={s.label}
            padding="var(--space-4)"
            style={{ animation: "fadeUp .4s both", animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s` }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
              <span
                style={{
                  font: "500 9.5px var(--font-heading)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: dim(42),
                }}
              >
                {s.label}
              </span>
              <span style={{ flex: 1 }} />
              <span className="num" style={{ font: "500 20px var(--font-heading)", color: s.color }}>
                {s.value}
              </span>
              <span style={{ fontSize: 10, color: dim(38) }}>{s.unit}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: dim(8), marginTop: "var(--space-3)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: s.bar,
                  background: s.color,
                  transformOrigin: "left",
                  animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s`,
                }}
              />
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(50), marginTop: "var(--space-2)" }}>
              {s.note}
            </div>
          </Panel>
        ))}

        <Panel padding="var(--space-4)" foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}>
          <div style={{ font: "500 12.5px var(--font-heading)", marginBottom: "var(--space-2)" }}>
            Grip you demonstrated
          </div>
          <svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: 230, display: "block" }} aria-hidden>
            {gg.rings.map((r, i) => (
              <circle key={i} cx={150} cy={150} r={r} fill="none" stroke={inkA(0.07)} />
            ))}
            <line x1={150} y1={14} x2={150} y2={286} stroke={inkA(0.07)} />
            <line x1={14} y1={150} x2={286} y2={150} stroke={inkA(0.07)} />
            {gg.dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={1.2} fill={CH.a} opacity={0.3} />
            ))}
            <polygon points={gg.poly} fill="none" stroke={CH.b} strokeWidth={1.6} />
            <text x={154} y={20} fill={inkA(0.34)} fontSize={9}>accelerating</text>
            <text x={154} y={294} fill={inkA(0.34)} fontSize={9}>braking</text>
            <text x={16} y={144} fill={inkA(0.34)} fontSize={9}>left</text>
            <text x={264} y={144} fill={inkA(0.34)} fontSize={9}>right</text>
          </svg>
        </Panel>

        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", padding: "var(--space-3) 0" }}>
          <Ban size={16} color={dim(38)} style={{ flex: "none", marginTop: 1 }} />
          <span style={{ fontSize: 11.5, lineHeight: 1.55, color: dim(50) }}>
            {noteFor("racecraft")} {noteFor("brake.temperature")}
          </span>
        </div>
      </div>
    </div>
  );
}
