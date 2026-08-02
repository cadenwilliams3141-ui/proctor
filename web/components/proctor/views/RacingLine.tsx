"use client";

/* View 4 — "Racing line". The circuit with a width to it, and your line on it.
 *
 * ┌ WHAT THE BAND IS, AND WHAT IT IS NOT ───────────────────────────────────┐
 * │ A disk .ibt carries GPS and nothing else about the circuit — no kerbs,  │
 * │ no white lines, no surveyed edges. So the road drawn here is not the    │
 * │ track. It is the band between the leftmost and rightmost line YOU took  │
 * │ across the clean laps of this session, measured perpendicular to your   │
 * │ reference lap.                                                          │
 * │                                                                         │
 * │ That distinction is not pedantry, it changes how the picture reads. A   │
 * │ corner where the band pinches shut is a corner you drove the same way   │
 * │ every lap — NOT a narrow piece of road. Both facts are useful and they  │
 * │ are not the same fact, so the caption says which one this is.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A whole circuit at panel size puts a 12 m road inside about a pixel, so the
 * band is drawn twice: once round the full lap for the shape of it, and once
 * zoomed into the selected corner, where the metres are actually legible and
 * where the line is worth arguing about anyway. */

import { useCallback, useEffect, useMemo, useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { explainTrackWidth } from "@/lib/proctor/explain";
import { fixed, fmtCornerGeometry } from "@/lib/proctor/format";
import { gpsToLocal, projectAll, wrapIndex } from "@/lib/proctor/geometry";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import type { Corner, Trace, TrackWidthData } from "@/lib/proctor/types";

export default function RacingLine() {
  const { bundle, state, dispatch, traceA, traceB, selectedCornerId, ledger } = useProctor();
  const [exaggeration, setExaggeration] = useState(1);
  const onExaggeration = useCallback((n: number) => setExaggeration(n), []);

  if (!bundle) return <Loading />;

  const tw = bundle.trackWidth;
  if (!tw) {
    /* No band is a finding, not an empty panel. The absence carries the
       module's own reason, which is the only honest thing to print here. */
    const absence = bundle.absences.find((a) => a.key === "track_width");
    return (
      <div style={{ padding: "var(--space-8) var(--space-6)", maxWidth: 640 }}>
        <div style={{ font: "500 15px var(--font-heading)", marginBottom: 8 }}>
          The road you used could not be measured for this session.
        </div>
        <p style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, margin: 0 }}>
          {absence?.reason ??
            "This session was ingested before the module that measures it existed. Re-ingest it and the band appears — nothing about the file needs to change."}
        </p>
      </div>
    );
  }

  const selected = ledger?.corners.find((c) => c.corner.id === selectedCornerId)?.corner ?? bundle.corners[0] ?? null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "var(--space-4) var(--space-6) var(--space-3)", flex: "none" }}>
        <Explain items={[explainTrackWidth(tw)]} />
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
          title="The road you used"
          sub={`${tw.laps_used.length} clean laps stacked on each other`}
          padding="var(--space-3)"
          style={{ minHeight: 0 }}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {exaggeration > 1 && (
                <span
                  className="tag tag-outline"
                  style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}
                  title={`A road a few metres wide is thinner than a hairline on a circuit this long, so the band is drawn ${exaggeration} times wider than life. The corner view is at true scale.`}
                >
                  width ×{exaggeration}
                </span>
              )}
              <WidthKey />
            </div>
          }
          foot={
            <Caveat>
              {exaggeration > 1
                ? `Widths on this map are drawn ${exaggeration}× life size — at true scale a road a few metres wide is thinner than a hairline on a circuit this long. The corner view to the right is at true scale. `
                : ""}
              {noteFor("track.width")}
            </Caveat>
          }
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <FullCircuit
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
                Metres here are real metres. Every lap of the session is drawn,
                with lap A and lap B picked out — the spread between them is how
                much your line moved through this corner.
              </Caveat>
            }
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              {selected ? (
                <CornerZoom tw={tw} corner={selected} traceA={traceA} traceB={traceB} />
              ) : (
                <div style={{ fontSize: 12, color: dim(50), padding: "var(--space-4) 0" }}>
                  No corners were detected in this session, so there is nothing to
                  zoom into.
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="Width used, round the lap"
            sub="metres between your widest and tightest line"
            padding="var(--space-3)"
            style={{ flex: "none" }}
          >
            <WidthProfile tw={tw} corners={bundle.corners} selectedId={selected?.id ?? null} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function WidthKey() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10, color: dim(42), whiteSpace: "nowrap" }}>
      <Key color="rgba(145,132,217,.20)" label="every line" />
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
  tw,
  corners,
  traceA,
  traceB,
  selectedId,
  onPick,
  cursor,
  onExaggeration,
}: {
  tw: TrackWidthData;
  corners: Corner[];
  traceA: Trace | null;
  traceB: Trace | null;
  selectedId: number | null;
  onPick: (id: number) => void;
  cursor: number;
  onExaggeration: (n: number) => void;
}) {
  const geo = useMemo(() => {
    /* Choose the multiplier from the circuit itself: whatever makes the median
       band about TARGET_BAND_PX wide once projected. A fixed factor would be
       invisible on a long circuit and absurd on a short one. */
    const span = Math.max(
      Math.max(...tw.centre_x_m) - Math.min(...tw.centre_x_m),
      Math.max(...tw.centre_y_m) - Math.min(...tw.centre_y_m),
      1,
    );
    const median = tw.summary.median_used_width_m ?? 0;
    const pxPerMetre = (W - 52) / span;
    const exaggerate =
      median > 0
        ? Math.min(MAX_EXAGGERATION, Math.max(1, Math.round(TARGET_BAND_PX / (median * pxPerMetre))))
        : 1;

    const left = edges(tw, "left_m", exaggerate);
    const right = edges(tw, "right_m", exaggerate);
    const p90 = edges(tw, "p90_m", exaggerate);
    const p10 = edges(tw, "p10_m", exaggerate);
    const a = drivenLine(traceA, tw, exaggerate);
    const b = drivenLine(traceB, tw, exaggerate);
    // Fitted to the OUTER edges, so nothing that hangs off the centreline is
    // clipped at the frame.
    const p = projectAll([left, right, a, b].filter(Boolean) as { x: number[]; y: number[] }[], W, H, 26);
    return {
      p,
      exaggerate,
      full: ribbonPath(p, left, right),
      typical: ribbonPath(p, p90, p10),
      centre: linePath(p, { x: tw.centre_x_m, y: tw.centre_y_m }),
      a: a ? linePath(p, a) : null,
      b: b ? linePath(p, b) : null,
      n: tw.centre_x_m.length,
    };
  }, [tw, traceA, traceB]);

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
      {/* The full band — every line the driver took this session. */}
      <path d={geo.full} fill="rgba(145,132,217,.16)" stroke={inkA(0.1)} strokeWidth={0.6} />
      {/* Where the line usually sat: 10th to 90th percentile of the laps. */}
      <path d={geo.typical} fill="rgba(145,132,217,.20)" stroke="none" />
      <path d={geo.centre} fill="none" stroke={inkA(0.16)} strokeWidth={0.8} strokeDasharray="3 4" />

      {geo.b && <path d={geo.b} fill="none" stroke={CH.b} strokeWidth={1.5} opacity={0.85} />}
      {geo.a && <path d={geo.a} fill="none" stroke={CH.a} strokeWidth={1.7} />}

      {corners.map((c) => {
        const k = wrapIndex(Math.floor(c.apex_pct * geo.n), geo.n);
        const cx = geo.p.X(tw.centre_x_m[k]);
        const cy = geo.p.Y(tw.centre_y_m[k]);
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
        cx={geo.p.X(tw.centre_x_m[ci])}
        cy={geo.p.Y(tw.centre_y_m[ci])}
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
  tw,
  corner,
  traceA,
  traceB,
}: {
  tw: TrackWidthData;
  corner: Corner;
  traceA: Trace | null;
  traceB: Trace | null;
}) {
  const geo = useMemo(() => {
    const n = tw.centre_x_m.length;
    // A little either side of the corner window, so the entry and the exit are
    // both in frame — the line through a corner is decided before it starts.
    const pad = Math.round(n * 0.02);
    const from = Math.floor(corner.start_pct * n) - pad;
    const to = Math.ceil(corner.end_pct * n) + pad;

    const left = edges(tw, "left_m");
    const right = edges(tw, "right_m");
    const a = drivenLine(traceA, tw);
    const b = drivenLine(traceB, tw);

    const slice = (s: { x: number[]; y: number[] }) => {
      const x: number[] = [];
      const y: number[] = [];
      for (let i = from; i <= to; i++) {
        const k = wrapIndex(i, n);
        x.push(s.x[k]);
        y.push(s.y[k]);
      }
      return { x, y };
    };

    const p = projectAll([slice(left), slice(right)], ZW, ZH, 20);
    // Metres per viewBox unit, for the scale bar. The projection is uniform, so
    // one number covers both axes.
    const dx = Math.abs(p.X(1) - p.X(0)) || 1;

    return {
      p,
      pxPerMetre: dx,
      band: ribbonPath(p, left, right, from, to, 1),
      centre: linePath(p, { x: tw.centre_x_m, y: tw.centre_y_m }, from, to, 1),
      a: a ? linePath(p, a, from, to, 1) : null,
      b: b ? linePath(p, b, from, to, 1) : null,
      apex: wrapIndex(Math.floor(corner.apex_pct * n), n),
      widthAtApex: tw.used_width_m[wrapIndex(Math.floor(corner.apex_pct * n), n)] ?? 0,
    };
  }, [tw, corner, traceA, traceB]);

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
        <path d={geo.band} fill="rgba(145,132,217,.18)" stroke={inkA(0.14)} strokeWidth={0.8} />
        <path d={geo.centre} fill="none" stroke={inkA(0.2)} strokeWidth={1} strokeDasharray="4 5" />
        {geo.b && <path d={geo.b} fill="none" stroke={CH.b} strokeWidth={2.2} opacity={0.9} />}
        {geo.a && <path d={geo.a} fill="none" stroke={CH.a} strokeWidth={2.4} />}

        <circle
          cx={geo.p.X(tw.centre_x_m[geo.apex])}
          cy={geo.p.Y(tw.centre_y_m[geo.apex])}
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
        <div>
          <Eyebrow size={9}>width used at the apex</Eyebrow>
          <div className="num" style={{ font: "500 15px var(--font-heading)", marginTop: 2 }}>
            {fixed(geo.widthAtApex, 1)} <span style={{ fontSize: 10, color: dim(38) }}>m</span>
          </div>
        </div>
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
  tw,
  corners,
  selectedId,
}: {
  tw: TrackWidthData;
  corners: Corner[];
  selectedId: number | null;
}) {
  const VBW = 620;
  const VBH = 96;
  const PLOT_TOP = 16;
  const PLOT_BOTTOM = 74;

  const geo = useMemo(() => {
    const w = tw.used_width_m;
    const n = w.length;
    const hi = Math.max(1, ...w);
    const X = (i: number) => 30 + (i / Math.max(n - 1, 1)) * (VBW - 34);
    const Y = (v: number) => PLOT_BOTTOM - (v / hi) * (PLOT_BOTTOM - PLOT_TOP);
    const pts: string[] = [];
    // ~200 points is enough for the shape and keeps the path string small.
    const step = Math.max(1, Math.round(n / 200));
    for (let i = 0; i < n; i += step) pts.push(`${X(i).toFixed(1)} ${Y(w[i]).toFixed(1)}`);
    return {
      hi,
      X,
      Y,
      area: `M ${X(0).toFixed(1)} ${PLOT_BOTTOM} L ${pts.join(" L ")} L ${X(n - 1).toFixed(1)} ${PLOT_BOTTOM} Z`,
      n,
    };
  }, [tw]);

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

function Loading() {
  return (
    <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45), fontSize: 12 }}>
      Reading the session…
    </div>
  );
}
