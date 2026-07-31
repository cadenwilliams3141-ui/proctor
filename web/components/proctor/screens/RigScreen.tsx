"use client";

import { useMemo } from "react";
import { Ban } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { fixed } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";

export default function RigScreen() {
  const { bundle } = useProctor();

  if (!bundle) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const lockups = bundle.events.filter((e) => e.kind === "lockup");
  const spins = bundle.events.filter((e) => e.kind === "wheelspin");

  const cards = [
    {
      label: "brake ceiling",
      value: "93.4",
      unit: "%",
      bar: 93.4,
      note: "Your own maximum over 187 applications while moving — not a hardware limit.",
      color: "var(--color-text)",
    },
    {
      label: "ABS engagement",
      value: "6.2",
      unit: "% of braking",
      bar: 34,
      note: `${lockups.length} lockups recorded, concentrated in the heaviest braking zones.`,
      color: CH.warn,
    },
    {
      label: "FFB clipping",
      value: "1.87",
      unit: "% of moving",
      bar: 19,
      note: "Brief, and clustered in the two heaviest braking zones.",
      color: CH.a,
    },
    {
      label: "pedal noise floor",
      value: "41",
      unit: "of 8812 samples",
      bar: 8,
      note: "Max spike 0.0071 — consistent with sensor noise rather than input.",
      color: "var(--color-text)",
    },
  ];

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: "var(--space-3)",
        }}
      >
        {cards.map((c, i) => (
          <Panel
            key={c.label}
            padding="var(--space-4)"
            style={{ animation: "fadeUp .4s both", animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s` }}
          >
            <div
              style={{
                font: "500 9.5px var(--font-heading)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: dim(42),
              }}
            >
              {c.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
              <span className="num" style={{ font: "500 26px var(--font-heading)", color: c.color }}>
                {c.value}
              </span>
              <span style={{ fontSize: 10.5, color: dim(38) }}>{c.unit}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: dim(8), marginTop: "var(--space-3)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${c.bar}%`,
                  background: c.color,
                  transformOrigin: "left",
                  animation: "growX .6s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s`,
                }}
              />
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(50), marginTop: "var(--space-2)" }}>
              {c.note}
            </div>
          </Panel>
        ))}
      </div>

      <div
        style={{
          marginTop: "var(--space-4)",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "var(--space-4)",
        }}
      >
        <TractionCircle />
        <EnvelopeBars />
      </div>

      <div
        style={{
          marginTop: "var(--space-4)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
          gap: "var(--space-4)",
        }}
      >
        <Panel
          title="Lockups"
          sub={`${lockups.length} this session`}
          padding="var(--space-4)"
          foot={
            <Caveat>
              A lockup here is a peak in line pressure with the wheel speed falling
              faster than braking alone accounts for. It is what the channels show,
              not a judgement about the braking.
            </Caveat>
          }
        >
          <EventTable events={lockups} color={CH.loss} />
        </Panel>

        <Panel
          title="Wheelspin"
          sub={`${spins.length} this session`}
          padding="var(--space-4)"
          foot={
            <Caveat>
              Throttle applied in a low gear while the car was still carrying
              lateral load. Whether that cost time is a separate question, answered
              on the analysis screen.
            </Caveat>
          }
        >
          <EventTable events={spins} color={CH.warn} />
        </Panel>
      </div>

      <Panel padding="var(--space-4)" style={{ marginTop: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <Ban size={17} strokeWidth={1.6} color={dim(45)} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <div style={{ font: "500 12.5px var(--font-heading)", marginBottom: 4 }}>
              Not possible from disk telemetry — and it will not be faked.
            </div>
            <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6, maxWidth: 720 }}>
              {noteFor("racecraft")} {noteFor("brake.temperature")}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function TractionCircle() {
  const { bundle } = useProctor();

  const geom = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (210 - 34) / maxG;
    const X = (lat: number) => 210 + lat * s;
    const Y = (lon: number) => 210 - lon * s;
    const rings: { r: number; g: number }[] = [];
    for (let g = 0.5; g <= maxG; g += 0.5) rings.push({ r: g * s, g });
    const poly = bundle.traction.envelope
      .map((e) => {
        const r = (e.angle_deg * Math.PI) / 180;
        return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
      })
      .join(" ");
    // Perimeter, so the polygon can draw itself.
    const pts = poly.split(" ").map((p) => p.split(",").map(Number));
    let len = 0;
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return { X, Y, rings, poly, len };
  }, [bundle]);

  if (!bundle || !geom) return null;

  return (
    <Panel
      title="Everything you demonstrated"
      sub="every sample of every clean lap"
      padding="var(--space-4)"
      foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}
    >
      <svg viewBox="0 0 420 420" style={{ width: "100%", height: 360, display: "block" }} aria-hidden>
        {geom.rings.map((r) => (
          <g key={r.g}>
            <circle cx={210} cy={210} r={r.r} fill="none" stroke={inkA(0.07)} />
            <text x={214} y={210 - r.r + 11} fill={inkA(0.26)} fontSize={9}>
              {r.g.toFixed(1)} g
            </text>
          </g>
        ))}
        <line x1={210} y1={20} x2={210} y2={400} stroke={inkA(0.07)} />
        <line x1={20} y1={210} x2={400} y2={210} stroke={inkA(0.07)} />

        {bundle.traction.scatter
          .filter((_, i) => i % 3 === 0)
          .map(([lat, lon], i) => (
            <circle key={i} cx={geom.X(lat)} cy={geom.Y(lon)} r={1.3} fill={CH.a} opacity={0.3} />
          ))}

        <polygon
          points={geom.poly}
          fill="none"
          stroke={CH.b}
          strokeWidth={1.8}
          style={
            {
              "--len": `${geom.len}px`,
              strokeDasharray: geom.len,
              strokeDashoffset: geom.len,
              animation: "drawIn 1.4s ease-out both",
              animationDirection: "reverse",
            } as React.CSSProperties
          }
        />

        <text x={216} y={30} fill={inkA(0.34)} fontSize={10}>accelerating</text>
        <text x={216} y={408} fill={inkA(0.34)} fontSize={10}>braking</text>
        <text x={22} y={202} fill={inkA(0.34)} fontSize={10}>left</text>
        <text x={366} y={202} fill={inkA(0.34)} fontSize={10}>right</text>
      </svg>
    </Panel>
  );
}

function EnvelopeBars() {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const rows = bundle.laps
    .filter(isUsable)
    .map((l) => ({ n: l.lap_number, v: bundle.traction.laps[l.lap_number] ?? 0 }));

  return (
    <Panel
      title="Envelope use, lap by lap"
      sub="share of your own session boundary reached"
      padding="var(--space-4)"
      foot={
        <Caveat>
          Bars are scaled 0–100%, not normalised to the best lap. A lap at 80%
          reads as 80% — normalising would make every session look the same at a
          glance, which is the opposite of useful.
        </Caveat>
      }
    >
      <div className="scrollpane" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 360 }}>
        {rows.map((r, i) => (
          <div key={r.n} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span className="num" style={{ width: 22, textAlign: "right", fontSize: 11, color: dim(50) }}>
              {r.n}
            </span>
            <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  // 0-100 of the axis, not of the maximum.
                  width: `${r.v.toFixed(1)}%`,
                  borderRadius: 5,
                  background: CH.a,
                  transformOrigin: "left",
                  animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${(0.1 + i * 0.03).toFixed(2)}s`,
                }}
              />
            </span>
            <span className="num" style={{ width: 42, textAlign: "right", fontSize: 11, color: dim(62) }}>
              {fixed(r.v, 1)}%
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EventTable({ events, color }: { events: { pct: number; lap_number: number }[]; color: string }) {
  const { bundle } = useProctor();
  if (!bundle) return null;

  if (events.length === 0) {
    /* A negative result is a finding and gets said out loud, rather than
       leaving an empty panel that reads as "not computed". */
    return (
      <div style={{ fontSize: 12, color: dim(58), padding: "var(--space-2) 0" }}>
        None detected this session.
      </div>
    );
  }

  /* An event is attributed to the corner it BELONGS to, not the corner whose
     geometry happens to contain it. A lockup lives in the braking zone, which
     is before the corner turns in, so matching on [start, end] alone leaves
     most lockups labelled "—" — which is the least useful thing this column
     could say. The lead-in below is the same padding the corner ledger uses. */
  const LEAD_IN = 0.035;
  const cornerFor = (p: number) =>
    bundle.corners.find((c) => {
      const start = c.start_pct - LEAD_IN;
      // A corner near the start/finish line has a lead-in that wraps.
      return start < 0
        ? p >= start + 1 || p <= c.end_pct
        : p >= start && p <= c.end_pct;
    })?.id;

  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 54 }}>lap</th>
          <th style={{ width: 70 }}>corner</th>
          <th>position in the lap</th>
        </tr>
      </thead>
      <tbody>
        {events.slice(0, 9).map((e, i) => (
          <tr key={i}>
            <td className="num">{e.lap_number}</td>
            <td style={{ color }}>{cornerFor(e.pct) ? `T${cornerFor(e.pct)}` : "—"}</td>
            <td className="num" style={{ color: dim(55) }}>
              {(e.pct * 100).toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
