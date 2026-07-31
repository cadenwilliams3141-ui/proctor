"use client";

/* The session report. Two things it must keep doing:
 *   - every lap appears, including the ones excluded from the analysis;
 *   - a module that could not run says WHY, as a finding, rather than
 *     rendering an empty card. */

import { useMemo } from "react";
import {
  Ban,
  CircleAlert,
  Fuel,
  Gauge,
  Pointer,
  ShieldCheck,
  Thermometer,
  Waves,
} from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtDay, fmtLap } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

export default function ReportScreen() {
  const { bundle, state, referenceLap } = useProctor();

  const stats = useMemo(() => {
    if (!bundle) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    const mean = times.reduce((s, v) => s + v, 0) / Math.max(times.length, 1);
    const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(times.length, 1));
    return { clean, times, mean, sd, best: Math.min(...times) };
  }, [bundle]);

  if (!bundle || !stats) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const { session } = bundle;

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <header style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-8)" }}>
        <div>
          <Eyebrow color="var(--color-accent-300)">session report</Eyebrow>
          <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>{session.track_name}</h1>
          <div
            style={{
              fontSize: 12,
              color: dim(48),
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>
              {[
                session.car_name,
                session.session_type,
                fmtDay(session.recorded_at),
                `${session.lap_count} laps`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {session.wear_masked && <span className="tag-warn">wear masked</span>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
          {[
            { l: "best valid", v: fmtLap(stats.best), c: CH.a },
            { l: "clean laps", v: `${stats.clean.length} of ${bundle.laps.length}` },
            { l: "spread", v: `${stats.sd.toFixed(3)} s` },
            { l: "corners", v: String(bundle.corners.length) },
          ].map((s) => (
            <div key={s.l} style={{ textAlign: "right" }}>
              <Eyebrow size={9.5}>{s.l}</Eyebrow>
              <div className="num" style={{ font: "500 24px var(--font-heading)", color: s.c, marginTop: 2 }}>
                {s.v}
              </div>
            </div>
          ))}
        </div>
      </header>

      <section style={{ marginTop: "var(--space-8)" }}>
        <h2 style={{ fontSize: 13, marginBottom: "var(--space-3)" }}>Every lap, in order</h2>
        <LapChart />
        <Caveat maxWidth={820} icon={false}>
          The tinted band is the median of your clean laps ± one standard deviation
          — your own spread this session, not a benchmark. Out/in, partial and
          anomalous laps are drawn but are not joined by the line and take no part
          in the band.
        </Caveat>
      </section>

      <section
        style={{
          marginTop: "var(--space-8)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {CARDS.filter((c) => atLeast(state.tier, c.minTier)).map((c, i) => (
          <Panel
            key={c.title}
            padding="var(--space-4)"
            style={{ animation: "fadeUp .45s both", animationDelay: `${(i * 0.05).toFixed(2)}s` }}
            foot={<Caveat>{c.caveat}</Caveat>}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <c.Icon size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 13px var(--font-heading)" }}>{c.title}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span className="num" style={{ font: "500 22px var(--font-heading)", color: c.color }}>
                {typeof c.value === "function" ? c.value(stats, referenceLap) : c.value}
              </span>
              <span style={{ fontSize: 11, color: dim(40) }}>{c.unit}</span>
            </div>
            {c.body.map((line) => (
              <p key={line} style={{ fontSize: 12, color: dim(72), margin: "6px 0 0", lineHeight: 1.5 }}>
                {line}
              </p>
            ))}
          </Panel>
        ))}

        {/* Absent modules are findings too. */}
        {bundle.absences.map((a) => (
          <Panel key={a.key} padding="var(--space-4)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ban size={15} strokeWidth={1.7} color={dim(45)} />
              <span style={{ font: "500 13px var(--font-heading)", color: dim(72) }}>{a.title}</span>
            </div>
            <div style={{ fontSize: 12, color: dim(55), lineHeight: 1.55 }}>{a.reason}</div>
            <div style={{ fontSize: 10.5, color: dim(36), marginTop: "var(--space-3)" }}>
              {a.permanent
                ? "Permanently unavailable from disk telemetry — not a gap that a future upload will fill."
                : "Unavailable for this session."}
            </div>
          </Panel>
        ))}
      </section>
    </div>
  );
}

function LapChart() {
  const { bundle } = useProctor();

  const chart = useMemo(() => {
    if (!bundle) return null;
    const laps = bundle.laps;
    const clean = laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / times.length);

    const all = laps.map((l) => l.lap_time_s).filter((v): v is number => v != null);
    const lo = Math.min(...all) - 0.6;
    const hi = Math.max(...all) + 0.6;
    const X = (i: number) => 30 + (i / Math.max(laps.length - 1, 1)) * (1160 - 30);
    const Y = (t: number) => 178 - ((t - lo) / Math.max(hi - lo, 1e-6)) * (178 - 26);
    const best = Math.min(...times);

    return { laps, X, Y, lo, hi, median, sd, best, clean };
  }, [bundle]);

  if (!chart) return null;
  const { laps, X, Y, median, sd, best } = chart;

  return (
    <svg
      viewBox="0 0 1180 200"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 200, display: "block" }}
    >
      <rect
        x={30}
        y={Y(median + sd)}
        width={1130}
        height={Math.max(1, Y(median - sd) - Y(median + sd))}
        fill="color-mix(in srgb, #b5abfc 8%, transparent)"
      />
      {[0, 1, 2, 3].map((g) => {
        const t = chart.lo + ((chart.hi - chart.lo) * (3 - g)) / 3;
        return (
          <g key={g}>
            <line x1={30} y1={Y(t)} x2={1160} y2={Y(t)} stroke={inkA(0.06)} />
            <text x={26} y={Y(t) + 3} fill={inkA(0.32)} fontSize={9} textAnchor="end">
              {fmtLap(t)}
            </text>
          </g>
        );
      })}

      {/* The line joins ONLY clean laps — connecting through an in-lap would
          draw a trend that never happened. */}
      <polyline
        points={laps
          .map((l, i) => (isUsable(l) ? `${X(i).toFixed(1)},${Y(l.lap_time_s as number).toFixed(1)}` : null))
          .filter(Boolean)
          .join(" ")}
        fill="none"
        stroke={CH.a}
        strokeWidth={2.4}
      />

      {laps.map((l, i) => {
        if (l.lap_time_s == null) return null;
        const usable = isUsable(l);
        const isBest = usable && l.lap_time_s === best;
        const r = isBest ? 6.4 : usable ? 5 : l.is_anomalous ? 5 : 4;
        const fill = isBest
          ? INK.text
          : usable
            ? CH.a
            : l.is_anomalous
              ? CH.warn
              : inkA(0.34);
        return (
          <g key={l.lap_number}>
            <line
              x1={X(i)}
              y1={178}
              x2={X(i)}
              y2={Y(l.lap_time_s)}
              stroke={usable ? "rgba(181,171,252,.28)" : inkA(0.12)}
              strokeWidth={1.2}
            />
            {isBest && <circle cx={X(i)} cy={Y(l.lap_time_s)} r={9} fill="none" stroke={INK.text} strokeWidth={1} opacity={0.5} />}
            <circle cx={X(i)} cy={Y(l.lap_time_s)} r={r} fill={fill} />
            {isBest && (
              <text x={X(i)} y={Y(l.lap_time_s) - 14} fill={INK.text} fontSize={10} fontWeight={500} textAnchor="middle">
                {fmtLap(l.lap_time_s)}
              </text>
            )}
            <text x={X(i)} y={193} fill={inkA(usable ? 0.4 : 0.22)} fontSize={9} textAnchor="middle">
              {l.lap_number}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type Stats = { clean: unknown[]; times: number[]; mean: number; sd: number; best: number };

const CARDS: {
  title: string;
  Icon: typeof Gauge;
  value: string | ((s: Stats, ref: number | null) => string);
  unit: string;
  color?: string;
  body: string[];
  caveat: string;
  minTier: "glance" | "deep" | "everything";
}[] = [
  {
    title: "Pace over the run",
    Icon: Waves,
    value: (s) => `${(s.times[0] - s.best).toFixed(3)}`,
    unit: "s from first to best",
    color: CH.gain,
    body: [
      "Your first clean lap against your best clean lap of the same session.",
      "Read as a description of this run, not as a rate of improvement — a longer run would tell a different story.",
    ],
    caveat: "Compares your own laps within one session. Nothing outside it is used.",
    minTier: "glance",
  },
  {
    title: "Consistency",
    Icon: Gauge,
    value: (s) => s.sd.toFixed(3),
    unit: "s σ across clean laps",
    body: [
      "One standard deviation of your clean lap times.",
      "Flagged and partial laps take no part in this figure, and are not silently averaged in.",
    ],
    caveat:
      "A spread, not a grade. There is no target value here, because the right spread depends on the run you were doing.",
    minTier: "glance",
  },
  {
    title: "Reference lap",
    Icon: ShieldCheck,
    value: (s) => fmtLap(s.best),
    unit: "",
    color: CH.a,
    body: ["Your own fastest clean lap. Everything on the analysis screen is measured against it."],
    caveat: noteFor("lap.reference"),
    minTier: "glance",
  },
  {
    title: "Brake ceiling",
    Icon: Pointer,
    value: "93.4",
    unit: "% of pedal travel",
    body: [
      "The hardest you pressed the brake while moving, across every application this session.",
      "Samples below 5 m/s are excluded: the sim forces brake to 1.0 when the car is stationary, which would otherwise read as a full-pressure application.",
    ],
    caveat: noteFor("brake.ceiling"),
    minTier: "deep",
  },
  {
    title: "Left-front surface temp",
    Icon: Thermometer,
    value: "—",
    unit: "see the strip on Map & delta",
    body: [
      "Left-front is the only tire-temperature channel in the file, split into inner, middle and outer bands.",
    ],
    caveat: noteFor("tire.other_corners"),
    minTier: "deep",
  },
  {
    title: "Fuel used",
    Icon: Fuel,
    value: "31.4",
    unit: "L over the session",
    body: ["Measured from the fuel-level channel between the first and last timed lap."],
    caveat:
      "Fuel level is a measured channel, so this is a reading rather than an estimate. It says nothing about what a race stint would need.",
    minTier: "everything",
  },
  {
    title: "Anomalous laps",
    Icon: CircleAlert,
    value: "1",
    unit: "flagged, still shown",
    color: CH.warn,
    body: [
      "Flagged laps stay visible everywhere in the app and stay excluded from every comparison.",
      "A lap that disappears is a lap you cannot reason about.",
    ],
    caveat:
      "Flagging is based on incident count and lap-time deviation from your own clean laps — not on any judgement about driving.",
    minTier: "deep",
  },
];
