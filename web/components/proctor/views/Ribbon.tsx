"use client";

/* View 2 — "Ribbon". Every channel on one shared distance axis, one cursor.
 *
 * Pointer-driven by design, and deliberately absent from the phone app: five
 * lanes on a shared axis need a pointer and a wide viewport, and on a phone it
 * would be five illegible strips.
 *
 * Performance note that matters here more than anywhere else in the app: the
 * cursor moves on every pointer event, so the 900-point path strings are
 * memoised on the lap pair. A pointer move re-renders this component but never
 * rebuilds a polyline. */

import { useCallback, useMemo, useRef } from "react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtDelta, fmtLap, kmh, pct, toG } from "@/lib/proctor/format";
import {
  areaPath,
  pathFor,
  polyline,
  project,
  sharedExtent,
  wrapIndex,
} from "@/lib/proctor/geometry";
import { deltaCurve } from "@/lib/proctor/ledger";
import { norm, tireRamp } from "@/lib/proctor/ramps";
import { useProctor } from "@/lib/proctor/store";

const VB_W = 968;
const VB_H = 666;
const X0 = 64; // label gutter ends
const X1 = 960;

/* Two things live above the lanes and they used to live on top of each other:
   the cursor's percentage chip (pinned to the top edge) and the corner numbers
   (drawn at the head of each corner band). Both sat inside the same 15px strip,
   so the readout covered "T4" whenever the pointer was anywhere near Turn 4 —
   which is most of the lap, because the corners cover about three quarters of
   it. They now have a row each, and every lane below is 18px further down to
   make room. */
const CURSOR_CHIP = { top: 2, height: 15, baseline: 13 };
const CORNER_ROW = { baseline: 31, bandTop: 36 };

const LANE = {
  delta: { top: 48, bottom: 168 },
  speed: { top: 178, bottom: 338 },
  pedals: { top: 348, bottom: 468, center: 408 },
  steer: { top: 478, bottom: 558, center: 518 },
  tire: { top: 568, bottom: 622 },
  events: { top: 628, bottom: 646 },
};

export default function Ribbon() {
  const { bundle, state, dispatch, ledger, traceA, traceB } = useProctor();
  const plotRef = useRef<HTMLDivElement>(null);

  const px = useCallback((i: number, n: number) => X0 + (i / (n - 1)) * (X1 - X0), []);

  /* Everything expensive lives in here, keyed on the lap pair. */
  const paths = useMemo(() => {
    if (!bundle || !traceA || !traceB) return null;
    const n = traceA.speed.length;
    const delta = deltaCurve(traceA, traceB);

    const line = (arr: number[], toY: (v: number) => number) => polyline(arr, px, toY);
    const area = (arr: number[], toY: (v: number) => number, base: number) =>
      areaPath(arr, px, toY, base);

    // Delta lane: zero sits where 0 falls within the lane's own range.
    const dLo = Math.min(0, ...delta);
    const dHi = Math.max(0, ...delta);
    const dY = (v: number) =>
      LANE.delta.bottom - norm(v, dLo, dHi) * (LANE.delta.bottom - LANE.delta.top);

    const [sLo, sHi] = sharedExtent(traceA.speed, traceB.speed);
    const sY = (v: number) =>
      LANE.speed.bottom - norm(v, sLo, sHi) * (LANE.speed.bottom - LANE.speed.top);

    const maxSteer = Math.max(...traceA.steer.map(Math.abs), ...traceB.steer.map(Math.abs), 1e-6);

    return {
      n,
      delta,
      deltaZeroY: dY(0),
      deltaArea: area(delta, dY, dY(0)),
      deltaLine: line(delta, dY),
      speedA: line(traceA.speed, sY),
      speedB: line(traceB.speed, sY),
      speedLo: sLo,
      speedHi: sHi,
      throttle: area(traceA.throttle, (v) => LANE.pedals.center - v * 58, LANE.pedals.center),
      throttleLine: line(traceA.throttle, (v) => LANE.pedals.center - v * 58),
      brake: area(traceA.brake, (v) => LANE.pedals.center + v * 58, LANE.pedals.center),
      brakeLine: line(traceA.brake, (v) => LANE.pedals.center + v * 58),
      steerA: line(traceA.steer, (v) => LANE.steer.center - (v / maxSteer) * 38),
      steerB: line(traceB.steer, (v) => LANE.steer.center - (v / maxSteer) * 38),
    };
  }, [bundle, traceA, traceB, px]);

  const tireCells = useMemo(() => {
    if (!bundle) return null;
    const bands = [bundle.tire.left_c, bundle.tire.middle_c, bundle.tire.right_c];
    // Normalised across ALL THREE bands together so they stay comparable.
    const [lo, hi] = sharedExtent(...bands);
    const cells = 120;
    const w = (X1 - X0) / cells;
    return bands.map((band, r) =>
      Array.from({ length: cells }, (_, i) => {
        const k = Math.floor((i / cells) * band.length);
        return {
          x: X0 + i * w,
          // +0.4 so neighbouring cells overlap rather than showing seams.
          w: w + 0.4,
          y: LANE.tire.top + r * 18,
          fill: tireRamp(norm(band[k], lo, hi)),
        };
      }),
    );
  }, [bundle]);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vx = ((e.clientX - rect.left) / rect.width) * VB_W;
      const p = (vx - X0) / (X1 - X0);
      dispatch({ t: "cursor", cursor: Math.max(0, Math.min(1, p)) });
    },
    [dispatch],
  );

  if (!bundle || !paths || !traceA || !traceB || !ledger) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const n = paths.n;
  const ci = wrapIndex(Math.round(state.cursor * (n - 1)), n);
  const cursorX = px(ci, n);
  const activeCorner = ledger.corners.find(
    (c) => state.cursor >= c.corner.start_pct && state.cursor <= c.corner.end_pct,
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-3) var(--space-6) var(--space-2)",
          flex: "none",
        }}
      >
        <LapChip color={CH.a} letter="A" lap={traceA.lap_number} time={traceA.lap_time_s} reference />
        <LapChip color={CH.b} letter="B" lap={traceB.lap_number} time={traceB.lap_time_s} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: dim(38) }}>
          move the pointer across the ribbon to read any point of the lap
        </span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6, flex: "none" }}>
          <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: dim(40) }}>
            lap gap
          </span>
          <span
            className="num"
            style={{ font: "500 19px var(--font-heading)", color: ledger.lapDelta > 0 ? CH.loss : CH.gain }}
          >
            {fmtDelta(ledger.lapDelta)}
          </span>
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: "var(--space-3)",
          padding: "0 var(--space-6) var(--space-6)",
        }}
      >
        {/* The ribbon */}
        <div
          ref={plotRef}
          onPointerMove={onMove}
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
            padding: "var(--space-2) var(--space-3)",
            cursor: "crosshair",
          }}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", display: "block" }}
          >
            <defs>
              <linearGradient id="rb-loss" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={CH.loss} stopOpacity="0.5" />
                <stop offset="1" stopColor={CH.loss} stopOpacity="0.03" />
              </linearGradient>
              <linearGradient id="rb-thr" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor={CH.gain} stopOpacity="0.06" />
                <stop offset="1" stopColor={CH.gain} stopOpacity="0.42" />
              </linearGradient>
              <linearGradient id="rb-brk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={CH.loss} stopOpacity="0.06" />
                <stop offset="1" stopColor={CH.loss} stopOpacity="0.42" />
              </linearGradient>
              <clipPath id="rb-wipe">
                <rect
                  x="0"
                  y="0"
                  width={VB_W}
                  height={VB_H}
                  style={{
                    transformOrigin: "0 0",
                    animation: "wipeX 1.7s cubic-bezier(.32,.72,.18,1) both",
                    animationDelay: ".2s",
                  }}
                />
              </clipPath>
            </defs>

            {/* Corner bands — chapter markers down the whole stack. */}
            {ledger.corners.map((c) => {
              const x = px(Math.round(c.corner.start_pct * (n - 1)), n);
              const w = Math.max(
                2,
                px(Math.round(c.corner.end_pct * (n - 1)), n) - x,
              );
              const inside = activeCorner?.corner.id === c.corner.id;
              return (
                <g key={c.corner.id}>
                  <rect
                    x={x}
                    y={CORNER_ROW.bandTop}
                    width={w}
                    height={VB_H - CORNER_ROW.bandTop - 4}
                    fill={inkA(0.032)}
                  />
                  <rect x={x} y={CORNER_ROW.bandTop} width={w} height={2} fill={inside ? CH.a : inkA(0.18)} />
                  <text
                    x={x + w / 2}
                    y={CORNER_ROW.baseline}
                    fill={inside ? CH.a : inkA(0.34)}
                    fontSize={11.5}
                    fontWeight={500}
                    textAnchor="middle"
                  >
                    T{c.corner.id}
                  </text>
                </g>
              );
            })}

            {/* Lane labels + rules. Type here is pre-compensated for the
                horizontal stretch, so these numbers look large in source. */}
            {[
              { label: "Δ time", unit: "s", ...LANE.delta },
              { label: "speed", unit: "km/h", ...LANE.speed },
              { label: "pedals", unit: "%", ...LANE.pedals },
              { label: "steer", unit: "°", ...LANE.steer },
              // The tire lane labels its three rows individually below; naming
              // the lane here as well ran "LF temp" straight into the "L".
            ].map((l, i) => (
              <g
                key={l.label}
                style={{ animation: "fadeUp .45s both", animationDelay: `${(i * 0.08).toFixed(2)}s` }}
              >
                <text x={0} y={l.top + 14} fill={inkA(0.44)} fontSize={13} fontWeight={500}>
                  {l.label}
                </text>
                <text x={0} y={l.top + 29} fill={inkA(0.26)} fontSize={11}>
                  {l.unit}
                </text>
                <line x1={X0} y1={l.top} x2={X1} y2={l.top} stroke={inkA(0.055)} />
                <line x1={X0} y1={l.bottom} x2={X1} y2={l.bottom} stroke={inkA(0.055)} />
              </g>
            ))}

            {/* Data, revealed left to right. */}
            <g clipPath="url(#rb-wipe)">
              <path d={paths.deltaArea} fill="url(#rb-loss)" />
              <polyline points={paths.deltaLine} fill="none" stroke={CH.loss} strokeWidth={1.7} />

              <polyline points={paths.speedA} fill="none" stroke={CH.a} strokeWidth={1.7} />
              <polyline points={paths.speedB} fill="none" stroke={CH.b} strokeWidth={1.5} opacity={0.9} />

              <path d={paths.throttle} fill="url(#rb-thr)" />
              <polyline points={paths.throttleLine} fill="none" stroke={CH.gain} strokeWidth={1.2} />
              <path d={paths.brake} fill="url(#rb-brk)" />
              <polyline points={paths.brakeLine} fill="none" stroke={CH.loss} strokeWidth={1.2} />

              <polyline points={paths.steerA} fill="none" stroke={CH.a} strokeWidth={1.5} />
              <polyline points={paths.steerB} fill="none" stroke={CH.b} strokeWidth={1.2} opacity={0.8} />

              {tireCells?.map((row, r) =>
                row.map((c, i) => (
                  <rect key={`${r}-${i}`} x={c.x} y={c.y} width={c.w} height={16} fill={c.fill} />
                )),
              )}
            </g>

            {/* Reference lines sit above the data so they stay readable. */}
            <line
              x1={X0}
              y1={paths.deltaZeroY}
              x2={X1}
              y2={paths.deltaZeroY}
              stroke={inkA(0.2)}
              strokeDasharray="2 3"
            />
            <line
              x1={X0}
              y1={LANE.pedals.center}
              x2={X1}
              y2={LANE.pedals.center}
              stroke={inkA(0.14)}
            />
            <line
              x1={X0}
              y1={LANE.steer.center}
              x2={X1}
              y2={LANE.steer.center}
              stroke={inkA(0.14)}
              strokeDasharray="2 3"
            />
            {/* One label per band, in the gutter, so the reader never has to
                match a letter against a lane name somewhere else. */}
            {["LF L", "LF M", "LF R"].map((t, r) => (
              <text key={t} x={0} y={LANE.tire.top + r * 18 + 12} fill={inkA(0.42)} fontSize={11}>
                {t}
              </text>
            ))}
            <text x={0} y={LANE.tire.bottom + 12} fill={inkA(0.26)} fontSize={10}>
              °C
            </text>
            <line x1={X0} y1={LANE.tire.top} x2={X1} y2={LANE.tire.top} stroke={inkA(0.055)} />
            <line x1={X0} y1={LANE.tire.bottom} x2={X1} y2={LANE.tire.bottom} stroke={inkA(0.055)} />

            {/* Event pins. */}
            {bundle.events
              .filter((e) => e.lap_number === traceA.lap_number)
              .map((e, i) => {
                const x = px(Math.round(e.pct * (n - 1)), n);
                const color = e.kind === "lockup" ? CH.loss : CH.warn;
                return (
                  <g key={i}>
                    <rect x={x - 1} y={LANE.events.top} width={2} height={18} fill={color} />
                    <rect x={x - 1.5} y={LANE.events.top} width={3} height={3} fill={color} />
                  </g>
                );
              })}

            <text x={X0} y={VB_H - 3} fill={inkA(0.3)} fontSize={11}>
              0%
            </text>
            <text x={X1} y={VB_H - 3} fill={inkA(0.3)} fontSize={11} textAnchor="end">
              100% of the lap, by distance
            </text>

            {/* Cursor. Sweeps in from the plot's left edge on mount. */}
            <g
              style={
                {
                  "--from": `${-(cursorX - X0)}px`,
                  animation: "sweepIn 2.1s cubic-bezier(.22,.9,.2,1) both",
                } as React.CSSProperties
              }
            >
              <line
                x1={cursorX}
                y1={CORNER_ROW.bandTop}
                x2={cursorX}
                y2={LANE.events.bottom}
                stroke={INK.text}
                strokeWidth={1}
                opacity={0.55}
              />
              {/* Clamped to the plot so the chip never hangs off either edge. */}
              <rect
                x={Math.min(Math.max(cursorX - 26, 0), VB_W - 52)}
                y={CURSOR_CHIP.top}
                width={52}
                height={CURSOR_CHIP.height}
                rx={4}
                fill={INK.text}
              />
              <text
                x={Math.min(Math.max(cursorX, 26), VB_W - 26)}
                y={CURSOR_CHIP.baseline}
                fill={INK.bg}
                fontSize={11}
                fontWeight={600}
                textAnchor="middle"
              >
                {(state.cursor * 100).toFixed(1)}%
              </text>
            </g>
          </svg>
        </div>

        {/* Readout column */}
        <div
          style={{
            width: 300,
            flex: "none",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            minHeight: 0,
          }}
        >
          <Panel style={{ flex: "none" }} padding="var(--space-3)">
            <div style={{ height: 206 }}>
              <RibbonLocator ci={ci} activeFrom={activeCorner?.from} activeTo={activeCorner?.to} />
            </div>
          </Panel>

          <Panel
            fill
            title="At the cursor"
            padding="var(--space-3) var(--space-4) var(--space-4)"
            foot={
              <Caveat>
                Distance-resampled: the cursor moves at constant distance, not real
                time. Every row is a channel the .ibt actually carries.
              </Caveat>
            }
          >
            <div className="scrollpane" style={{ flex: 1, minHeight: 0 }}>
              {[
                { l: "speed", v: kmh(traceA.speed[ci]), u: "km/h" },
                { l: "gap to reference", v: fmtDelta(paths.delta[ci]), u: "s" },
                { l: "throttle", v: pct(traceA.throttle[ci]), u: "%" },
                { l: "brake", v: pct(traceA.brake[ci]), u: "%" },
                { l: "steer", v: fixed((traceA.steer[ci] * 180) / Math.PI, 1), u: "°" },
                { l: "gear", v: String(traceA.gear[ci]), u: "" },
                { l: "engine", v: String(traceA.rpm[ci]), u: "rpm" },
                { l: "lateral", v: toG(traceA.lat_accel[ci]), u: "g" },
                { l: "longitudinal", v: toG(traceA.long_accel[ci]), u: "g" },
                { l: "LF surface", v: fixed(bundle.tire.left_c[ci], 0), u: "°C" },
              ].map((r) => (
                <div
                  key={r.l}
                  className="rule-row"
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--space-2)",
                    padding: "5px 0",
                  }}
                >
                  <span style={{ fontSize: 11, color: dim(50), flex: 1 }}>{r.l}</span>
                  <span className="num" style={{ font: "500 13px var(--font-heading)" }}>
                    {r.v}
                  </span>
                  <span style={{ width: 28, fontSize: 10, color: dim(35) }}>{r.u}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function LapChip({
  color,
  letter,
  lap,
  time,
  reference,
}: {
  color: string;
  letter: string;
  lap: number;
  time: number;
  reference?: boolean;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11.5, color: dim(55) }}>{letter}</span>
      <span style={{ font: "500 12.5px var(--font-heading)" }}>lap {lap}</span>
      <span className="num" style={{ fontSize: 11.5, color: dim(45) }}>
        {fmtLap(time)}
      </span>
      {reference && (
        <span className="tag tag-outline" style={{ fontSize: 10, padding: "2px 7px" }}>
          reference
        </span>
      )}
    </span>
  );
}

function RibbonLocator({
  ci,
  activeFrom,
  activeTo,
}: {
  ci: number;
  activeFrom?: number;
  activeTo?: number;
}) {
  const { bundle } = useProctor();
  if (!bundle) return null;
  const { x_m, y_m } = bundle.map;
  const p = project(x_m, y_m, 280, 206, 16);
  const outline = `${pathFor(p, x_m, y_m, 0, x_m.length, 4)} Z`;

  return (
    <svg viewBox="0 0 280 206" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden>
      <path d={outline} fill="none" stroke={INK.neutral800} strokeWidth={7} strokeLinejoin="round" />
      <path d={outline} fill="none" stroke={INK.accent2_700} strokeWidth={2} strokeLinejoin="round" />
      {activeFrom != null && activeTo != null && (
        <path
          d={pathFor(p, x_m, y_m, activeFrom, activeTo, 2)}
          fill="none"
          stroke={CH.a}
          strokeWidth={3.4}
          strokeLinecap="round"
        />
      )}
      <circle
        cx={p.X(x_m[ci])}
        cy={p.Y(y_m[ci])}
        r={10}
        fill={CH.a}
        opacity={0.18}
        style={{ animation: "glowPulse 2.4s ease-in-out infinite" }}
      />
      <circle cx={p.X(x_m[ci])} cy={p.Y(y_m[ci])} r={4} fill={INK.text} />
    </svg>
  );
}
