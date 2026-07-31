"use client";

/* Corner detail as a BOTTOM SHEET, not a route.
 *
 * The list stays mounted behind it, so closing returns you to exactly where you
 * were in the ranking — no back navigation, no scroll position to restore, and
 * the answer never leaves the screen. That is the whole reason this is a sheet.
 *
 * Every caveat from the desktop corner panel survives here, in the same words. */

import { useEffect, useMemo } from "react";
import { Info } from "lucide-react";

import { CH, INK, deltaColor, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtDelta, kmh, toG } from "@/lib/proctor/format";
import { pathFor, pathLength, project, windowExtent, wrapIndex } from "@/lib/proctor/geometry";
import { observation } from "@/lib/proctor/ledger";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

export default function CornerSheet() {
  const { bundle, state, dispatch, ledger, traceA, traceB } = useProctor();
  const open = state.sheet != null;

  // A sheet that leaves the page scrollable behind it feels broken on a phone.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes it, same as tapping the backdrop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ t: "sheet", id: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  const sel = useMemo(
    () => ledger?.corners.find((c) => c.corner.id === state.sheet) ?? null,
    [ledger, state.sheet],
  );

  const map = useMemo(() => {
    if (!bundle || !sel) return null;
    const p = project(bundle.map.x_m, bundle.map.y_m, 330, 200, 20);
    return {
      outline: `${pathFor(p, bundle.map.x_m, bundle.map.y_m, 0, bundle.gridSize, 5)} Z`,
      arc: pathFor(p, bundle.map.x_m, bundle.map.y_m, sel.from, sel.to, 2),
      len: pathLength(p, bundle.map.x_m, bundle.map.y_m, sel.from, sel.to, 2),
      apex: (() => {
        const k = wrapIndex(Math.round(sel.corner.apex_pct * bundle.gridSize), bundle.gridSize);
        return { x: p.X(bundle.map.x_m[k]), y: p.Y(bundle.map.y_m[k]) };
      })(),
    };
  }, [bundle, sel]);

  const traces = useMemo(() => {
    if (!sel || !traceA || !traceB) return null;
    const n = traceA.speed.length;
    const steps = 70;
    // All four series share one window and one speed scale, so lap B visibly
    // sits below lap A where it was slower.
    const [lo, hi] = windowExtent(sel.from, sel.to, traceA.speed, traceB.speed);
    const maxSteer = Math.max(...traceA.steer.map(Math.abs), 1e-6);
    const at = (q: number) => wrapIndex(Math.round(sel.from + ((sel.to - sel.from) * q) / steps), n);
    const line = (get: (k: number) => number) =>
      Array.from({ length: steps + 1 }, (_, q) => `${((q / steps) * 330).toFixed(1)},${get(at(q)).toFixed(1)}`).join(" ");

    const brakePts = Array.from(
      { length: steps + 1 },
      (_, q) => `${((q / steps) * 330).toFixed(1)} ${(104 - traceA.brake[at(q)] * 44).toFixed(1)}`,
    ).join(" L ");

    return {
      brake: `M 0 104 L ${brakePts} L 330 104 Z`,
      steer: line((k) => 60 - (traceA.steer[k] / maxSteer) * 22),
      speedA: line((k) => 96 - ((traceA.speed[k] - lo) / Math.max(hi - lo, 1e-6)) * 84),
      speedB: line((k) => 96 - ((traceB.speed[k] - lo) / Math.max(hi - lo, 1e-6)) * 84),
    };
  }, [sel, traceA, traceB]);

  if (!open || !sel || !bundle || !map || !traces || !traceA) return null;

  const c = sel.corner;
  const n = traceA.speed.length;
  const apexI = wrapIndex(Math.round(c.apex_pct * n), n);
  let peakBrake = 0;
  let peakLat = 0;
  for (let i = sel.from; i <= sel.to; i++) {
    const k = wrapIndex(i, n);
    peakBrake = Math.max(peakBrake, -traceA.long_accel[k]);
    peakLat = Math.max(peakLat, Math.abs(traceA.lat_accel[k]));
  }

  const close = () => dispatch({ t: "sheet", id: null });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "color-mix(in srgb, var(--color-neutral-900) 62%, transparent)",
        animation: "fadeIn .2s both",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        style={{ position: "absolute", inset: 0, border: 0, background: "transparent", cursor: "pointer" }}
      />

      <div
        role="dialog"
        aria-label={`Corner ${c.id}`}
        className="scrollpane"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "88%",
          background: "var(--color-surface)",
          borderRadius: "18px 18px 0 0",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-3) var(--space-6) calc(env(safe-area-inset-bottom, 0px) + 46px)",
          animation: "sheetUp .34s cubic-bezier(.2,.9,.2,1) both",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          className="tap"
          onClick={close}
          style={{
            display: "block",
            width: 44,
            height: 5,
            borderRadius: 3,
            border: 0,
            background: dim(22),
            margin: "0 auto var(--space-4)",
            padding: 0,
          }}
        />

        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
          <span style={{ font: "500 22px var(--font-heading)" }}>T{c.id}</span>
          <span style={{ fontSize: 12, color: dim(45) }}>
            {c.radius_m} m {c.dir} · at {(c.apex_pct * 100).toFixed(0)}% of the lap
          </span>
          <span style={{ flex: 1 }} />
          <span
            className="num"
            style={{ font: "500 18px var(--font-heading)", color: deltaColor(sel.delta) }}
          >
            {fmtDelta(sel.delta)} s
          </span>
        </div>

        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: dim(62), marginTop: "var(--space-2)" }}>
          {observation(sel)}
        </div>

        <svg
          viewBox="0 0 330 200"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: 190, display: "block", marginTop: "var(--space-3)" }}
          aria-hidden
        >
          <path d={map.outline} fill="none" stroke={INK.neutral800} strokeWidth={7} strokeLinejoin="round" />
          <path d={map.outline} fill="none" stroke={INK.accent2_700} strokeWidth={2} strokeLinejoin="round" />
          <path
            d={map.arc}
            fill="none"
            stroke={deltaColor(sel.delta)}
            strokeWidth={14}
            strokeLinecap="round"
            opacity={0.16}
          />
          <path
            d={map.arc}
            fill="none"
            stroke={deltaColor(sel.delta)}
            strokeWidth={4}
            strokeLinecap="round"
            style={
              {
                "--len": `${map.len}px`,
                strokeDasharray: map.len,
                strokeDashoffset: map.len,
                animation: "drawIn .8s ease-out .15s both",
                animationDirection: "reverse",
              } as React.CSSProperties
            }
          />
          <circle cx={map.apex.x} cy={map.apex.y} r={4} fill={INK.text} />
          <text x={map.apex.x + 8} y={map.apex.y + 4} fill={inkA(0.7)} fontSize={10} fontWeight={500}>
            apex
          </text>
        </svg>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "var(--space-3) var(--space-4)",
            marginTop: "var(--space-3)",
          }}
        >
          {[
            { l: "slowest", v: kmh(sel.minSpeedA), u: "km/h" },
            { l: "entry", v: kmh(traceA.speed[wrapIndex(sel.from, n)]), u: "km/h" },
            { l: "exit", v: kmh(traceA.speed[wrapIndex(sel.to, n)]), u: "km/h" },
            { l: "peak brake", v: toG(peakBrake), u: "g", c: CH.loss },
            { l: "peak lateral", v: toG(peakLat), u: "g", c: CH.a },
            {
              l: "LF L/M/R",
              v: `${fixed(bundle.tire.left_c[apexI], 0)}/${fixed(bundle.tire.middle_c[apexI], 0)}/${fixed(bundle.tire.right_c[apexI], 0)}`,
              u: "°C",
            },
          ].map((s) => (
            <div key={s.l}>
              <div
                style={{
                  font: "500 9px var(--font-heading)",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: dim(38),
                }}
              >
                {s.l}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                <span className="num" style={{ font: "500 16px var(--font-heading)", color: s.c ?? "var(--color-text)" }}>
                  {s.v}
                </span>
                <span style={{ fontSize: 9.5, color: dim(35) }}>{s.u}</span>
              </div>
            </div>
          ))}
        </div>

        <div
          className="rule"
          style={{ "--fade": "20px", margin: "var(--space-4) 0 var(--space-3)" } as React.CSSProperties}
        />

        <div
          style={{
            font: "500 9.5px var(--font-heading)",
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: dim(38),
            marginBottom: 5,
          }}
        >
          speed, brake &amp; steer through the corner
        </div>
        <svg
          viewBox="0 0 330 110"
          preserveAspectRatio="none"
          style={{ width: "100%", height: 110, display: "block" }}
          aria-hidden
        >
          <line x1="0" y1="104" x2="330" y2="104" stroke={inkA(0.09)} />
          <path d={traces.brake} fill="rgba(224,104,94,.2)" stroke={CH.loss} strokeWidth={1.3} />
          <polyline points={traces.steer} fill="none" stroke={CH.a} strokeWidth={1.4} opacity={0.55} />
          <polyline points={traces.speedA} fill="none" stroke={CH.a} strokeWidth={1.8} />
          <polyline points={traces.speedB} fill="none" stroke={CH.b} strokeWidth={1.6} />
        </svg>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-3)",
            fontSize: 10,
            color: dim(42),
            marginTop: 2,
          }}
        >
          {[
            { c: CH.a, t: `lap ${traceA.lap_number} speed` },
            { c: CH.b, t: `lap ${traceB?.lap_number} speed` },
            { c: CH.loss, t: "brake" },
            { c: CH.a, t: "steer" },
          ].map((l) => (
            <span key={l.t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 2, background: l.c }} />
              {l.t}
            </span>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: "var(--space-4)",
            fontSize: 10.5,
            lineHeight: 1.5,
            color: dim(36),
          }}
        >
          <Info size={12} style={{ flex: "none", marginTop: 2 }} />
          <span>{noteFor("lap.reference")}</span>
        </div>
      </div>
    </div>
  );
}
