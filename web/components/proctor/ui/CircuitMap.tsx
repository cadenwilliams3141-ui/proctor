"use client";

/* The whole circuit, small enough to sit in a panel, with things put ON it.
 *
 * Two uses, both about WHERE on the lap something happened:
 *   - dots: a wheel locking or spinning, placed at the lap distance it happened
 *   - corners: each corner's stretch of road coloured by a number, with its
 *     turn number beside it, clickable to open that corner
 *
 * The line is the stored centreline (bundle.map), the same one every other map
 * in the app projects; positions are lap fractions mapped onto it. North up. */

import { useMemo } from "react";

import { useSize } from "@/components/proctor/ui/useSize";
import { INK, inkA } from "@/lib/proctor/channels";
import { project } from "@/lib/proctor/geometry";
import { linePath } from "@/lib/proctor/road";
import type { Corner } from "@/lib/proctor/types";

export interface MapDot {
  pct: number;
  color: string;
}

export interface MapCorner {
  corner: Corner;
  /** Stroke colour for the corner's stretch; null leaves it as plain road. */
  color: string | null;
  /** Short text beside the turn number, e.g. "+0.12". */
  note?: string;
  strong?: boolean;
}

export default function CircuitMap({
  circuit,
  dots = [],
  corners = [],
  onCorner,
  height = 300,
  label,
}: {
  circuit: { x_m: number[]; y_m: number[] };
  dots?: MapDot[];
  corners?: MapCorner[];
  onCorner?: (id: number) => void;
  height?: number;
  label: string;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const n = circuit.x_m.length;

  const geo = useMemo(() => {
    if (n < 3 || size.w === 0) return null;
    const p = project(circuit.x_m, circuit.y_m, size.w, height, 34);
    const at = (pct: number) => {
      const k = ((Math.round(pct * (n - 1)) % n) + n) % n;
      return { x: p.X(circuit.x_m[k]), y: p.Y(circuit.y_m[k]) };
    };
    const whole = linePath(p, { x: circuit.x_m, y: circuit.y_m }, 0, n, Math.max(1, Math.round(n / 500)));
    const seg = (c: Corner) =>
      linePath(p, { x: circuit.x_m, y: circuit.y_m }, Math.floor(c.start_pct * n), Math.ceil(c.end_pct * n), 1);
    // A label sits off the road, pushed away from the circuit's middle so it
    // does not land on the track it names.
    const cx = p.X((Math.min(...circuit.x_m) + Math.max(...circuit.x_m)) / 2);
    const cy = p.Y((Math.min(...circuit.y_m) + Math.max(...circuit.y_m)) / 2);
    const labelAt = (pct: number) => {
      const a = at(pct);
      const dx = a.x - cx;
      const dy = a.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      // Kept inside the frame: a label pushed out past the edge of the drawing
      // is a label the reader cannot see (the sweep caught one doing it).
      return {
        x: Math.max(16, Math.min(size.w - 16, a.x + (dx / len) * 18)),
        y: Math.max(12, Math.min(height - 16, a.y + (dy / len) * 18)),
      };
    };
    return { at, whole, seg, labelAt };
  }, [circuit, n, size.w, height]);

  return (
    <div ref={box} style={{ position: "relative", height }}>
      {geo && (
        <svg width={size.w} height={height} viewBox={`0 0 ${size.w} ${height}`} role="img" aria-label={label} style={{ display: "block" }}>
          <path d={geo.whole} fill="none" stroke={INK.neutral800} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
          <path d={geo.whole} fill="none" stroke={inkA(0.22)} strokeWidth={1.2} strokeLinejoin="round" />

          {corners.map(({ corner, color }) =>
            color ? (
              <path
                key={`s${corner.id}`}
                d={geo.seg(corner)}
                fill="none"
                stroke={color}
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null,
          )}

          {dots.map((d, i) => {
            const pt = geo.at(d.pct);
            return <circle key={i} cx={pt.x} cy={pt.y} r={3.6} fill={d.color} fillOpacity={0.85} stroke={INK.bg} strokeWidth={1} />;
          })}

          {corners.map(({ corner, note, strong }) => {
            const pt = geo.labelAt(corner.apex_pct);
            return (
              <g
                key={`l${corner.id}`}
                transform={`translate(${pt.x} ${pt.y})`}
                onClick={onCorner ? () => onCorner(corner.id) : undefined}
                style={{ cursor: onCorner ? "pointer" : undefined }}
              >
                <text
                  textAnchor="middle"
                  y={note ? -1 : 3.5}
                  fontSize={10.5}
                  fontWeight={600}
                  fill={strong ? "var(--color-text)" : inkA(0.62)}
                >
                  T{corner.id}
                </text>
                {note && (
                  <text textAnchor="middle" y={10} fontSize={9.5} fontWeight={600} fill={strong ? "var(--color-text)" : inkA(0.5)}>
                    {note}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
