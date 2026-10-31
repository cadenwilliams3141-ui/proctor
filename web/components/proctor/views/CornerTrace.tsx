"use client";

/* The corner's telemetry, under the map: speed, pedals and the gap, against
 * distance through the corner.
 *
 * It covers exactly the stretch the map draws, so a point on one is a point on
 * the other — move along the trace and both cars move on the map. The phases
 * from the corner card are marked across the top, cut where the best lap turned
 * in, was slowest and was back on the throttle, so "Exit +0.015" on the card
 * has a place you can see it happen.
 *
 * The gap lane is time lost SINCE THIS STRETCH STARTED, not since the start of
 * the lap: the lap's running total would put a corner's story on top of every
 * corner before it. */

import { useMemo, type PointerEvent } from "react";

import { useSize } from "@/components/proctor/ui/useSize";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import { fmtDelta, kmh } from "@/lib/proctor/format";
import { windowExtent, wrapIndex } from "@/lib/proctor/geometry";
import type { CornerReading, Phase } from "@/lib/proctor/phases";
import type { Trace } from "@/lib/proctor/types";

export interface CornerTraceProps {
  best: Trace;
  lap: Trace;
  /** Cumulative gap of lap against best over the whole lap (ledger.deltaCurve). */
  delta: number[];
  reading: CornerReading;
  view: { from: number; to: number };
  /** Unwrapped index inside `view`, or null to rest on the best lap's apex. */
  cursor: number | null;
  onCursor: (i: number) => void;
  hoverPhase: Phase | null;
  metresPerSample: number;
  pedals: boolean;
  bestName: string;
  lapName: string;
}

const LABEL_W = 58;
const PAD_R = 12;

export default function CornerTrace(props: CornerTraceProps) {
  const [box, size] = useSize<HTMLDivElement>();
  const { best, lap, delta, reading, view, pedals } = props;
  const n = Math.min(best.speed.length, lap.speed.length);
  const at = (a: number[], i: number) => a[wrapIndex(i, a.length)];

  const lanes = useMemo(() => {
    const rows: { key: string; h: number; label: string; unit?: string }[] = [
      { key: "phase", h: 16, label: "" },
      { key: "speed", h: 92, label: "speed", unit: "km/h" },
    ];
    if (pedals) {
      rows.push({ key: "throttle", h: 24, label: "throttle" });
      rows.push({ key: "brake", h: 24, label: "brake", unit: "pedal" });
    }
    rows.push({ key: "gap", h: 38, label: "gap", unit: "s" });
    rows.push({ key: "axis", h: 16, label: "" });
    let y = 0;
    return rows.map((r) => {
      const out = { ...r, y };
      y += r.h + (r.key === "phase" || r.key === "axis" ? 0 : 6);
      return out;
    });
  }, [pedals]);
  const H = lanes[lanes.length - 1].y + lanes[lanes.length - 1].h;
  const W = Math.max(size.w, 1);
  const plotW = Math.max(W - LABEL_W - PAD_R, 1);
  const span = Math.max(view.to - view.from, 1);
  const X = (i: number) => LABEL_W + ((i - view.from) / span) * plotW;
  const lane = (key: string) => lanes.find((l) => l.key === key)!;

  const paths = useMemo(() => {
    const [lo, hi] = windowExtent(view.from, view.to, best.speed, lap.speed);
    const sp = lane("speed");
    const sy = (v: number) => sp.y + 4 + (1 - (v - lo) / Math.max(hi - lo, 0.1)) * (sp.h - 8);
    const line = (vals: number[], y: (v: number) => number) => {
      const pts: string[] = [];
      for (let i = view.from; i <= view.to; i++) pts.push(`${X(i).toFixed(1)} ${y(at(vals, i)).toFixed(1)}`);
      return `M ${pts.join(" L ")}`;
    };
    const pedal = (key: string) => {
      const l = lane(key);
      return (v: number) => l.y + l.h - 2 - Math.max(0, Math.min(1, v)) * (l.h - 4);
    };

    // Gap since the stretch began, unwrapped across the start/finish line the
    // same way the ledger reads it.
    const lapDelta = delta[n - 1];
    const readAt = (i: number) => {
      const k = wrapIndex(i, n);
      return i < 0 ? delta[k] - lapDelta : i >= n ? delta[k] + lapDelta : delta[k];
    };
    const base = readAt(view.from);
    const gaps: number[] = [];
    for (let i = view.from; i <= view.to; i++) gaps.push(readAt(i) - base);
    const g = lane("gap");
    const gMax = Math.max(1e-3, ...gaps.map(Math.abs));
    const gy = (v: number) => g.y + g.h / 2 - (v / gMax) * (g.h / 2 - 2);
    const area = (sign: 1 | -1) => {
      const pts = gaps.map(
        (v, k) => `${X(view.from + k).toFixed(1)} ${gy(sign > 0 ? Math.max(v, 0) : Math.min(v, 0)).toFixed(1)}`,
      );
      return `M ${X(view.from).toFixed(1)} ${gy(0).toFixed(1)} L ${pts.join(" L ")} L ${X(view.to).toFixed(1)} ${gy(0).toFixed(1)} Z`;
    };

    return {
      lo,
      hi,
      speedBest: line(best.speed, sy),
      speedLap: line(lap.speed, sy),
      thrBest: pedals ? line(best.throttle, pedal("throttle")) : "",
      thrLap: pedals ? line(lap.throttle, pedal("throttle")) : "",
      brkBest: pedals ? line(best.brake_raw, pedal("brake")) : "",
      brkLap: pedals ? line(lap.brake_raw, pedal("brake")) : "",
      lossArea: area(1),
      gainArea: area(-1),
      gapLine: `M ${gaps.map((v, k) => `${X(view.from + k).toFixed(1)} ${gy(v).toFixed(1)}`).join(" L ")}`,
      gapZero: gy(0),
      gaps,
    };
    // X depends on plotW; recompute on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [best, lap, delta, view.from, view.to, plotW, pedals, lanes]);

  const ci = props.cursor ?? reading.marks.best.apex;
  const gapAtCursor = paths.gaps[Math.max(0, Math.min(paths.gaps.length - 1, ci - view.from))];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < LABEL_W) return;
    const i = Math.round(view.from + ((x - LABEL_W) / plotW) * span);
    props.onCursor(Math.max(view.from, Math.min(view.to, i)));
  };

  // Distance ticks, measured from the best lap's slowest point.
  const ticks = useMemo(() => {
    const mps = props.metresPerSample;
    const apex = reading.marks.best.apex;
    const lenM = span * mps;
    const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => lenM / s <= 8) ?? 1000;
    const out: { i: number; label: string }[] = [];
    const first = Math.ceil(((view.from - apex) * mps) / step) * step;
    for (let m = first; m <= (view.to - apex) * mps; m += step) {
      out.push({ i: apex + m / mps, label: m === 0 ? "apex" : `${m > 0 ? "+" : ""}${m}` });
    }
    return out;
  }, [props.metresPerSample, reading.marks.best.apex, span, view.from, view.to]);

  const readout = (t: Trace) => ({
    speed: kmh(at(t.speed, ci)),
    gear: Math.round(at(t.gear, ci)),
    thr: Math.round(at(t.throttle, ci) * 100),
    brk: Math.round(at(t.brake_raw, ci) * 100),
  });
  const rl = readout(lap);
  const rb = readout(best);

  return (
    <div className="cr-trace">
      <div className="cr-readout">
        <Readout color={CH.b} name={props.lapName} r={rl} />
        <Readout color={CH.a} name={props.bestName} r={rb} dashed />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: dim(45), letterSpacing: ".06em", textTransform: "uppercase" }}>
          gap
        </span>
        <span
          className="num"
          style={{
            font: "600 14px var(--font-heading)",
            color: gapAtCursor > 0.0005 ? CH.loss : gapAtCursor < -0.0005 ? CH.gain : dim(70),
          }}
        >
          {fmtDelta(gapAtCursor)} s
        </span>
      </div>

      <div ref={box} style={{ position: "relative", height: H }}>
        {size.w > 0 && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block", touchAction: "none", cursor: "crosshair" }}
            onPointerMove={onMove}
            onPointerDown={onMove}
            role="img"
            aria-label={`Speed, pedals and gap through turn ${reading.id}`}
          >
            {/* Phase bands across every lane, labelled along the top. */}
            {reading.phases.map((ph) => {
              const x0 = X(Math.max(ph.from, view.from));
              const x1 = X(Math.min(ph.to, view.to));
              const lit = props.hoverPhase?.id === ph.id || reading.worst === ph.id;
              return (
                <g key={ph.id}>
                  <rect
                    x={x0}
                    y={0}
                    width={Math.max(0, x1 - x0)}
                    height={H - 16}
                    fill={props.hoverPhase?.id === ph.id ? inkA(0.06) : reading.worst === ph.id ? "rgba(224,104,94,.06)" : "transparent"}
                  />
                  <line x1={x0} y1={0} x2={x0} y2={H - 16} stroke={inkA(0.1)} strokeDasharray="2 3" />
                  {x1 - x0 > 36 && (
                    <text
                      x={x0 + 5}
                      y={11}
                      fontSize={9.5}
                      fontWeight={600}
                      letterSpacing=".06em"
                      fill={lit ? (reading.worst === ph.id ? CH.loss : inkA(0.8)) : inkA(0.38)}
                    >
                      {ph.label.toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}

            {lanes
              .filter((l) => l.label)
              .map((l) => (
                <g key={l.key}>
                  <rect x={LABEL_W} y={l.y} width={plotW} height={l.h} fill={inkA(0.025)} />
                  <text x={0} y={l.y + 11} fontSize={10.5} fill={inkA(0.6)}>
                    {l.label}
                  </text>
                  {l.unit && (
                    <text x={0} y={l.y + 23} fontSize={9} fill={inkA(0.32)}>
                      {l.key === "speed" ? `${kmh(paths.lo)}–${kmh(paths.hi)}` : l.unit}
                    </text>
                  )}
                </g>
              ))}

            <path d={paths.speedBest} fill="none" stroke={CH.a} strokeWidth={1.6} strokeDasharray="5 4" />
            <path d={paths.speedLap} fill="none" stroke={CH.b} strokeWidth={1.9} />
            {pedals && (
              <>
                <path d={paths.thrBest} fill="none" stroke={CH.a} strokeWidth={1.2} strokeDasharray="4 3" />
                <path d={paths.thrLap} fill="none" stroke={CH.b} strokeWidth={1.4} />
                <path d={paths.brkBest} fill="none" stroke={CH.a} strokeWidth={1.2} strokeDasharray="4 3" />
                <path d={paths.brkLap} fill="none" stroke={CH.b} strokeWidth={1.4} />
              </>
            )}

            <line x1={LABEL_W} y1={paths.gapZero} x2={LABEL_W + plotW} y2={paths.gapZero} stroke={inkA(0.16)} />
            <path d={paths.lossArea} fill={CH.loss} fillOpacity={0.32} />
            <path d={paths.gainArea} fill={CH.gain} fillOpacity={0.32} />
            <path d={paths.gapLine} fill="none" stroke={inkA(0.55)} strokeWidth={1} />

            {ticks.map((t) => (
              <text
                key={t.i}
                x={X(t.i)}
                y={H - 3}
                fontSize={9}
                textAnchor="middle"
                fill={t.label === "apex" ? inkA(0.6) : inkA(0.32)}
              >
                {t.label === "apex" ? "apex" : `${t.label} m`}
              </text>
            ))}

            <line x1={X(ci)} y1={0} x2={X(ci)} y2={H - 16} stroke={inkA(0.55)} strokeWidth={1} />
          </svg>
        )}
      </div>
    </div>
  );
}

function Readout({
  color,
  name,
  r,
  dashed = false,
}: {
  color: string;
  name: string;
  r: { speed: string; gear: number; thr: number; brk: number };
  dashed?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
      <svg width={18} height={6} aria-hidden>
        <line x1={1} y1={3} x2={17} y2={3} stroke={color} strokeWidth={2.4} strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      <span style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: dim(55), minWidth: 52 }}>
        {name}
      </span>
      <Val v={r.speed} u="km/h" />
      <Val v={`${r.gear}`} u="gear" />
      <Val v={`${r.thr}%`} u="throttle" color={CH.gain} />
      <Val v={`${r.brk}%`} u="brake" color={CH.loss} />
    </div>
  );
}

function Val({ v, u, color }: { v: string; u: string; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
      <span className="num" style={{ font: "600 13px var(--font-heading)", color: color ?? "var(--color-text)" }}>
        {v}
      </span>
      <span style={{ fontSize: 9.5, color: dim(40) }}>{u}</span>
    </span>
  );
}
