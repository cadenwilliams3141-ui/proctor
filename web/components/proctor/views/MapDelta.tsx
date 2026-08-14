"use client";

/* View 3 — "Map & delta". The closest of the three to the old lap-analysis
 * page, but given hierarchy: a KPI strip that answers the session in five
 * numbers, then the line, then the traces. */

import { useEffect, useMemo, useRef } from "react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import NotDrawable from "@/components/proctor/ui/NotDrawable";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import { fmtDelta, fmtLap, kmh } from "@/lib/proctor/format";
import { areaPath, polyline, sharedExtent, wrapIndex } from "@/lib/proctor/geometry";
import { deltaCurve } from "@/lib/proctor/ledger";
import { noteFor } from "@/lib/proctor/provenance";
import { norm, tireRamp } from "@/lib/proctor/ramps";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

export default function MapDelta() {
  const { bundle, state, dispatch, ledger, traceA, traceB, referenceLap, readiness } =
    useProctor();

  const kpis = useMemo(() => {
    if (!bundle || !ledger || !traceA) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    const mean = times.reduce((s, v) => s + v, 0) / Math.max(times.length, 1);
    const sd = Math.sqrt(
      times.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(times.length, 1),
    );
    const flagged = bundle.laps.filter((l) => l.is_anomalous).length;
    const partial = bundle.laps.filter((l) => l.is_out_lap).length;
    const envelope = bundle.traction.laps[traceA.lap_number] ?? 0;

    return [
      {
        label: "best valid lap",
        value: Math.min(...times),
        unit: "",
        sub: `lap ${referenceLap} · reference`,
        fmt: (v: number) => fmtLap(v),
      },
      {
        label: "clean laps",
        value: clean.length,
        unit: `of ${bundle.laps.length}`,
        sub: `${flagged} flagged, ${partial} out/in`,
        fmt: (v: number) => v.toFixed(0),
      },
      {
        label: "consistency",
        value: sd,
        unit: "s σ",
        sub: "your own spread, clean laps",
        fmt: (v: number) => v.toFixed(3),
      },
      {
        label: "envelope use",
        value: envelope,
        unit: "%",
        sub: "of your own session boundary",
        color: CH.a,
        fmt: (v: number) => v.toFixed(1),
      },
      {
        label: "gap to best",
        value: ledger.lapDelta,
        unit: "s",
        sub: `lap ${state.lapB} against lap ${state.lapA}`,
        color: ledger.lapDelta > 0 ? CH.loss : CH.gain,
        fmt: (v: number) => fmtDelta(v),
      },
    ];
  }, [bundle, ledger, traceA, referenceLap, state.lapA, state.lapB]);

  if (readiness.state !== "ready" || !bundle || !ledger || !traceA || !traceB || !kpis) {
    return <NotDrawable readiness={readiness.state === "ready" ? { state: "loading" } : readiness} />;
  }

  const n = traceA.speed.length;
  const ci = wrapIndex(Math.round(state.cursor * (n - 1)), n);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          padding: "var(--space-4) var(--space-6) var(--space-3)",
          flex: "none",
        }}
      >
        {kpis.map((k) => (
          <CountUp key={k.label} {...k} />
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1.18fr",
          gap: "var(--space-3)",
          padding: "0 var(--space-6)",
        }}
      >
        <Panel
          title="Driven line"
          sub={`lap ${traceA.lap_number} · brightness = speed`}
          padding="var(--space-3) var(--space-3) var(--space-2)"
          style={{ minHeight: 0 }}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <TrackMap
              x={bundle.map.x_m}
              y={bundle.map.y_m}
              w={520}
              h={430}
              speed={traceA.speed}
              drawIn
              apexes={bundle.corners}
              events={bundle.events.filter((e) => e.lap_number === traceA.lap_number)}
              car={ci}
              trail={0}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "var(--space-2) var(--space-2) 0",
              flex: "none",
            }}
          >
            <span className="num" style={{ fontSize: 10, color: dim(40) }}>
              {kmh(Math.min(...traceA.speed))}
            </span>
            <span
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background:
                  "linear-gradient(to right, var(--ramp-slow), var(--color-accent-2-600), var(--ch-a), var(--ramp-fast))",
              }}
            />
            <span className="num" style={{ fontSize: 10, color: dim(40) }}>
              {kmh(Math.max(...traceA.speed))} km/h
            </span>
            <Dot color={CH.loss} label="lockup" />
            <Dot color={CH.warn} label="wheelspin" />
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0 }}>
          <DeltaSpeedChart ci={ci} onScrub={(p) => dispatch({ t: "cursor", cursor: p })} />
          {atLeast(state.tier, "deep") && <TireStrip />}
        </div>
      </div>

      {atLeast(state.tier, "deep") && (
        <div style={{ flex: "none", padding: "var(--space-3) var(--space-6) var(--space-6)" }}>
          <InputsPanel ci={ci} />
        </div>
      )}
    </div>
  );
}

/* The count-up writes to a ref, NOT through state.
 *
 * Driving it through state would re-render this subtree ~60 times in a second,
 * and every one of those renders would restart the CSS entrance animations on
 * the map, the chart wipe and the tire strip. Writing textContent leaves the
 * React tree entirely alone. */
function CountUp({
  label,
  value,
  unit,
  sub,
  color,
  fmt,
}: {
  label: string;
  value: number;
  unit: string;
  sub: string;
  color?: string;
  fmt: (v: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const settle = () => {
      el.textContent = fmt(value);
    };

    /* requestAnimationFrame does not run while the page is hidden or occluded.
       Since the number only ever exists BECAUSE of the animation, a tab
       switched away during load would come back to a blank KPI — and stay
       blank, because nothing re-renders to retry. So: settle immediately when
       there will be no animation, and keep a timer that writes the final value
       regardless. If the sweep ran, the timer writes the same thing. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
      settle();
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1000);
      const eased = 1 - (1 - p) ** 3;
      el.textContent = fmt(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const guard = setTimeout(settle, 1200);
    document.addEventListener("visibilitychange", settle);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(guard);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [value, fmt]);

  return (
    <div style={{ flex: 1, paddingRight: "var(--space-6)", minWidth: 0 }}>
      <div
        style={{
          font: "500 9.5px var(--font-heading)",
          letterSpacing: ".11em",
          textTransform: "uppercase",
          color: dim(42),
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 3 }}>
        <span
          ref={ref}
          className="num"
          style={{ font: "500 25px/1 var(--font-heading)", color: color ?? "var(--color-text)" }}
        />
        <span style={{ fontSize: 11, color: dim(40) }}>{unit}</span>
      </div>
      <div style={{ fontSize: 10.5, color: dim(35), marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: dim(40) }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function DeltaSpeedChart({ ci, onScrub }: { ci: number; onScrub: (p: number) => void }) {
  const { bundle, traceA, traceB, ledger } = useProctor();
  const box = useRef<HTMLDivElement>(null);

  const paths = useMemo(() => {
    if (!traceA || !traceB) return null;
    const n = traceA.speed.length;
    const X = (i: number) => 34 + (i / (n - 1)) * (636 - 34);
    const [sLo, sHi] = sharedExtent(traceA.speed, traceB.speed);
    const sY = (v: number) => 190 - norm(v, sLo, sHi) * (190 - 22);

    const delta = deltaCurve(traceA, traceB);
    const dLo = Math.min(0, ...delta);
    const dHi = Math.max(0, ...delta);
    const dY = (v: number) => 312 - norm(v, dLo, dHi) * (312 - 214);

    return {
      n,
      X,
      sY,
      dY,
      delta,
      speedA: polyline(traceA.speed, (i) => X(i), sY),
      speedB: polyline(traceB.speed, (i) => X(i), sY),
      deltaArea: areaPath(delta, (i) => X(i), dY, dY(0)),
      deltaLine: polyline(delta, (i) => X(i), dY),
      zeroY: dY(0),
      grid: [0, 1, 2, 3].map((g) => {
        const v = sLo + ((sHi - sLo) * (3 - g)) / 3;
        return { y: sY(v), label: kmh(v) };
      }),
    };
  }, [traceA, traceB]);

  if (!bundle || !paths || !traceA || !ledger) return null;

  return (
    <Panel
      title="Time delta & speed"
      sub={`lap ${traceB?.lap_number} against lap ${traceA.lap_number}`}
      padding="var(--space-3) var(--space-2) var(--space-2) var(--space-3)"
      style={{ flex: 1, minHeight: 0 }}
      right={
        <span className="num" style={{ fontSize: 11, color: CH.loss }}>
          {fmtDelta(ledger.lapDelta)} s
        </span>
      }
    >
      <div
        ref={box}
        style={{ flex: 1, minHeight: 0, cursor: "crosshair" }}
        onPointerMove={(e) => {
          const r = box.current?.getBoundingClientRect();
          if (!r) return;
          const vx = ((e.clientX - r.left) / r.width) * 640;
          onScrub(Math.max(0, Math.min(1, (vx - 34) / (636 - 34))));
        }}
      >
        <svg
          viewBox="0 0 640 330"
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <linearGradient id="md-loss" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={CH.loss} stopOpacity="0.42" />
              <stop offset="1" stopColor={CH.loss} stopOpacity="0.02" />
            </linearGradient>
            <clipPath id="md-wipe">
              <rect
                x="0"
                y="0"
                width="640"
                height="330"
                style={{
                  transformOrigin: "0 0",
                  animation: "wipeX 1.4s cubic-bezier(.3,.7,.2,1) both",
                  animationDelay: ".2s",
                }}
              />
            </clipPath>
          </defs>

          {ledger.corners.map((c) => {
            const x = paths.X(Math.round(c.corner.start_pct * (paths.n - 1)));
            const w = Math.max(2, paths.X(Math.round(c.corner.end_pct * (paths.n - 1))) - x);
            return (
              <g key={c.corner.id}>
                <rect x={x} y={0} width={w} height={196} fill={inkA(0.045)} />
                <text
                  x={x + w / 2}
                  y={11}
                  fill={inkA(0.34)}
                  fontSize={8.5}
                  fontWeight={500}
                  textAnchor="middle"
                >
                  T{c.corner.id}
                </text>
              </g>
            );
          })}

          {paths.grid.map((g, i) => (
            <g key={i}>
              <line x1={34} y1={g.y} x2={636} y2={g.y} stroke={inkA(0.06)} />
              <text x={30} y={g.y + 3} fill={inkA(0.34)} fontSize={9} textAnchor="end">
                {g.label}
              </text>
            </g>
          ))}

          <g clipPath="url(#md-wipe)">
            <polyline points={paths.speedA} fill="none" stroke={CH.a} strokeWidth={1.6} />
            <polyline points={paths.speedB} fill="none" stroke={CH.b} strokeWidth={1.6} opacity={0.85} />
          </g>

          <text x={36} y={208} fill={inkA(0.34)} fontSize={9}>
            Δt · s
          </text>
          <line
            x1={34}
            y1={paths.zeroY}
            x2={636}
            y2={paths.zeroY}
            stroke={inkA(0.16)}
            strokeDasharray="2 3"
          />
          <g clipPath="url(#md-wipe)">
            <path d={paths.deltaArea} fill="url(#md-loss)" />
            <polyline points={paths.deltaLine} fill="none" stroke={CH.loss} strokeWidth={1.5} />
          </g>

          <line
            x1={paths.X(ci)}
            y1={0}
            x2={paths.X(ci)}
            y2={318}
            stroke="#e9e9ed"
            strokeWidth={1}
            opacity={0.5}
          />
          <circle cx={paths.X(ci)} cy={paths.sY(traceA.speed[ci])} r={3.4} fill={CH.a} />
          <circle cx={paths.X(ci)} cy={paths.dY(paths.delta[ci])} r={3.4} fill={CH.loss} />
        </svg>
      </div>
    </Panel>
  );
}

function TireStrip() {
  const { bundle } = useProctor();

  const rows = useMemo(() => {
    if (!bundle) return null;
    const bands = [bundle.tire.left_c, bundle.tire.middle_c, bundle.tire.right_c];
    const [lo, hi] = sharedExtent(...bands);
    const cells = 120;
    const w = (640 - 22) / cells;
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    return {
      medians: bands.map(median),
      grid: bands.map((band, r) =>
        Array.from({ length: cells }, (_, i) => ({
          x: 22 + i * w,
          w: w + 0.4,
          y: 4 + r * 20,
          fill: tireRamp(norm(band[Math.floor((i / cells) * band.length)], lo, hi)),
        })),
      ),
    };
  }, [bundle]);

  if (!rows) return null;

  return (
    <Panel
      title="Left-front surface temp"
      sub="the only tire channel the .ibt carries"
      style={{ flex: "none" }}
      padding="var(--space-3) var(--space-3) var(--space-3)"
      right={
        <span className="num" style={{ fontSize: 10.5, color: dim(45) }}>
          {rows.medians.map((m) => m.toFixed(0)).join(" / ")} °C
        </span>
      }
      foot={<Caveat>{noteFor("tire.other_corners")}</Caveat>}
    >
      <svg
        viewBox="0 0 640 64"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 64, display: "block" }}
        aria-hidden
      >
        <defs>
          <clipPath id="tire-wipe">
            <rect
              x="0"
              y="0"
              width="640"
              height="64"
              style={{
                transformOrigin: "0 0",
                animation: "wipeX 1.2s cubic-bezier(.3,.7,.2,1) both",
                animationDelay: ".4s",
              }}
            />
          </clipPath>
        </defs>
        <g clipPath="url(#tire-wipe)">
          {rows.grid.map((row, r) => (
            <g key={r}>
              <text x={0} y={4 + r * 20 + 12} fill={inkA(0.4)} fontSize={9} fontWeight={500}>
                {["L", "M", "R"][r]}
              </text>
              {row.map((c, i) => (
                <rect key={i} x={c.x} y={c.y} width={c.w} height={16} fill={c.fill} />
              ))}
            </g>
          ))}
        </g>
      </svg>
    </Panel>
  );
}

/* Three lanes, each with its own band and its own row for a label.
 *
 * The labels used to sit at the vertical MIDDLE of the lane they name — which
 * is exactly where that lane's trace runs, so a full-throttle stretch drew
 * straight through the word "throttle". They are on the lane's baseline now,
 * in a gutter the traces never enter, and each lane has a band so a trace
 * cannot stray into its neighbour's row either.
 *
 * The brake lane draws TWO things: the pedal sensor under your foot, and the
 * pressure the car actually applied. Where they part company is the ABS taking
 * pressure back out, which is otherwise invisible on this screen. */
const LANE_H = 42;
const LANE_GAP = 8;
const GUTTER = 58;
const PLOT_R = 1176;
const IN_VB_W = 1180;
const IN_VB_H = 3 * LANE_H + 2 * LANE_GAP + 12;

interface InputSeries {
  points: string;
  color: string;
  width: number;
  opacity: number;
  /** Set only on the brake pedal trace, so it reads as the request rather than
   *  as a second measurement of what the car did. */
  dash?: string;
}

function InputsPanel({ ci }: { ci: number }) {
  const { traceA, traceB } = useProctor();

  const lanes = useMemo(() => {
    if (!traceA || !traceB) return null;
    const n = traceA.speed.length;
    const X = (i: number) => GUTTER + (i / (n - 1)) * (PLOT_R - GUTTER);
    const maxSteer = Math.max(...traceA.steer.map(Math.abs), ...traceB.steer.map(Math.abs), 1e-6);

    const top = (row: number) => 8 + row * (LANE_H + LANE_GAP);
    // Pedals fill downward from the top of their lane; steering is centred on
    // its own zero line, because zero lock is the middle of that channel.
    const pedalY = (row: number) => (v: number) => top(row) + LANE_H - v * (LANE_H - 4);
    const steerY = (row: number) => (v: number) =>
      top(row) + LANE_H / 2 - (v / maxSteer) * (LANE_H / 2 - 3);

    return {
      X,
      maxSteer,
      rows: ([
        {
          label: "throttle",
          unit: "0–100%",
          top: top(0),
          baseline: top(0) + LANE_H,
          series: [
            { points: polyline(traceA.throttle, X, pedalY(0)), color: CH.a, width: 1.4, opacity: 1 },
            { points: polyline(traceB.throttle, X, pedalY(0)), color: CH.b, width: 1.4, opacity: 0.8 },
          ],
        },
        {
          label: "brake",
          unit: "pedal vs applied",
          top: top(1),
          baseline: top(1) + LANE_H,
          series: [
            /* brake_raw is the sensor under the foot; brake is what the car
               used. Drawn on one lane so the gap between them reads as the gap
               it is, rather than as two unrelated shapes. */
            {
              points: polyline(traceA.brake_raw, X, pedalY(1)),
              color: CH.loss,
              width: 1.1,
              opacity: 0.55,
              dash: "3 3",
            },
            { points: polyline(traceA.brake, X, pedalY(1)), color: CH.a, width: 1.4, opacity: 1 },
            { points: polyline(traceB.brake, X, pedalY(1)), color: CH.b, width: 1.4, opacity: 0.8 },
          ],
        },
        {
          label: "steer",
          unit: `±${((maxSteer * 180) / Math.PI).toFixed(0)}°`,
          top: top(2),
          baseline: top(2) + LANE_H / 2,
          centred: true,
          series: [
            { points: polyline(traceA.steer, X, steerY(2)), color: CH.a, width: 1.4, opacity: 1 },
            { points: polyline(traceB.steer, X, steerY(2)), color: CH.b, width: 1.4, opacity: 0.8 },
          ],
        },
      ] as {
        label: string;
        unit: string;
        top: number;
        baseline: number;
        centred?: boolean;
        series: InputSeries[];
      }[]),
    };
  }, [traceA, traceB]);

  if (!lanes || !traceA) return null;

  return (
    <Panel
      title="Inputs"
      sub="lap A solid, lap B behind it · the dashed line is your brake pedal, the solid one the pressure the car used"
      padding="var(--space-3)"
    >
      <svg
        viewBox={`0 0 ${IN_VB_W} ${IN_VB_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: IN_VB_H, display: "block" }}
        aria-hidden
      >
        <defs>
          <clipPath id="in-wipe">
            <rect
              x={GUTTER}
              y="0"
              width={PLOT_R - GUTTER}
              height={IN_VB_H}
              style={{
                transformOrigin: `${GUTTER}px 0`,
                animation: "wipeX 1.5s cubic-bezier(.3,.7,.2,1) both",
                animationDelay: ".3s",
              }}
            />
          </clipPath>
        </defs>

        {lanes.rows.map((l) => (
          <g key={l.label}>
            {/* The lane's own band, so a trace can never be read against the
                wrong label. */}
            <rect x={GUTTER} y={l.top} width={PLOT_R - GUTTER} height={LANE_H} fill={inkA(0.022)} />
            <text x={0} y={l.top + 11} fill={inkA(0.46)} fontSize={10} fontWeight={500}>
              {l.label}
            </text>
            <text x={0} y={l.top + 23} fill={inkA(0.26)} fontSize={9}>
              {l.unit}
            </text>
            <line
              x1={GUTTER}
              y1={l.baseline}
              x2={PLOT_R}
              y2={l.baseline}
              stroke={inkA(l.centred ? 0.12 : 0.09)}
              strokeDasharray={l.centred ? "2 3" : undefined}
            />
            <g clipPath="url(#in-wipe)">
              {l.series.map((s, i) => (
                <polyline
                  key={i}
                  points={s.points}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width}
                  opacity={s.opacity}
                  strokeDasharray={s.dash}
                />
              ))}
            </g>
          </g>
        ))}

        <line
          x1={lanes.X(ci)}
          y1={0}
          x2={lanes.X(ci)}
          y2={IN_VB_H - 4}
          stroke="#e9e9ed"
          strokeWidth={1}
          opacity={0.4}
        />
      </svg>
    </Panel>
  );
}
