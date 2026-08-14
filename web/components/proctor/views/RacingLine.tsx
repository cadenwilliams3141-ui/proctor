"use client";

/* View 4 — "Racing line". The track, and where on it the car went.
 *
 * ┌ TWO DIFFERENT CLAIMS, AND THE VIEW KEEPS THEM APART ────────────────────┐
 * │ THE SURFACE (trackBoundary) is the road. It comes from the sim's own    │
 * │ PlayerTrackSurface flag — at every tick iRacing says whether the car is │
 * │ on the racing surface, so the furthest out that flag stayed true is a   │
 * │ measurement of where the track reached. It accumulates across every     │
 * │ session ever driven at the circuit, so it is a per-TRACK asset that     │
 * │ gets better with use rather than a per-session snapshot.                │
 * │                                                                         │
 * │ It is a FLOOR, not the edge: the flag follows the car's reference       │
 * │ point, so real asphalt continues past the outermost sample, and road    │
 * │ nobody has driven on is drawn as a GAP rather than guessed at. Driving  │
 * │ one slow lap down each side fills it in — the calibration lap other     │
 * │ analysers require, here an accelerator rather than a prerequisite.      │
 * │                                                                         │
 * │ THE BAND (trackWidth) is where the driver put the car this session. A   │
 * │ corner where the band pinches shut is a corner driven the same way      │
 * │ every lap, NOT a narrow piece of road. When both exist the band is      │
 * │ drawn inside the surface, because "what I used" reads against "what     │
 * │ was there". When only the band exists, it is drawn alone and the copy   │
 * │ says which of the two it is.                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A whole circuit at panel size puts a 12 m road inside about a pixel, so it is
 * drawn twice: once round the full lap with widths exaggerated (by a factor
 * printed on screen) for the shape of it, and once zoomed into the selected
 * corner at TRUE scale, where the metres are legible and where the line is
 * worth arguing about anyway. */

import { useCallback, useEffect, useMemo, useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import Panel from "@/components/proctor/ui/Panel";
import NotDrawable from "@/components/proctor/ui/NotDrawable";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { explainRoad } from "@/lib/proctor/explain";
import { fixed, fmtCornerGeometry } from "@/lib/proctor/format";
import { gpsToLocal, projectAll, wrapIndex } from "@/lib/proctor/geometry";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import type { Corner, Trace, TrackBoundary, TrackWidthData } from "@/lib/proctor/types";

export default function RacingLine() {
  const { bundle, state, dispatch, traceA, traceB, selectedCornerId, ledger, readiness } =
    useProctor();
  const [exaggeration, setExaggeration] = useState(1);
  const onExaggeration = useCallback((n: number) => setExaggeration(n), []);

  if (readiness.state === "loading" || readiness.state === "error" || !bundle) {
    return <NotDrawable readiness={bundle ? readiness : { state: "loading" }} />;
  }

  const tw = bundle.trackWidth;
  /* Two different things can be drawn here, and which one you get changes what
     the picture MEANS:

       trackBoundary  the racing surface itself, from the sim's own on-track
                      flag, accumulated across every session ever driven here.
                      This is the road.
       trackWidth     the band between your own lines this session. This is
                      where you put the car, which is not the same claim.

     The surface wins when it exists, because it answers the question the band
     could only approximate. The band is still drawn inside it. */
  const tb = bundle.trackBoundary;
  if (!tb && !tw) {
    /* Nothing to draw is a finding, not an empty panel. The absences carry the
       modules' own reasons, which is the only honest thing to print here. */
    const surfaceWhy = bundle.trackEdges?.reason
      ?? bundle.absences.find((a) => a.key === "track_edges")?.reason;
    const bandWhy = bundle.absences.find((a) => a.key === "track_width")?.reason;
    return (
      <div style={{ padding: "var(--space-8) var(--space-6)", maxWidth: 660 }}>
        <div style={{ font: "500 15px var(--font-heading)", marginBottom: 8 }}>
          Neither the track surface nor your own line could be measured here.
        </div>
        <p style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, margin: "0 0 10px" }}>
          <strong style={{ fontWeight: 500, color: dim(78) }}>The surface: </strong>
          {surfaceWhy ??
            "this session was ingested before the module that reads the sim's on-track flag existed. Re-ingest it and the road appears — nothing about the file needs to change."}
        </p>
        <p style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, margin: 0 }}>
          <strong style={{ fontWeight: 500, color: dim(78) }}>Your line: </strong>
          {bandWhy ??
            "this session was ingested before the module that measures it existed."}
        </p>
      </div>
    );
  }

  const selected = ledger?.corners.find((c) => c.corner.id === selectedCornerId)?.corner ?? bundle.corners[0] ?? null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "var(--space-4) var(--space-6) var(--space-3)", flex: "none" }}>
        <Explain items={explainRoad(tb, tw, bundle.trackEdges)} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr",
          gap: "var(--space-3)",
          padding: "0 var(--space-6) var(--space-6)",
        }}
      >
        <Panel
          title={tb ? "The track" : "The road you used"}
          sub={
            tb
              ? `measured over ${tb.laps_contributed} laps here · your line on it`
              : `${tw!.laps_used.length} clean laps stacked on each other`
          }
          padding="var(--space-3)"
          style={{ minHeight: 0 }}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {exaggeration > 1 && (
                <span
                  className="tag tag-outline"
                  style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}
                  title={`A road a few metres wide is thinner than a hairline on a circuit this long, so widths are drawn ${exaggeration} times life size. The corner view is at true scale.`}
                >
                  width ×{exaggeration}
                </span>
              )}
              <WidthKey surface={tb != null} />
            </div>
          }
          foot={
            <Caveat>
              {exaggeration > 1
                ? `Widths on this map are drawn ${exaggeration}× life size — at true scale a road a few metres wide is thinner than a hairline on a circuit this long. The corner view to the right is at true scale. `
                : ""}
              {noteFor(tb ? "track.surface" : "track.width")}
            </Caveat>
          }
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <FullCircuit
              tb={tb}
              tw={tw}
              corners={bundle.corners}
              traceA={traceA}
              traceB={traceB}
              selectedId={selected?.id ?? null}
              onPick={(id) => dispatch({ t: "corner", id })}
              cursor={state.cursor}
              onExaggeration={onExaggeration}
            />
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0 }}>
          <Panel
            title={selected ? `Turn ${selected.id}, to scale` : "No corner selected"}
            sub={selected ? fmtCornerGeometry(selected.radius_m, selected.dir) : undefined}
            padding="var(--space-3)"
            style={{ flex: 1, minHeight: 0 }}
            foot={
              <Caveat>
                Metres here are real metres. {tb
                  ? "The road is where the sim still called the car on track; lap A and lap B are your lines through it."
                  : "Lap A and lap B are picked out — the spread between them is how much your line moved through this corner."}
              </Caveat>
            }
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              {selected ? (
                <CornerZoom tb={tb} tw={tw} corner={selected} traceA={traceA} traceB={traceB} />
              ) : (
                <div style={{ fontSize: 12, color: dim(50), padding: "var(--space-4) 0" }}>
                  No corners were detected in this session, so there is nothing to
                  zoom into.
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title={tb ? "Track width, round the lap" : "Width used, round the lap"}
            sub={
              tb
                ? "metres of measured surface · gaps are road nobody has driven"
                : "metres between your widest and tightest line"
            }
            padding="var(--space-3)"
            style={{ flex: "none" }}
          >
            <WidthProfile
              tb={tb}
              tw={tw}
              corners={bundle.corners}
              selectedId={selected?.id ?? null}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function WidthKey({ surface = false }: { surface?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10, color: dim(42), whiteSpace: "nowrap" }}>
      <Key color={surface ? "rgba(233,233,237,.14)" : "rgba(145,132,217,.20)"}
           label={surface ? "track" : "every line"} />
      {surface && <Key color="rgba(145,132,217,.26)" label="where you drove" />}
      <Key color={CH.a} label="lap A" />
      <Key color={CH.b} label="lap B" />
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 4, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/** Edge coordinates for the MEASURED surface. NaN marks an unmeasured bin.
 *
 *  The boundary's arrays are deliberately sparse — a null is a stretch of road
 *  nothing has driven through yet — and that has to survive all the way to the
 *  path, because filling it in would draw a road narrowing to nothing on the
 *  centreline. */
function boundaryEdge(
  tb: TrackBoundary,
  key: "left_m" | "right_m",
  exaggerate = 1,
) {
  const n = tb.centre_x_m.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const off = tb[key];
  for (let i = 0; i < n; i++) {
    const d = off[i];
    if (d == null) {
      x[i] = NaN;
      y[i] = NaN;
      continue;
    }
    x[i] = tb.centre_x_m[i] + tb.normal_x[i] * d * exaggerate;
    y[i] = tb.centre_y_m[i] + tb.normal_y[i] * d * exaggerate;
  }
  return { x, y };
}

/** A filled ribbon that BREAKS at gaps instead of bridging them.
 *
 *  One `<path>` with several subpaths: each run of consecutive measured bins
 *  becomes its own closed shape, so an unmeasured stretch reads as a hole in
 *  the survey rather than as a piece of track that pinches shut. */
function surfaceRibbon(
  p: { X: (v: number) => number; Y: (v: number) => number },
  outer: { x: number[]; y: number[] },
  inner: { x: number[]; y: number[] },
  from = 0,
  to = -1,
): string {
  const n = outer.x.length;
  const end = to < 0 ? n - 1 : to;
  const parts: string[] = [];
  let run: number[] = [];

  const flush = () => {
    if (run.length >= 2) {
      const fwd = run.map((k) => `${p.X(outer.x[k]).toFixed(1)} ${p.Y(outer.y[k]).toFixed(1)}`);
      const back = [...run]
        .reverse()
        .map((k) => `${p.X(inner.x[k]).toFixed(1)} ${p.Y(inner.y[k]).toFixed(1)}`);
      parts.push(`M ${fwd.join(" L ")} L ${back.join(" L ")} Z`);
    }
    run = [];
  };

  for (let i = from; i <= end; i++) {
    const k = wrapIndex(i, n);
    if (Number.isFinite(outer.x[k]) && Number.isFinite(inner.x[k])) run.push(k);
    else flush();
  }
  flush();
  return parts.join(" ");
}

/** Median of a sparse series, ignoring the gaps. */
function medianOf(values: (number | null)[]): number {
  const seen = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (seen.length === 0) return 0;
  const sorted = [...seen].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The centreline of whichever source is driving the view. */
function centreOf(tb: TrackBoundary | null, tw: TrackWidthData | null) {
  return tb
    ? { x: tb.centre_x_m, y: tb.centre_y_m, origin: tb.origin, n: tb.centre_x_m.length }
    : { x: tw!.centre_x_m, y: tw!.centre_y_m, origin: tw!.origin, n: tw!.centre_x_m.length };
}

/** A lap's own line, measured against whichever centreline is in play.
 *
 *  Rebuilt from its offset rather than drawn at its raw position: under
 *  exaggeration the road moves outward, and a line left at its true position
 *  would drift outside the road it was driven on. */
function drivenAgainst(
  trace: Trace | null,
  centre: { x: number[]; y: number[]; origin: { lat: number; lon: number } },
  exaggerate = 1,
) {
  if (!trace || trace.lat_gps.length === 0) return null;
  const raw = gpsToLocal(trace.lat_gps, trace.lon_gps, centre.origin);
  if (exaggerate === 1) return raw;

  const n = Math.min(raw.x.length, centre.x.length);
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // Normal to the centreline here, from a short chord either side.
    const a = (i - 3 + n) % n;
    const b = (i + 3) % n;
    const tx = centre.x[b] - centre.x[a];
    const ty = centre.y[b] - centre.y[a];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const off = (raw.x[i] - centre.x[i]) * nx + (raw.y[i] - centre.y[i]) * ny;
    x[i] = centre.x[i] + nx * off * exaggerate;
    y[i] = centre.y[i] + ny * off * exaggerate;
  }
  return { x, y };
}

/** Edge coordinates in metres: centre + normal * offset, both from the module.
 *
 *  `exaggerate` widens everything away from the centreline by a constant
 *  factor. At full-circuit scale a 3-metre band on a 4-kilometre lap is well
 *  under a pixel, so drawn honestly it is a hairline and the view says nothing.
 *  The multiplier makes it legible; the number is printed on screen beside it,
 *  and the corner view alongside is always at true scale so there is somewhere
 *  to read real metres. */
function edges(
  tw: TrackWidthData,
  key: "left_m" | "right_m" | "p90_m" | "p10_m",
  exaggerate = 1,
) {
  const n = tw.centre_x_m.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const off = tw[key];
  for (let i = 0; i < n; i++) {
    const d = (off[i] ?? 0) * exaggerate;
    x[i] = tw.centre_x_m[i] + tw.normal_x[i] * d;
    y[i] = tw.centre_y_m[i] + tw.normal_y[i] * d;
  }
  return { x, y };
}

/** Any lap's own recorded path, in the same metres frame as the band.
 *
 *  Under exaggeration the lap's own line has to move with the band or it drifts
 *  outside it, so the line is rebuilt from its offset against the reference
 *  rather than from its raw position: exactly the measurement the parser makes,
 *  repeated here so the two agree. */
function drivenLine(trace: Trace | null, tw: TrackWidthData, exaggerate = 1) {
  if (!trace || trace.lat_gps.length === 0) return null;
  const raw = gpsToLocal(trace.lat_gps, trace.lon_gps, tw.origin);
  if (exaggerate === 1) return raw;

  const n = Math.min(raw.x.length, tw.centre_x_m.length);
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const off =
      (raw.x[i] - tw.centre_x_m[i]) * tw.normal_x[i] +
      (raw.y[i] - tw.centre_y_m[i]) * tw.normal_y[i];
    x[i] = tw.centre_x_m[i] + tw.normal_x[i] * off * exaggerate;
    y[i] = tw.centre_y_m[i] + tw.normal_y[i] * off * exaggerate;
  }
  return { x, y };
}

function ribbonPath(
  p: { X: (v: number) => number; Y: (v: number) => number },
  outer: { x: number[]; y: number[] },
  inner: { x: number[]; y: number[] },
  from = 0,
  to = -1,
  step = 2,
): string {
  const n = outer.x.length;
  const end = to < 0 ? n - 1 : to;
  const fwd: string[] = [];
  const back: string[] = [];
  for (let i = from; i <= end; i += step) {
    const k = wrapIndex(i, n);
    fwd.push(`${p.X(outer.x[k]).toFixed(1)} ${p.Y(outer.y[k]).toFixed(1)}`);
  }
  for (let i = end; i >= from; i -= step) {
    const k = wrapIndex(i, n);
    back.push(`${p.X(inner.x[k]).toFixed(1)} ${p.Y(inner.y[k]).toFixed(1)}`);
  }
  if (fwd.length === 0) return "";
  return `M ${fwd.join(" L ")} L ${back.join(" L ")} Z`;
}

function linePath(
  p: { X: (v: number) => number; Y: (v: number) => number },
  line: { x: number[]; y: number[] },
  from = 0,
  to = -1,
  step = 2,
): string {
  const n = line.x.length;
  const end = to < 0 ? n - 1 : to;
  const pts: string[] = [];
  for (let i = from; i <= end; i += step) {
    const k = wrapIndex(i, n);
    pts.push(`${p.X(line.x[k]).toFixed(1)} ${p.Y(line.y[k]).toFixed(1)}`);
  }
  return pts.length ? `M ${pts.join(" L ")}` : "";
}

// ─────────────────────────────────────────────────────────────────────────────

const W = 620;
const H = 560;

/** How wide the median band should end up on screen, in viewBox units. */
const TARGET_BAND_PX = 9;
/** Past this the picture stops being a circuit and becomes a decoration. */
const MAX_EXAGGERATION = 40;

function FullCircuit({
  tb,
  tw,
  corners,
  traceA,
  traceB,
  selectedId,
  onPick,
  cursor,
  onExaggeration,
}: {
  tb: TrackBoundary | null;
  tw: TrackWidthData | null;
  corners: Corner[];
  traceA: Trace | null;
  traceB: Trace | null;
  selectedId: number | null;
  onPick: (id: number) => void;
  cursor: number;
  onExaggeration: (n: number) => void;
}) {
  const geo = useMemo(() => {
    const centre = centreOf(tb, tw);
    /* Choose the multiplier from the circuit itself: whatever makes the road
       about TARGET_BAND_PX wide once projected. A fixed factor would be
       invisible on a long circuit and absurd on a short one. */
    const span = Math.max(
      Math.max(...centre.x) - Math.min(...centre.x),
      Math.max(...centre.y) - Math.min(...centre.y),
      1,
    );
    const typicalWidth = tb
      ? medianOf(tb.left_m.map((l, i) => (l == null || tb.right_m[i] == null ? null : l - tb.right_m[i]!)))
      : tw?.summary.median_used_width_m ?? 0;
    const pxPerMetre = (W - 52) / span;
    const exaggerate =
      typicalWidth > 0
        ? Math.min(MAX_EXAGGERATION, Math.max(1, Math.round(TARGET_BAND_PX / (typicalWidth * pxPerMetre))))
        : 1;

    // The measured road, when there is one.
    const surfL = tb ? boundaryEdge(tb, "left_m", exaggerate) : null;
    const surfR = tb ? boundaryEdge(tb, "right_m", exaggerate) : null;
    // The band between the driver's own lines, when that was computed. Drawn on
    // top of the road, because "where I went" reads against "what was there".
    const bandL = tw ? edges(tw, "left_m", exaggerate) : null;
    const bandR = tw ? edges(tw, "right_m", exaggerate) : null;

    const a = drivenAgainst(traceA, centre, exaggerate);
    const b = drivenAgainst(traceB, centre, exaggerate);

    // Fitted to the OUTERMOST geometry, so nothing hanging off the centreline
    // is clipped at the frame.
    const p = projectAll(
      [surfL, surfR, bandL, bandR, a, b].filter(Boolean) as { x: number[]; y: number[] }[],
      W, H, 26,
    );
    return {
      p,
      exaggerate,
      surface: surfL && surfR ? surfaceRibbon(p, surfL, surfR) : null,
      band: bandL && bandR ? ribbonPath(p, bandL, bandR) : null,
      centre: linePath(p, { x: centre.x, y: centre.y }),
      cx: centre.x,
      cy: centre.y,
      a: a ? linePath(p, a) : null,
      b: b ? linePath(p, b) : null,
      n: centre.n,
    };
  }, [tb, tw, traceA, traceB]);

  const ci = wrapIndex(Math.round(cursor * (geo.n - 1)), geo.n);

  // Reported upward so the panel header can print it — it is a drawing choice
  // and the reader has to be told, not left to work it out.
  useEffect(() => onExaggeration(geo.exaggerate), [geo.exaggerate, onExaggeration]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-hidden
    >
      {/* The road itself, where the sim still called the car on track. Drawn
          first and darkest, so everything else reads as being ON it. */}
      {geo.surface && (
        <path d={geo.surface} fill="rgba(233,233,237,.11)" stroke={inkA(0.26)} strokeWidth={0.7} />
      )}
      {/* The band between the driver's own lines. On its own when there is no
          measured surface; an overlay showing what was used when there is. */}
      {geo.band && (
        <path
          d={geo.band}
          fill={geo.surface ? "rgba(145,132,217,.22)" : "rgba(145,132,217,.18)"}
          stroke={geo.surface ? "none" : inkA(0.1)}
          strokeWidth={0.6}
        />
      )}
      <path d={geo.centre} fill="none" stroke={inkA(0.16)} strokeWidth={0.8} strokeDasharray="3 4" />

      {geo.b && <path d={geo.b} fill="none" stroke={CH.b} strokeWidth={1.5} opacity={0.85} />}
      {geo.a && <path d={geo.a} fill="none" stroke={CH.a} strokeWidth={1.7} />}

      {corners.map((c) => {
        const k = wrapIndex(Math.floor(c.apex_pct * geo.n), geo.n);
        const cx = geo.p.X(geo.cx[k]);
        const cy = geo.p.Y(geo.cy[k]);
        const on = c.id === selectedId;
        return (
          <g key={c.id} onClick={() => onPick(c.id)} style={{ cursor: "pointer" }}>
            <circle cx={cx} cy={cy} r={10} fill={on ? CH.a : INK.bg} opacity={on ? 0.28 : 0.66} />
            <text
              x={cx}
              y={cy + 3.4}
              fill={on ? CH.a : inkA(0.66)}
              fontSize={9.5}
              fontWeight={500}
              textAnchor="middle"
            >
              T{c.id}
            </text>
          </g>
        );
      })}

      <circle
        cx={geo.p.X(geo.cx[ci])}
        cy={geo.p.Y(geo.cy[ci])}
        r={3.4}
        fill={INK.text}
        opacity={0.8}
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const ZW = 400;
const ZH = 300;

function CornerZoom({
  tb,
  tw,
  corner,
  traceA,
  traceB,
}: {
  tb: TrackBoundary | null;
  tw: TrackWidthData | null;
  corner: Corner;
  traceA: Trace | null;
  traceB: Trace | null;
}) {
  const geo = useMemo(() => {
    const centre = centreOf(tb, tw);
    const n = centre.n;
    // A little either side of the corner window, so the entry and the exit are
    // both in frame — the line through a corner is decided before it starts.
    const pad = Math.round(n * 0.02);
    const from = Math.floor(corner.start_pct * n) - pad;
    const to = Math.ceil(corner.end_pct * n) + pad;

    // True scale here, always: this is the panel that exists so there is
    // somewhere to read real metres.
    const surfL = tb ? boundaryEdge(tb, "left_m") : null;
    const surfR = tb ? boundaryEdge(tb, "right_m") : null;
    const bandL = tw ? edges(tw, "left_m") : null;
    const bandR = tw ? edges(tw, "right_m") : null;
    const a = drivenAgainst(traceA, centre);
    const b = drivenAgainst(traceB, centre);

    const slice = (src: { x: number[]; y: number[] } | null) => {
      if (!src) return null;
      const x: number[] = [];
      const y: number[] = [];
      for (let i = from; i <= to; i++) {
        const k = wrapIndex(i, n);
        if (!Number.isFinite(src.x[k])) continue;
        x.push(src.x[k]);
        y.push(src.y[k]);
      }
      return x.length ? { x, y } : null;
    };

    const fit = [slice(surfL), slice(surfR), slice(bandL), slice(bandR)].filter(
      Boolean,
    ) as { x: number[]; y: number[] }[];
    const p = projectAll(fit.length ? fit : [{ x: centre.x, y: centre.y }], ZW, ZH, 20);
    // Metres per viewBox unit, for the scale bar. The projection is uniform, so
    // one number covers both axes.
    const dx = Math.abs(p.X(1) - p.X(0)) || 1;

    const apex = wrapIndex(Math.floor(corner.apex_pct * n), n);
    const surfaceWidth =
      tb && tb.left_m[apex] != null && tb.right_m[apex] != null
        ? tb.left_m[apex]! - tb.right_m[apex]!
        : null;

    return {
      p,
      pxPerMetre: dx,
      surface: surfL && surfR ? surfaceRibbon(p, surfL, surfR, from, to) : null,
      band: bandL && bandR ? ribbonPath(p, bandL, bandR, from, to, 1) : null,
      centre: linePath(p, { x: centre.x, y: centre.y }, from, to, 1),
      cx: centre.x,
      cy: centre.y,
      a: a ? linePath(p, a, from, to, 1) : null,
      b: b ? linePath(p, b, from, to, 1) : null,
      apex,
      surfaceWidth,
      usedWidth: tw?.used_width_m[apex] ?? null,
    };
  }, [tb, tw, corner, traceA, traceB]);

  // A 10 m bar, drawn at the projection's own scale.
  const barPx = 10 * geo.pxPerMetre;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <svg
        viewBox={`0 0 ${ZW} ${ZH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", flex: 1, minHeight: 0, display: "block" }}
        aria-hidden
      >
        {geo.surface && (
          <path d={geo.surface} fill="rgba(233,233,237,.11)" stroke={inkA(0.3)} strokeWidth={1} />
        )}
        {geo.band && (
          <path
            d={geo.band}
            fill={geo.surface ? "rgba(145,132,217,.24)" : "rgba(145,132,217,.18)"}
            stroke={geo.surface ? "none" : inkA(0.14)}
            strokeWidth={0.8}
          />
        )}
        <path d={geo.centre} fill="none" stroke={inkA(0.2)} strokeWidth={1} strokeDasharray="4 5" />
        {geo.b && <path d={geo.b} fill="none" stroke={CH.b} strokeWidth={2.2} opacity={0.9} />}
        {geo.a && <path d={geo.a} fill="none" stroke={CH.a} strokeWidth={2.4} />}

        <circle
          cx={geo.p.X(geo.cx[geo.apex])}
          cy={geo.p.Y(geo.cy[geo.apex])}
          r={4}
          fill="none"
          stroke={inkA(0.5)}
          strokeWidth={1.2}
        />

        {barPx > 8 && barPx < ZW * 0.7 && (
          <g>
            <line
              x1={16}
              y1={ZH - 14}
              x2={16 + barPx}
              y2={ZH - 14}
              stroke={inkA(0.45)}
              strokeWidth={1.4}
            />
            <line x1={16} y1={ZH - 18} x2={16} y2={ZH - 10} stroke={inkA(0.45)} strokeWidth={1.4} />
            <line
              x1={16 + barPx}
              y1={ZH - 18}
              x2={16 + barPx}
              y2={ZH - 10}
              stroke={inkA(0.45)}
              strokeWidth={1.4}
            />
            <text x={16 + barPx / 2} y={ZH - 20} fill={inkA(0.45)} fontSize={9} textAnchor="middle">
              10 m
            </text>
          </g>
        )}
      </svg>

      <div style={{ display: "flex", gap: "var(--space-4)", flex: "none", paddingTop: 6 }}>
        {geo.surfaceWidth != null && (
          <div>
            <Eyebrow size={9}>track at the apex</Eyebrow>
            <div className="num" style={{ font: "500 15px var(--font-heading)", marginTop: 2, color: CH.a }}>
              {fixed(geo.surfaceWidth, 1)} <span style={{ fontSize: 10, color: dim(38) }}>m</span>
            </div>
          </div>
        )}
        {geo.usedWidth != null && (
          <div>
            <Eyebrow size={9}>of which you used</Eyebrow>
            <div className="num" style={{ font: "500 15px var(--font-heading)", marginTop: 2 }}>
              {fixed(geo.usedWidth, 1)} <span style={{ fontSize: 10, color: dim(38) }}>m</span>
            </div>
          </div>
        )}
        <div>
          <Eyebrow size={9}>corner</Eyebrow>
          <div style={{ fontSize: 12, color: dim(62), marginTop: 4 }}>
            {fmtCornerGeometry(corner.radius_m, corner.dir)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function WidthProfile({
  tb,
  tw,
  corners,
  selectedId,
}: {
  tb: TrackBoundary | null;
  tw: TrackWidthData | null;
  corners: Corner[];
  selectedId: number | null;
}) {
  const VBW = 620;
  const VBH = 96;
  const PLOT_TOP = 16;
  const PLOT_BOTTOM = 74;

  const geo = useMemo(() => {
    // The measured track when there is one, else the band the driver used.
    // Nulls survive as gaps in the plot, the same as they do on the map.
    const w: (number | null)[] = tb
      ? tb.left_m.map((l, i) => (l == null || tb.right_m[i] == null ? null : l - tb.right_m[i]!))
      : (tw?.used_width_m ?? []);
    const n = w.length;
    const seen = w.filter((v): v is number => v != null);
    const hi = Math.max(1, ...seen);
    const X = (i: number) => 30 + (i / Math.max(n - 1, 1)) * (VBW - 34);
    const Y = (v: number) => PLOT_BOTTOM - (v / hi) * (PLOT_BOTTOM - PLOT_TOP);
    // ~200 points is enough for the shape and keeps the path string small.
    // Runs of measured bins become separate filled shapes, so an unmeasured
    // stretch is a gap in the plot rather than a dip to zero width.
    const step = Math.max(1, Math.round(n / 200));
    const parts: string[] = [];
    let run: string[] = [];
    let runStart = 0;
    const flush = (endIdx: number) => {
      if (run.length >= 2) {
        parts.push(
          `M ${X(runStart).toFixed(1)} ${PLOT_BOTTOM} L ${run.join(" L ")} L ${X(endIdx).toFixed(1)} ${PLOT_BOTTOM} Z`,
        );
      }
      run = [];
    };
    for (let i = 0; i < n; i += step) {
      const v = w[i];
      if (v == null) {
        flush(Math.max(0, i - step));
        continue;
      }
      if (run.length === 0) runStart = i;
      run.push(`${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    }
    flush(n - 1);

    return { hi, X, Y, area: parts.join(" "), n };
  }, [tb, tw]);

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} style={{ width: "100%", height: VBH, display: "block" }} aria-hidden>
      {corners.map((c) => {
        const x = geo.X(Math.floor(c.start_pct * geo.n));
        const w = Math.max(2, geo.X(Math.ceil(c.end_pct * geo.n)) - x);
        const on = c.id === selectedId;
        return (
          <g key={c.id}>
            <rect x={x} y={PLOT_TOP - 6} width={w} height={PLOT_BOTTOM - PLOT_TOP + 6} fill={inkA(on ? 0.09 : 0.04)} />
            <text
              x={x + w / 2}
              y={PLOT_TOP - 9}
              fill={on ? CH.a : inkA(0.32)}
              fontSize={8.5}
              fontWeight={500}
              textAnchor="middle"
            >
              T{c.id}
            </text>
          </g>
        );
      })}

      <line x1={30} y1={PLOT_BOTTOM} x2={VBW - 4} y2={PLOT_BOTTOM} stroke={inkA(0.12)} />
      <path d={geo.area} fill="rgba(145,132,217,.22)" stroke={CH.a} strokeWidth={1.2} />

      <text x={26} y={PLOT_TOP + 3} fill={inkA(0.34)} fontSize={9} textAnchor="end">
        {geo.hi.toFixed(0)} m
      </text>
      <text x={26} y={PLOT_BOTTOM + 3} fill={inkA(0.34)} fontSize={9} textAnchor="end">
        0
      </text>
      <text x={30} y={VBH - 4} fill={inkA(0.3)} fontSize={9}>
        start
      </text>
      <text x={VBW - 4} y={VBH - 4} fill={inkA(0.3)} fontSize={9} textAnchor="end">
        one lap, by distance
      </text>
    </svg>
  );
}

