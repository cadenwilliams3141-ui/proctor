"use client";

/* Stacked channel lanes on one shared axis — distance or time — with a shared
 * cursor. Drag across the lanes to zoom; double-click to zoom back out.
 *
 * Generalises the old Ribbon: any channel the laps carry, any number of laps
 * up to four, full-rate when the session has it. Paths are rebuilt only when
 * the laps, channels or zoom change; a pointer move re-renders the cursor and
 * readouts, never a polyline. */

import { useMemo, useRef, useState } from "react";

import { CH, INK, dim } from "@/lib/proctor/channels";
import { CHANNEL_BY_KEY, thin, type LapSeries } from "@/lib/proctor/dataSeries";

export type Axis = "distance" | "time";

/** Lap 1 is the reference (the accent), then B, then two more. */
export const LAP_COLORS = [CH.a, CH.b, CH.gain, CH.warn];

const W = 1000;
const LANE_H = 78;
const GAP = 8;
const LEFT = 0;

export function xsOf(s: LapSeries, axis: Axis): Float64Array {
  return axis === "distance" ? s.d : s.t;
}

export default function Lanes({
  series,
  values,
  channels,
  axis,
  range,
  cursor,
  onCursor,
  onZoom,
}: {
  series: LapSeries[];
  /** channel -> lap index -> display values (null when the lap lacks it) */
  values: Record<string, (Float64Array | null)[]>;
  channels: string[];
  axis: Axis;
  range: [number, number];
  cursor: number | null;
  onCursor: (x: number | null) => void;
  onZoom: (r: [number, number] | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [x0, x1] = range;
  const X = (x: number) => LEFT + ((x - x0) / (x1 - x0 || 1)) * (W - LEFT);
  const H = channels.length * (LANE_H + GAP);

  const lanes = useMemo(
    () =>
      channels.map((key) => {
        const vals = values[key] ?? [];
        let lo = Infinity;
        let hi = -Infinity;
        const paths = series.map((s, li) => {
          const v = vals[li];
          if (!v) return null;
          const xs = xsOf(s, axis);
          const idx = thin(xs, v, x0, x1, 1400);
          for (const i of idx) {
            if (xs[i] < x0 || xs[i] > x1 || !Number.isFinite(v[i])) continue;
            if (v[i] < lo) lo = v[i];
            if (v[i] > hi) hi = v[i];
          }
          return { idx, xs, v };
        });
        if (!Number.isFinite(lo)) {
          lo = 0;
          hi = 1;
        }
        if (key === "delta") {
          const m = Math.max(Math.abs(lo), Math.abs(hi), 0.01);
          lo = -m;
          hi = m;
        }
        const pad = (hi - lo || 1) * 0.08;
        const ylo = lo - pad;
        const yhi = hi + pad;
        const d = paths.map((p) => {
          if (!p) return null;
          let out = "";
          let pen = false;
          for (const i of p.idx) {
            const y = p.v[i];
            if (!Number.isFinite(y)) {
              pen = false;
              continue;
            }
            const px = X(p.xs[i]).toFixed(1);
            const py = (LANE_H - ((y - ylo) / (yhi - ylo)) * LANE_H).toFixed(1);
            out += `${pen ? "L" : "M"}${px} ${py}`;
            pen = true;
          }
          return out;
        });
        return { key, lo, hi, ylo, yhi, d };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, values, series, axis, x0, x1],
  );

  const toX = (clientX: number) => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return x0 + f * (x1 - x0);
  };

  return (
    <div
      ref={ref}
      style={{ position: "relative", userSelect: "none", touchAction: "none", cursor: "crosshair" }}
      onPointerMove={(e) => {
        const x = toX(e.clientX);
        onCursor(x);
        if (drag && x != null) setDrag({ ...drag, b: x });
      }}
      onPointerLeave={() => {
        onCursor(null);
        setDrag(null);
      }}
      onPointerDown={(e) => {
        const x = toX(e.clientX);
        if (x != null) setDrag({ a: x, b: x });
      }}
      onPointerUp={() => {
        if (drag && Math.abs(drag.b - drag.a) > (x1 - x0) * 0.01) {
          onZoom([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]);
        }
        setDrag(null);
      }}
      onDoubleClick={() => onZoom(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}
        role="img" aria-label={`${channels.length} channels against ${axis}`}>
        {lanes.map((ln, k) => {
          const top = k * (LANE_H + GAP);
          const zeroY = ln.ylo < 0 && ln.yhi > 0 ? LANE_H - ((0 - ln.ylo) / (ln.yhi - ln.ylo)) * LANE_H : null;
          return (
            <g key={ln.key} transform={`translate(0 ${top})`}>
              <rect x={0} y={0} width={W} height={LANE_H} fill={INK.surface} opacity={0.45} />
              {zeroY != null && <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke={INK.neutral700} strokeDasharray="3 4" />}
              {ln.d.map((d, li) =>
                d ? (
                  <path key={li} d={d} fill="none" stroke={LAP_COLORS[li % LAP_COLORS.length]} strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke" />
                ) : null,
              )}
            </g>
          );
        })}
        {cursor != null && cursor >= x0 && cursor <= x1 && (
          <line x1={X(cursor)} x2={X(cursor)} y1={0} y2={H} stroke={INK.text} strokeOpacity={0.55}
            vectorEffect="non-scaling-stroke" />
        )}
        {drag && (
          <rect x={X(Math.min(drag.a, drag.b))} y={0} width={Math.abs(X(drag.b) - X(drag.a))} height={H}
            fill={INK.accent} opacity={0.15} />
        )}
      </svg>
      {lanes.map((ln, k) => {
        const def = CHANNEL_BY_KEY[ln.key];
        return (
          <div key={ln.key} style={{
            position: "absolute", left: 6, top: k * (LANE_H + GAP) + 4, fontSize: 10.5, color: dim(62),
            pointerEvents: "none", display: "flex", gap: 8, padding: "1px 5px", borderRadius: 4,
            // A backing, so the label never sits ON a trace and hides it.
            background: "color-mix(in srgb, var(--color-surface) 82%, transparent)",
          }}>
            <span style={{ color: dim(80) }}>{def?.label ?? ln.key}</span>
            <span className="num" style={{ color: dim(42) }}>
              {fmt(ln.lo, def?.dp ?? 1)} … {fmt(ln.hi, def?.dp ?? 1)} {def?.unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function fmt(v: number, dp: number) {
  return Number.isFinite(v) ? v.toFixed(dp) : "—";
}
