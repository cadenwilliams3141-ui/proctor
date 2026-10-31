"use client";

/* The corner, at true scale: the road, your line through it, and your best.
 *
 * This is the picture the corner-by-corner view is built around. It answers
 * "where did the car go" before any number does — the two lines either sit on
 * top of each other or they do not, and the eye finds the place they part
 * faster than it can read a sentence about it.
 *
 * What is drawn, and what each thing claims:
 *   - the ROAD is the measured racing surface (trackBoundary) — the furthest
 *     out the sim still called a car on track, at this circuit, ever. Where no
 *     car has been, there is a gap, never a guessed edge. Without a surface the
 *     band between your own clean lines is drawn instead and labelled as that.
 *   - your BEST lap is dashed, this LAP is solid, each in its lap colour.
 *   - dots mark where each lap went on the brake, was slowest, and was back to
 *     full throttle: filled for this lap, rings for the best.
 *
 * Metres are real metres. North is up. Nothing is exaggerated here — the
 * racing-line view is where the whole circuit is drawn with widths magnified. */

import { useMemo } from "react";

import { useSize } from "@/components/proctor/ui/useSize";
import { CH, INK, dim, inkA, type DeltaSense } from "@/lib/proctor/channels";
import { fmtLap } from "@/lib/proctor/format";
import { gpsToLocal, project, wrapIndex } from "@/lib/proctor/geometry";
import type { CornerReading, LapMarks, Phase } from "@/lib/proctor/phases";
import { boundaryEdge, edges, linePath, ribbonPath, surfaceRibbon } from "@/lib/proctor/road";
import type { Trace, TrackBoundary, TrackWidthData } from "@/lib/proctor/types";

type XY = { x: number[]; y: number[] };

export interface CornerMapProps {
  tb: TrackBoundary | null;
  tw: TrackWidthData | null;
  /** The circuit centreline in metres, for the locator in the corner. */
  circuit: { x_m: number[]; y_m: number[] };
  best: Trace;
  lap: Trace;
  reading: CornerReading;
  /** The corner's own window and the wider stretch drawn around it, both as
   *  unwrapped indices on the trace grid. */
  win: { from: number; to: number };
  view: { from: number; to: number };
  cursor: number | null;
  hoverPhase: Phase | null;
  bestName: string;
  lapName: string;
  sense: DeltaSense;
}

const SENSE_COLOR: Record<DeltaSense, string> = {
  loss: CH.loss,
  gain: CH.gain,
  matched: inkA(0.7),
};

export default function CornerMap(props: CornerMapProps) {
  const [box, size] = useSize<HTMLDivElement>();
  const { tb, tw, best, lap, reading, view, cursor, hoverPhase } = props;
  const nT = Math.min(best.speed.length, lap.speed.length);

  const geo = useMemo(() => {
    const W = Math.max(size.w, 1);
    const H = Math.max(size.h, 1);

    /* The frame everything is projected into. With neither a surface nor a
       band there is no stored origin, so the best lap's own mean position
       stands in — the two lines still land on each other, only the road is
       missing, and the panel says so. */
    const centre = tb
      ? { x: tb.centre_x_m, y: tb.centre_y_m, origin: tb.origin }
      : tw
        ? { x: tw.centre_x_m, y: tw.centre_y_m, origin: tw.origin }
        : null;
    const origin = centre?.origin ?? {
      lat: mean(best.lat_gps),
      lon: mean(best.lon_gps),
    };
    const nC = centre?.x.length ?? nT;
    // Trace grid -> road grid. Identical lengths in practice; mapped by share
    // of the lap so a different binning would still line up.
    const toC = (i: number) => Math.round((i * nC) / nT);

    const lineB = best.lat_gps.length ? gpsToLocal(best.lat_gps, best.lon_gps, origin) : null;
    const lineL = lap.lat_gps.length ? gpsToLocal(lap.lat_gps, lap.lon_gps, origin) : null;

    const surfL = tb ? boundaryEdge(tb, "left_m") : null;
    const surfR = tb ? boundaryEdge(tb, "right_m") : null;
    const bandL = !tb && tw ? edges(tw, "left_m") : null;
    const bandR = !tb && tw ? edges(tw, "right_m") : null;

    // Fit to what is in the corner: the road edges and both lines over the
    // drawn stretch. Anything outside it is drawn too, and simply runs off.
    const fit: XY = { x: [], y: [] };
    const take = (src: XY | null, from: number, to: number, n: number) => {
      if (!src) return;
      for (let i = from; i <= to; i++) {
        const k = wrapIndex(i, n);
        if (Number.isFinite(src.x[k]) && Number.isFinite(src.y[k])) {
          fit.x.push(src.x[k]);
          fit.y.push(src.y[k]);
        }
      }
    };
    const cFrom = toC(view.from);
    const cTo = toC(view.to);
    take(surfL, cFrom, cTo, nC);
    take(surfR, cFrom, cTo, nC);
    take(bandL, cFrom, cTo, nC);
    take(bandR, cFrom, cTo, nC);
    take(lineB, view.from, view.to, nT);
    take(lineL, view.from, view.to, nT);
    const p = project(fit.x.length ? fit.x : [0, 1], fit.y.length ? fit.y : [0, 1], W, H, 36);
    const pxPerM = Math.abs(p.X(1) - p.X(0)) || 1;

    // The road bleeds past the frame so it reads as continuing, not as ending.
    const spill = Math.round((cTo - cFrom) * 0.6);
    const road = surfL && surfR ? surfaceRibbon(p, surfL, surfR, cFrom - spill, cTo + spill) : null;
    const roadEdgeL = surfL ? brokenLine(p, surfL, cFrom - spill, cTo + spill) : null;
    const roadEdgeR = surfR ? brokenLine(p, surfR, cFrom - spill, cTo + spill) : null;
    const band = bandL && bandR ? ribbonPath(p, bandL, bandR, cFrom - spill, cTo + spill, 1) : null;

    const at = (src: XY | null, i: number | null) => {
      if (!src || i == null) return null;
      const k = wrapIndex(i, src.x.length);
      return { x: p.X(src.x[k]), y: p.Y(src.y[k]) };
    };

    // Which way the car is travelling: an arrowhead on the best lap's line
    // where the corner window opens, pointing along the line.
    const arrow = (() => {
      if (!lineB) return null;
      const a = at(lineB, view.from + Math.round((props.win.from - view.from) * 0.6));
      const b2 = at(lineB, view.from + Math.round((props.win.from - view.from) * 0.6) + 3);
      if (!a || !b2) return null;
      const ang = (Math.atan2(b2.y - a.y, b2.x - a.x) * 180) / Math.PI;
      return { x: a.x, y: a.y, ang };
    })();

    return {
      arrow,
      W,
      H,
      pxPerM,
      road,
      roadEdgeL,
      roadEdgeR,
      band,
      best: lineB ? linePath(p, lineB, view.from, view.to, 1) : null,
      lap: lineL ? linePath(p, lineL, view.from, view.to, 1) : null,
      lineB,
      lineL,
      at,
      p,
    };
    // props.win.from only moves the arrow, and always with view.from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, tb, tw, best, lap, view.from, view.to, nT]);

  const hover =
    hoverPhase && geo.lineL ? linePath(geo.p, geo.lineL, hoverPhase.from, hoverPhase.to, 1) : null;

  const scale = scaleBar(geo.pxPerM);

  return (
    <div ref={box} className="cr-map-canvas">
      {size.w > 0 && (
        <svg
          width={geo.W}
          height={geo.H}
          viewBox={`0 0 ${geo.W} ${geo.H}`}
          style={{ display: "block", position: "absolute", inset: 0 }}
          role="img"
          aria-label={`Turn ${reading.id}: ${props.lapName} against ${props.bestName}, drawn to scale`}
        >
          <defs>
            <pattern id="cr-dots" width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.9" fill={inkA(0.07)} />
            </pattern>
          </defs>
          <rect width={geo.W} height={geo.H} fill="url(#cr-dots)" />

          {/* The road: dark asphalt with a lighter edge, like the real thing
              seen from above, so the lines read as being ON something. */}
          {geo.road && <path d={geo.road} fill={INK.bg} stroke="none" />}
          {geo.roadEdgeL && <path d={geo.roadEdgeL} fill="none" stroke={inkA(0.3)} strokeWidth={1.4} />}
          {geo.roadEdgeR && <path d={geo.roadEdgeR} fill="none" stroke={inkA(0.3)} strokeWidth={1.4} />}
          {geo.band && (
            <path d={geo.band} fill="rgba(145,132,217,.13)" stroke={inkA(0.18)} strokeWidth={1} />
          )}

          {hover && (
            <path
              d={hover}
              fill="none"
              stroke={CH.b}
              strokeOpacity={0.22}
              strokeWidth={14}
              strokeLinecap="round"
            />
          )}

          {geo.best && (
            <path d={geo.best} fill="none" stroke={CH.a} strokeWidth={2.2} strokeDasharray="7 6" strokeLinecap="round" />
          )}
          {geo.lap && (
            <>
              <path d={geo.lap} fill="none" stroke={CH.b} strokeOpacity={0.18} strokeWidth={7} strokeLinecap="round" />
              <path d={geo.lap} fill="none" stroke={CH.b} strokeWidth={2.6} strokeLinecap="round" />
            </>
          )}

          {geo.arrow && (
            <g transform={`translate(${geo.arrow.x} ${geo.arrow.y}) rotate(${geo.arrow.ang})`} aria-hidden>
              <circle r={11} fill={INK.bg} fillOpacity={0.85} stroke={inkA(0.25)} />
              <path d="M -4 -5 L 4 0 L -4 5" fill="none" stroke={inkA(0.85)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}

          <Marks marks={reading.marks.best} at={(i) => geo.at(geo.lineB, i)} ring />
          <Marks marks={reading.marks.lap} at={(i) => geo.at(geo.lineL, i)} />

          {cursor != null && (
            <>
              {(() => {
                const b = geo.at(geo.lineB, cursor);
                return b ? <circle cx={b.x} cy={b.y} r={5} fill={INK.bg} stroke={CH.a} strokeWidth={2} /> : null;
              })()}
              {(() => {
                const l = geo.at(geo.lineL, cursor);
                return l ? <circle cx={l.x} cy={l.y} r={5.5} fill={CH.b} stroke={INK.bg} strokeWidth={2} /> : null;
              })()}
            </>
          )}

          {scale && (
            <g transform={`translate(18 ${geo.H - 18})`}>
              <line x1={0} y1={0} x2={scale.px} y2={0} stroke={inkA(0.5)} strokeWidth={1.4} />
              <line x1={0} y1={-4} x2={0} y2={4} stroke={inkA(0.5)} strokeWidth={1.4} />
              <line x1={scale.px} y1={-4} x2={scale.px} y2={4} stroke={inkA(0.5)} strokeWidth={1.4} />
              <text x={scale.px / 2} y={-7} fill={inkA(0.5)} fontSize={10} textAnchor="middle">
                {scale.m} m
              </text>
            </g>
          )}
        </svg>
      )}

      <div className="cr-map-key">
        <Locator circuit={props.circuit} win={props.win} n={nT} color={SENSE_COLOR[props.sense]} />
        <div style={{ display: "grid", gap: 4 }}>
          <KeyRow swatch={<Swatch color={CH.b} />} time={lap.lap_time_s} name={props.lapName} />
          <KeyRow swatch={<Swatch color={CH.a} dashed />} time={best.lap_time_s} name={props.bestName} />
        </div>
      </div>

      <div className="cr-map-marks" aria-hidden>
        <MarkKey color={CH.loss} label="on the brake" />
        <MarkKey color={INK.text} label="slowest" />
        <MarkKey color={CH.gain} label="full throttle" />
        <span style={{ color: dim(38) }}>filled: this lap · ring: {props.bestName.toLowerCase()}</span>
      </div>

      {!tb && (
        <div className="cr-map-note">
          {tw
            ? "Road edges not measured yet: the band is where your clean laps went"
            : "Road not measured yet: lines only"}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Marks({
  marks,
  at,
  ring = false,
}: {
  marks: LapMarks;
  at: (i: number | null) => { x: number; y: number } | null;
  ring?: boolean;
}) {
  const dots: [number | null, string][] = [
    [marks.brake, CH.loss],
    [marks.apex, INK.text],
    [marks.throttle, CH.gain],
  ];
  return (
    <g>
      {dots.map(([i, color], k) => {
        const pt = at(i);
        if (!pt) return null;
        return ring ? (
          <circle key={k} cx={pt.x} cy={pt.y} r={5} fill="none" stroke={color} strokeWidth={1.8} />
        ) : (
          <circle key={k} cx={pt.x} cy={pt.y} r={4.2} fill={color} stroke={INK.bg} strokeWidth={1.4} />
        );
      })}
    </g>
  );
}

/** One road edge as a line that breaks where the survey has a gap. */
function brokenLine(
  p: { X: (v: number) => number; Y: (v: number) => number },
  src: XY,
  from: number,
  to: number,
): string {
  const n = src.x.length;
  const parts: string[] = [];
  let run: string[] = [];
  for (let i = from; i <= to; i++) {
    const k = wrapIndex(i, n);
    if (Number.isFinite(src.x[k]) && Number.isFinite(src.y[k])) {
      run.push(`${p.X(src.x[k]).toFixed(1)} ${p.Y(src.y[k]).toFixed(1)}`);
    } else {
      if (run.length > 1) parts.push(`M ${run.join(" L ")}`);
      run = [];
    }
  }
  if (run.length > 1) parts.push(`M ${run.join(" L ")}`);
  return parts.join(" ");
}

/** A scale bar between 50 and 140 px, in a round number of metres. */
function scaleBar(pxPerM: number): { m: number; px: number } | null {
  for (const m of [5, 10, 20, 25, 50, 100, 200, 250, 500]) {
    const px = m * pxPerM;
    if (px >= 50 && px <= 140) return { m, px };
  }
  return null;
}

function mean(v: number[]): number {
  let s = 0;
  let k = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) continue;
    s += x;
    k++;
  }
  return k ? s / k : 0;
}

/** The whole circuit, small, with this corner lit — so the zoomed picture
 *  always says where on the lap it is. */
function Locator({
  circuit,
  win,
  n,
  color,
}: {
  circuit: { x_m: number[]; y_m: number[] };
  win: { from: number; to: number };
  n: number;
  color: string;
}) {
  const W = 104;
  const H = 72;
  const d = useMemo(() => {
    const m = circuit.x_m.length;
    if (m < 3) return null;
    const p = project(circuit.x_m, circuit.y_m, W, H, 6);
    const all = linePath(p, { x: circuit.x_m, y: circuit.y_m }, 0, m, Math.max(1, Math.round(m / 300)));
    const toM = (i: number) => Math.round((i * m) / n);
    const lit = linePath(p, { x: circuit.x_m, y: circuit.y_m }, toM(win.from), toM(win.to), 1);
    return { all, lit };
  }, [circuit, win.from, win.to, n]);
  if (!d) return null;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ display: "block", flex: "none" }}>
      <path d={d.all} fill="none" stroke={inkA(0.28)} strokeWidth={1.6} strokeLinejoin="round" />
      <path d={d.lit} fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" />
    </svg>
  );
}

function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <svg width={22} height={6} aria-hidden style={{ flex: "none" }}>
      <line
        x1={1}
        y1={3}
        x2={21}
        y2={3}
        stroke={color}
        strokeWidth={2.4}
        strokeDasharray={dashed ? "5 4" : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

function KeyRow({ swatch, time, name }: { swatch: React.ReactNode; time: number | null; name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
      {swatch}
      <span className="num" style={{ font: "600 13px var(--font-heading)" }}>
        {fmtLap(time)}
      </span>
      <span style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: dim(55) }}>
        {name}
      </span>
    </div>
  );
}

function MarkKey({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}
