"use client";

/* The circuit, drawn from telemetry at runtime. There is no raster asset and
 * no hand-drawn SVG anywhere in this design — every graphic comes out of the
 * lap it describes.
 *
 * The draw-in is the one trick worth explaining. The speed colouring is made of
 * ~250 separately-coloured segments, so it cannot be drawn with a single
 * stroke-dashoffset. Instead the finished coloured line is laid down, then an
 * ERASER stroke in the panel's own background colour is drawn over the top and
 * retracted. The line appears to draw itself while staying speed-coloured the
 * whole way. */

import { useId, useMemo } from "react";

import { CH, INK, inkA } from "@/lib/proctor/channels";
import { pathFor, pathLength, project, wrapIndex } from "@/lib/proctor/geometry";
import { norm, speedRamp } from "@/lib/proctor/ramps";
import type { Corner, TrackEvent } from "@/lib/proctor/types";

export interface TrackMapProps {
  x: number[];
  y: number[];
  w: number;
  h: number;
  pad?: number;
  /** Speed channel to colour by. Omit for a plain outline. */
  speed?: number[];
  /** Retract an eraser stroke over the coloured line. Needs `eraser` to be the
   *  colour actually behind the map, or the trick shows. */
  drawIn?: boolean;
  eraser?: string;
  /** Highlight one corner's arc. */
  highlight?: { from: number; to: number; color: string } | null;
  apexes?: Corner[];
  events?: TrackEvent[];
  /** Sample index of the car. May be FRACTIONAL: the Live screen drives the
   *  playhead from wall-clock time, so it lands between stored samples far more
   *  often than on one, and rounding would make a fast straight visibly step. */
  car?: number | null;
  /** Trailing path behind the car, in samples. */
  trail?: number;
  baseWidth?: number;
  segWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function TrackMap({
  x,
  y,
  w,
  h,
  pad = 22,
  speed,
  drawIn = false,
  eraser = "var(--color-surface)",
  highlight = null,
  apexes,
  events,
  car = null,
  trail = 90,
  baseWidth = 11,
  segWidth = 4.4,
  style,
  className,
}: TrackMapProps) {
  // Unique per instance: several maps share a page, and duplicate filter ids
  // silently make every map use the first one's filter.
  const uid = useId().replace(/[:]/g, "");
  const n = x.length;

  const geo = useMemo(() => {
    const p = project(x, y, w, h, pad);
    const outline = `${pathFor(p, x, y, 0, n, 4)} Z`;
    const len = pathLength(p, x, y, 0, n, 4);
    return { p, outline, len };
  }, [x, y, w, h, pad, n]);

  const segments = useMemo(() => {
    if (!speed) return [];
    const lo = Math.min(...speed);
    const hi = Math.max(...speed);
    const out: { x1: number; y1: number; x2: number; y2: number; c: string }[] = [];
    // Every 4th sample: ~225 segments, enough that the ramp reads as continuous
    // without emitting 900 DOM nodes per map.
    for (let i = 4; i <= n; i += 4) {
      const a = wrapIndex(i - 4, n);
      const b = wrapIndex(i, n);
      out.push({
        x1: +geo.p.X(x[a]).toFixed(1),
        y1: +geo.p.Y(y[a]).toFixed(1),
        x2: +geo.p.X(x[b]).toFixed(1),
        y2: +geo.p.Y(y[b]).toFixed(1),
        // Normalised against THIS lap's own min/max, never an absolute scale.
        c: speedRamp(norm(speed[b], lo, hi)),
      });
    }
    return out;
  }, [speed, geo, x, y, n]);

  const highlightPath = useMemo(() => {
    if (!highlight) return null;
    const d = pathFor(geo.p, x, y, highlight.from, highlight.to, 2);
    const len = pathLength(geo.p, x, y, highlight.from, highlight.to, 2);
    return { d, len };
  }, [highlight, geo, x, y]);

  const trailPath = useMemo(() => {
    if (car == null || trail <= 0) return null;
    // pathFor walks whole samples, so the ends are floored — the fractional
    // part matters for the marker, not for a trail 90 samples long.
    return pathFor(geo.p, x, y, Math.floor(car) - Math.round(trail), Math.floor(car), 3);
  }, [car, trail, geo, x, y]);

  /** The car's position, interpolated between the two samples it sits between. */
  const carAt = useMemo(() => {
    if (car == null || n === 0) return null;
    const wrapped = ((car % n) + n) % n;
    const lo = Math.floor(wrapped);
    const hi = (lo + 1) % n;
    const f = wrapped - lo;
    return {
      cx: geo.p.X(x[lo] + (x[hi] - x[lo]) * f),
      cy: geo.p.Y(y[lo] + (y[hi] - y[lo]) * f),
    };
  }, [car, n, geo, x, y]);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible", ...style }}
      aria-hidden
    >
      <defs>
        <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The track surface under everything. */}
      <path
        d={geo.outline}
        fill="none"
        stroke={INK.neutral800}
        strokeWidth={baseWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {speed ? (
        <g filter={`url(#glow-${uid})`}>
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.c}
              strokeWidth={segWidth}
              strokeLinecap="round"
            />
          ))}
        </g>
      ) : (
        <path
          d={geo.outline}
          fill="none"
          stroke={INK.accent2_700}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}

      {/* The eraser. Retracts to reveal the coloured line. */}
      {speed && drawIn && (
        <path
          d={geo.outline}
          fill="none"
          stroke={eraser}
          strokeWidth={baseWidth + 2}
          strokeLinejoin="round"
          strokeLinecap="butt"
          style={
            {
              "--len": `${geo.len}px`,
              strokeDasharray: `${geo.len} ${geo.len}`,
              animation: "drawIn 1.9s cubic-bezier(.35,.1,.25,1) both",
            } as React.CSSProperties
          }
        />
      )}

      {highlightPath && highlight && (
        <>
          <path
            d={highlightPath.d}
            fill="none"
            stroke={highlight.color}
            strokeWidth={15}
            strokeLinecap="round"
            opacity={0.16}
          />
          <path
            d={highlightPath.d}
            fill="none"
            stroke={highlight.color}
            strokeWidth={4}
            strokeLinecap="round"
            style={
              {
                "--len": `${highlightPath.len}px`,
                strokeDasharray: highlightPath.len,
                strokeDashoffset: highlightPath.len,
                animation: "drawIn .8s ease-out both",
                animationDirection: "reverse",
              } as React.CSSProperties
            }
          />
        </>
      )}

      {apexes?.map((c, i) => {
        const k = wrapIndex(Math.round(c.apex_pct * n), n);
        const cx = geo.p.X(x[k]);
        const cy = geo.p.Y(y[k]);
        return (
          <g
            key={c.id}
            style={{
              animation: "fadeUp .35s both",
              animationDelay: `${(0.8 + i * 0.05).toFixed(2)}s`,
            }}
          >
            <circle cx={cx} cy={cy} r={9} fill={INK.bg} opacity={0.72} />
            <text
              x={cx}
              y={cy + 3.4}
              fill={inkA(0.72)}
              fontSize={9.5}
              fontWeight={500}
              textAnchor="middle"
            >
              T{c.id}
            </text>
          </g>
        );
      })}

      {events?.map((e, i) => {
        const k = wrapIndex(Math.round(e.pct * n), n);
        const cx = geo.p.X(x[k]);
        const cy = geo.p.Y(y[k]);
        const color = e.kind === "lockup" ? CH.loss : CH.warn;
        return (
          <g key={`${e.lap_number}-${e.kind}-${i}`} style={{ animation: "fadeUp .4s 1.85s both" }}>
            <circle
              cx={cx}
              cy={cy}
              r={8}
              fill={color}
              opacity={0.16}
              style={{ animation: "glowPulse 2.6s ease-in-out infinite" }}
            />
            <circle cx={cx} cy={cy} r={3.1} fill={color} />
          </g>
        );
      })}

      {trailPath && (
        <path d={trailPath} fill="none" stroke={INK.text} strokeWidth={1.6} opacity={0.6} />
      )}

      {carAt && (
        <g>
          <circle
            cx={carAt.cx}
            cy={carAt.cy}
            r={14}
            fill={CH.a}
            opacity={0.2}
            style={{ animation: "glowPulse 1.8s ease-in-out infinite" }}
          />
          <circle
            cx={carAt.cx}
            cy={carAt.cy}
            r={12}
            fill="none"
            stroke={INK.text}
            strokeWidth={1}
            opacity={0.35}
          />
          <circle cx={carAt.cx} cy={carAt.cy} r={4.4} fill={INK.text} />
        </g>
      )}
    </svg>
  );
}
