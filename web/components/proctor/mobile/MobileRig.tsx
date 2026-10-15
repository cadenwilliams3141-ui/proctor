"use client";

/* Physics, on the phone. The same chain as the desktop screen, compressed.
 *
 * ┌ WHAT WAS WRONG WITH THIS FILE ──────────────────────────────────────────┐
 * │ Every number on it was a LITERAL in its own source: a brake ceiling of   │
 * │ "93.4", an ABS figure of "6.2", FFB "1.87", a noise count of "41 of      │
 * │ 8812", and prose about "187 applications" and a "max spike 0.0071".      │
 * │ None of it came from the loaded session. The desktop screen had the same │
 * │ bug and it was fixed in August; the phone was never looked at, so it has │
 * │ been describing a session nobody opened ever since.                      │
 * │                                                                          │
 * │ This is the failure mode the honesty rules exist for, and it is worse    │
 * │ than a blank panel because it looks right. Every figure below now reads  │
 * │ off a module, and a figure the module could not measure renders as an em │
 * │ dash with the module's own reason underneath it.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The phone gets the answer and the headline figures. The evidence — speed
 * bands, the load curve, per-corner tables — stays on the desktop, where there
 * is room to read it. */

import { useMemo } from "react";
import { Ban, TriangleAlert } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import Panel from "@/components/proctor/ui/Panel";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import { equipmentReadings } from "@/lib/proctor/equipment";
import { explainGrip, explainInputResponse } from "@/lib/proctor/explain";
import { fixed } from "@/lib/proctor/format";
import { brakeCeiling } from "@/lib/proctor/pedals";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { techniqueForSteerTorque } from "@/lib/proctor/technique";

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
      dots: bundle.traction.scatter
        .filter((_, i) => i % 5 === 0)
        .map(([lat, lon]) => ({ x: X(lat), y: Y(lon) })),
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

  const hw = bundle.hardware;
  const ir = bundle.inputResponse;
  const cp = bundle.contactPatch;
  const grip = bundle.grip;

  /* Every entry reads a module or reports itself unmeasured. `null` renders as
     an em dash with the module's own reason — never as a zero, and never as a
     number this file made up.

     SAME SOURCES AS THE DESKTOP. The ABS share here used to come off the
     hardware module, which counted braking from the applied channel, while the
     desktop read input_response, which counts it from the pedal — so the two
     screens could print different figures for one session. Both now read
     input_response, and the brake ceiling and equipment cards come from the
     same helpers the desktop uses. */
  const ceiling = brakeCeiling(hw, ir);
  const abs = ir?.brake.measured ? ir.brake.abs : undefined;
  const stats: {
    label: string;
    value: number | null;
    unit: string;
    /** 0-100, or null for no bar. */
    bar: number | null;
    color: string;
    note: string;
    flagged?: boolean;
    decimals?: number;
  }[] = [
    {
      label: "brake ceiling",
      value: ceiling.pct,
      unit: "% of pedal",
      bar: ceiling.pct,
      color: "var(--color-text)",
      note: ceiling.reason ?? "Your hardest press while moving — your maximum, not the pedal's.",
    },
    {
      label: "ABS engagement",
      value: abs?.engaged_pct_of_braking ?? null,
      unit: "% of braking",
      bar: abs?.engaged_pct_of_braking ?? null,
      color: CH.warn,
      note:
        ir == null
          ? (bundle.absences.find((a) => a.key === "input_response")?.short ??
            "Not measured for this session.")
          : !ir.brake.measured
            ? ir.brake.reason
            : abs == null
              ? "The file carries no ABS channel."
              : abs.engaged_pct_of_braking === 0
                ? "Never engaged this session."
                : `${abs.activation_events} separate activations.`,
    },
    {
      label: "peak grip used",
      value: grip?.session.peak_mu ?? null,
      unit: "g per g",
      bar: grip == null ? null : Math.min(100, (grip.session.peak_mu / 2) * 100),
      color: CH.a,
      note:
        grip == null
          ? (bundle.absences.find((a) => a.key === "grip")?.short ??
            "Not measured for this session.")
          : "Horizontal force over the load pressing the car down. The grip you used, not the grip the tyres had.",
    },
    {
      label: "most slip angle",
      value: cp?.slip.measured ? (cp.slip.peak_deg ?? null) : null,
      unit: "° pointing vs going",
      bar:
        cp?.slip.measured && cp.slip.peak_deg != null
          ? Math.min(100, (cp.slip.peak_deg / 15) * 100)
          : null,
      color: CH.b,
      note:
        cp == null
          ? (bundle.absences.find((a) => a.key === "contact_patch")?.short ??
            "Not measured for this session.")
          : cp.slip.measured
            ? "The angle between where the car pointed and where it went, from the car's own velocity."
            : (cp.slip.reason ?? "Not measured for this session."),
    },
    // The rig's own signals, worded once in lib/proctor/equipment.
    ...(hw
      ? equipmentReadings(hw).map((r) => ({
          label: r.label,
          value: r.value,
          unit: r.unit,
          bar: r.bar,
          color: r.flagged ? CH.warn : r.key === "ffb" ? CH.a : "var(--color-text)",
          note: r.note,
          flagged: r.flagged,
          decimals: r.decimals,
        }))
      : [
          {
            label: "your equipment",
            value: null,
            unit: "",
            bar: null,
            color: "var(--color-text)",
            note:
              bundle.absences.find((a) => a.key === "hardware")?.short ??
              "The hardware module did not run on this session.",
          },
        ]),
  ];

  const answer = [
    ...(grip ? explainGrip(grip).slice(0, 1) : []),
    ...(ir ? explainInputResponse(ir).slice(0, 1) : []),
  ];

  return (
    <div>
      <header style={{ padding: "var(--space-3) var(--space-6) var(--space-4)" }}>
        {/* "Physics", not "Forces". The tab that opens this screen says
            Physics, the desktop top bar says Physics, and this heading sat
            directly above a tab bar whose active tab read Physics — one screen
            wearing two names, six pixels apart. */}
        <h1 style={{ font: "500 24px var(--font-heading)", margin: 0 }}>Physics</h1>
        <div style={{ fontSize: 12, color: dim(45), marginTop: 2 }}>
          from your foot to the ground, in the order it happened
        </div>
      </header>

      <div
        style={{
          padding: "0 var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {answer.length > 0 && (
          <Panel padding="var(--space-4)">
            <Explain items={answer} compact />
          </Panel>
        )}

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
              {s.flagged && (
                <TriangleAlert size={11} strokeWidth={2} color={CH.warn} aria-label="worth watching" />
              )}
              <span style={{ flex: 1 }} />
              <span
                className="num"
                style={{
                  font: "500 20px var(--font-heading)",
                  color: s.value == null ? dim(35) : s.color,
                }}
              >
                {s.value == null ? "—" : fixed(s.value, s.decimals ?? (s.value >= 100 ? 0 : 2))}
              </span>
              <span style={{ fontSize: 10, color: dim(38) }}>{s.unit}</span>
            </div>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: dim(8),
                marginTop: "var(--space-3)",
                overflow: "hidden",
              }}
            >
              {s.bar != null && (
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, s.bar))}%`,
                    background: s.color,
                    transformOrigin: "left",
                    animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s`,
                  }}
                />
              )}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(50), marginTop: "var(--space-2)" }}>
              {s.note}
            </div>
          </Panel>
        ))}

        {hw && <Caveat>{noteFor("pedal.signal")}</Caveat>}

        <Panel padding="var(--space-4)" foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}>
          <div style={{ font: "500 12.5px var(--font-heading)", marginBottom: "var(--space-2)" }}>
            Grip you demonstrated
          </div>
          <svg
            viewBox="0 0 300 300"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: 230, display: "block" }}
            aria-hidden
          >
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

        <TechniqueNotes notes={techniqueForSteerTorque(cp)} showBecause={false} />

        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "flex-start",
            padding: "var(--space-3) 0",
          }}
        >
          <Ban size={16} color={dim(38)} style={{ flex: "none", marginTop: 1 }} />
          <span style={{ fontSize: 11.5, lineHeight: 1.55, color: dim(50) }}>
            {noteFor("racecraft")} {noteFor("brake.temperature")} {noteFor("tire.load_kg")}
          </span>
        </div>
      </div>
    </div>
  );
}
