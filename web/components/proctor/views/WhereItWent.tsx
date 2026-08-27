"use client";

/* View 1 — "Where it went". The most important screen in the product.
 *
 * It leads with the answer (which corners cost time, in order, and how much)
 * and puts the evidence one row behind it. Everything here describes; nothing
 * prescribes. There is no "brake later" in this file and there must not be one
 * — the technique and setup call stays with the driver. */

import { useMemo } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import NotDrawable from "@/components/proctor/ui/NotDrawable";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, deltaColor, deltaSense, dim, inkA } from "@/lib/proctor/channels";
import { fixed, fmtCornerGeometry, fmtDelta, fmtLap, kmh, toG } from "@/lib/proctor/format";
import { windowExtent, wrapIndex } from "@/lib/proctor/geometry";
import { noteFor } from "@/lib/proctor/provenance";
import { observation, ranked } from "@/lib/proctor/ledger";
import { useProctor } from "@/lib/proctor/store";
import { techniqueForLap } from "@/lib/proctor/technique";
import type { CornerDelta } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

export default function WhereItWent() {
  const { bundle, state, dispatch, ledger, traceA, traceB, selectedCornerId, readiness } =
    useProctor();

  const rows = useMemo(() => (ledger ? ranked(ledger) : []), [ledger]);

  const stack = useMemo(() => {
    if (!ledger) return null;
    const losses = ledger.corners.filter((c) => c.delta > 0.004);
    const totalLoss = losses.reduce((s, c) => s + c.delta, 0);
    // Only a positive remainder can be drawn as a block. A negative one is
    // stated in words below instead — see the caption.
    const rest = Math.max(0, ledger.remainder);
    return { losses, totalLoss, rest, stackTotal: totalLoss + rest || 1 };
  }, [ledger]);

  /* `readiness` distinguishes "still fetching" from "this session will never
     produce a ledger". `stack` is derived from the ledger, so it is checked
     alongside rather than folded into the loading case. */
  if (readiness.state !== "ready" || !bundle || !ledger || !traceA || !traceB || !stack) {
    return <NotDrawable readiness={readiness.state === "ready" ? { state: "loading" } : readiness} />;
  }

  const selected = rows.find((c) => c.corner.id === selectedCornerId) ?? rows[0];
  const gainedBack = ledger.corners.reduce((s, c) => s + Math.min(0, c.delta), 0);
  const costing = ledger.corners.filter((c) => c.delta > 0.004).length;
  const worst = Math.max(...ledger.corners.map((c) => c.delta), 1e-6);
  const sense = deltaSense(ledger.lapDelta);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "var(--space-6) var(--space-6) var(--space-4)", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-8)" }}>
          <div style={{ minWidth: 0 }}>
            <Eyebrow size={10} style={{ letterSpacing: ".11em" }}>
              lap {state.lapB} measured against your best valid lap
            </Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
              <span
                className="num"
                style={{
                  font: "500 40px/1 var(--font-heading)",
                  color: sense === "gain" ? CH.gain : CH.loss,
                }}
              >
                {fmtDelta(ledger.lapDelta)}
              </span>
              <span style={{ fontSize: 15, color: dim(45) }}>s</span>
              <span style={{ fontSize: 12, color: dim(42), marginLeft: 6 }} className="num">
                {fmtLap(traceB.lap_time_s)} against {fmtLap(traceA.lap_time_s)}
              </span>
            </div>
          </div>

          <span style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: "var(--space-8)", flex: "none" }}>
            <Stat label="corners costing time" value={`${costing} of ${ledger.corners.length}`} />
            <Stat label="biggest single loss" value={fmtDelta(worst)} color={CH.loss} />
            <Stat
              label="time taken back"
              value={gainedBack < -0.0005 ? fmtDelta(gainedBack) : "none"}
              color={gainedBack < -0.0005 ? CH.gain : dim(45)}
            />
          </div>
        </div>

        {/* ── The contribution bar ───────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 2,
            height: 26,
            marginTop: "var(--space-4)",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {stack.losses.map((c, i) => {
            const share = (c.delta / stack.stackTotal) * 100;
            const on = c.corner.id === selectedCornerId;
            return (
              <button
                key={c.corner.id}
                type="button"
                title={`T${c.corner.id} — ${fmtDelta(c.delta)} s`}
                onClick={() => dispatch({ t: "corner", id: c.corner.id })}
                style={{
                  width: `${share.toFixed(2)}%`,
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  background: `rgba(224,104,94,${(0.3 + 0.55 * (c.delta / worst)).toFixed(2)})`,
                  boxShadow: on ? "inset 0 0 0 2px var(--color-text)" : "none",
                  transformOrigin: "left",
                  animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${(0.2 + i * 0.05).toFixed(2)}s`,
                }}
              >
                {share > 4.5 && (
                  <span style={{ font: "500 9.5px var(--font-heading)", color: "rgba(255,240,238,.92)" }}>
                    T{c.corner.id}
                  </span>
                )}
              </button>
            );
          })}

          {/* REQUIRED. The corners genuinely do not sum to the lap; quietly
              distributing the difference into them would be fabrication. */}
          {stack.rest > 0 && (
            <div
              title={`straights — ${fmtDelta(stack.rest)} s`}
              style={{
                width: `${((stack.rest / stack.stackTotal) * 100).toFixed(2)}%`,
                background: dim(14),
                display: "grid",
                placeItems: "center",
                transformOrigin: "left",
                animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${(0.2 + stack.losses.length * 0.05).toFixed(2)}s`,
              }}
            >
              <span style={{ font: "500 9.5px var(--font-heading)", color: dim(60) }}>straights</span>
            </div>
          )}
        </div>

        <Caveat icon={false} maxWidth={900}>
          Each block is one corner&apos;s share of the gap, sized by what it cost. The
          corners do not add up to the lap — what is left went to the parts that are
          not corners, and it keeps its own block rather than being folded into the
          others.
          {ledger.remainder < -0.004 && (
            <>
              {" "}
              Here the corners account for{" "}
              <strong style={{ color: dim(58), fontWeight: 500 }}>
                {Math.abs(ledger.remainder * 1000).toFixed(0)} ms more
              </strong>{" "}
              than the lap gap, so that much came back on the parts that are not
              corners. There is no block for it because it is not a cost.
            </>
          )}
        </Caveat>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: "var(--space-4)",
          padding: "0 var(--space-6) var(--space-6)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-3)",
              marginBottom: "var(--space-2)",
              flex: "none",
            }}
          >
            <span style={{ font: "500 12.5px var(--font-heading)" }}>Ranked by cost</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: dim(40) }}>
              bar = seconds against the reference · sparkline = both laps&apos; speed
              through the corner
            </span>
          </div>

          <div
            className="scrollpane"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 2, overflowX: "hidden" }}
          >
            {rows.map((c, i) => (
              <RankedRow
                key={c.corner.id}
                c={c}
                rank={i + 1}
                index={i}
                maxAbs={ledger.maxAbs}
                selected={c.corner.id === selectedCornerId}
                onSelect={() => dispatch({ t: "corner", id: c.corner.id })}
                speedA={traceA.speed}
                speedB={traceB.speed}
              />
            ))}
          </div>
        </div>

        {/* Right column */}
        <div
          style={{
            width: 372,
            flex: "none",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            minHeight: 0,
          }}
        >
          <CornerLocator selected={selected} />
          {/* At "glance" the answer leads and the evidence steps back. The
              panel is not missing — the note under the view says it is hidden. */}
          {atLeast(state.tier, "deep") && <CarState selected={selected} />}
          {/* Deliberately the LAST thing in this column, after every panel that
              reads this driver's own file. It is general technique and carries
              a label saying so; putting it above a measurement would invite it
              to be read as one. */}
          <TechniqueNotes notes={techniqueForLap(ledger)} showBecause={false} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <Eyebrow size={10}>{label}</Eyebrow>
      <div
        className="num"
        style={{ font: "500 20px var(--font-heading)", color: color ?? "var(--color-text)", marginTop: 3 }}
      >
        {value}
      </div>
    </div>
  );
}

function RankedRow({
  c,
  rank,
  index,
  maxAbs,
  selected,
  onSelect,
  speedA,
  speedB,
}: {
  c: CornerDelta;
  rank: number;
  index: number;
  maxAbs: number;
  selected: boolean;
  onSelect: () => void;
  speedA: number[];
  speedB: number[];
}) {
  const sense = deltaSense(c.delta);
  const width = Math.max(1.5, (Math.abs(c.delta) / maxAbs) * 50);
  const delay = `${(0.25 + index * 0.035).toFixed(3)}s`;

  /* Both polylines share ONE min/max over this corner's window. On independent
     scales, lap B would sit in the same place as lap A no matter how much
     slower it was — which hides the entire point of putting them together. */
  const spark = useMemo(() => {
    const [lo, hi] = windowExtent(c.from, c.to, speedA, speedB);
    const line = (arr: number[]) => {
      const steps = 34;
      const pts: string[] = [];
      for (let s = 0; s <= steps; s++) {
        const i = Math.round(c.from + ((c.to - c.from) * s) / steps);
        const k = wrapIndex(i, arr.length);
        pts.push(
          `${((s / steps) * 120).toFixed(1)},${(20 - ((arr[k] - lo) / Math.max(hi - lo, 1e-6)) * 17).toFixed(1)}`,
        );
      }
      return pts.join(" ");
    };
    return { a: line(speedA), b: line(speedB) };
  }, [c.from, c.to, speedA, speedB]);

  return (
    <div
      className="crow"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-3)",
        rowGap: 2,
        padding: "6px var(--space-2)",
        borderRadius: 7,
        flex: "none",
        background: selected ? "rgba(224,104,94,.09)" : "transparent",
        boxShadow: selected ? "inset 0 0 0 1px rgba(224,104,94,.3)" : "none",
        animation: "fadeUp .4s both",
        animationDelay: delay,
      }}
    >
      <span className="num" style={{ width: 14, textAlign: "right", fontSize: 10, color: dim(30) }}>
        {rank}
      </span>
      <span
        style={{
          width: 26,
          font: "500 13px var(--font-heading)",
          color: selected ? CH.loss : "var(--color-text)",
        }}
      >
        T{c.corner.id}
      </span>
      <span style={{ width: 62, fontSize: 10, color: dim(40) }}>
        {fmtCornerGeometry(c.corner.radius_m, c.corner.dir)}
      </span>

      {/* Diverging bar: right for a loss, left for a gain, from a centre line. */}
      <span style={{ width: 140, height: 16, position: "relative", display: "block", flex: "none" }}>
        <span
          style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: dim(16) }}
        />
        <span
          style={{
            position: "absolute",
            top: 3,
            height: 10,
            borderRadius: 2,
            left: sense === "gain" ? `${(50 - width).toFixed(1)}%` : "50%",
            width: `${width.toFixed(1)}%`,
            background: deltaColor(c.delta),
            transformOrigin: sense === "gain" ? "right" : "left",
            animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
            animationDelay: delay,
          }}
        />
      </span>

      <span
        className="num"
        style={{
          width: 50,
          textAlign: "right",
          font: "500 12px var(--font-heading)",
          color: deltaColor(c.delta),
        }}
      >
        {fmtDelta(c.delta)}
      </span>

      <svg
        viewBox="0 0 120 22"
        preserveAspectRatio="none"
        style={{ width: 112, height: 22, display: "block", flex: "none" }}
        aria-hidden
      >
        <polyline points={spark.a} fill="none" stroke={CH.a} strokeWidth={1.3} />
        <polyline points={spark.b} fill="none" stroke={CH.b} strokeWidth={1.3} />
      </svg>

      {/* flex-basis 200px + wrap on the row is what makes this reflow to a
          second line instead of crushing to nothing on a narrow workspace. */}
      <span
        style={{
          flex: "1 1 200px",
          minWidth: 0,
          fontSize: 11,
          color: dim(55),
          textWrap: "pretty",
        }}
      >
        {observation(c)}
      </span>
    </div>
  );
}

function CornerLocator({ selected }: { selected: CornerDelta }) {
  const { bundle } = useProctor();
  if (!bundle) return null;
  const c = selected.corner;

  return (
    <Panel
      padding="var(--space-3) var(--space-4) var(--space-2)"
      style={{ flex: "none" }}
      title={`T${c.id}`}
      sub={`${fmtCornerGeometry(c.radius_m, c.dir)} · at ${(c.apex_pct * 100).toFixed(0)}% of the lap`}
      right={
        <span
          className="num"
          style={{ font: "500 13px var(--font-heading)", color: deltaColor(selected.delta) }}
        >
          {fmtDelta(selected.delta)} s
        </span>
      }
    >
      <div style={{ height: 234 }}>
        <TrackMap
          key={c.id}
          x={bundle.map.x_m}
          y={bundle.map.y_m}
          w={340}
          h={234}
          pad={20}
          baseWidth={8}
          highlight={{
            from: selected.from,
            to: selected.to,
            color: selected.delta > 0 ? CH.loss : CH.gain,
          }}
        />
      </div>
    </Panel>
  );
}

function CarState({ selected }: { selected: CornerDelta }) {
  const { bundle, traceA } = useProctor();
  if (!bundle || !traceA) return null;

  const n = traceA.speed.length;
  const at = (i: number) => wrapIndex(i, n);
  const apexI = at(Math.round(selected.corner.apex_pct * n));

  let peakBrake = 0;
  let peakLat = 0;
  let entry = 0;
  let exit = 0;
  for (let i = selected.from; i <= selected.to; i++) {
    const k = at(i);
    peakBrake = Math.max(peakBrake, -traceA.long_accel[k]);
    peakLat = Math.max(peakLat, Math.abs(traceA.lat_accel[k]));
  }
  entry = traceA.speed[at(selected.from)];
  exit = traceA.speed[at(selected.to)];

  const stats = [
    { label: "slowest point", value: kmh(selected.minSpeedA), unit: "km/h" },
    { label: "entry", value: kmh(entry), unit: "km/h" },
    { label: "exit", value: kmh(exit), unit: "km/h" },
    { label: "peak brake", value: toG(peakBrake), unit: "g", color: CH.loss },
    { label: "peak lateral", value: toG(peakLat), unit: "g", color: CH.a },
    {
      label: "LF temp L/M/R",
      value: `${fixed(bundle.tire.left_c[apexI], 0)}/${fixed(bundle.tire.middle_c[apexI], 0)}/${fixed(bundle.tire.right_c[apexI], 0)}`,
      unit: "°C",
    },
  ];

  // Brake and steer through this corner only.
  const steps = 60;
  const maxSteer = Math.max(...traceA.steer.map(Math.abs), 1e-6);
  const brakePts: string[] = [];
  const steerPts: string[] = [];
  for (let q = 0; q <= steps; q++) {
    const i = Math.round(selected.from + ((selected.to - selected.from) * q) / steps);
    const k = at(i);
    const x = ((q / steps) * 330).toFixed(1);
    brakePts.push(`${x} ${(70 - traceA.brake[k] * 60).toFixed(1)}`);
    steerPts.push(`${x},${(36 - (traceA.steer[k] / maxSteer) * 30).toFixed(1)}`);
  }

  return (
    <Panel
      fill
      padding="var(--space-4)"
      style={{ minHeight: 0 }}
      foot={<Caveat>{noteFor("lap.reference")}</Caveat>}
    >
      <Eyebrow size={9.5} style={{ letterSpacing: ".09em", marginBottom: "var(--space-3)" }}>
        what the car was doing here
      </Eyebrow>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px var(--space-6)" }}>
        {stats.map((s) => (
          <div key={s.label}>
            <Eyebrow size={9.5} style={{ letterSpacing: ".09em", color: dim(38) }}>
              {s.label}
            </Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span
                className="num"
                style={{ font: "500 15px var(--font-heading)", color: s.color ?? "var(--color-text)" }}
              >
                {s.value}
              </span>
              <span style={{ fontSize: 9.5, color: dim(35) }}>{s.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rule" style={{ "--fade": "20px", margin: "var(--space-4) 0 var(--space-3)" } as React.CSSProperties} />

      <Eyebrow size={10.5} style={{ letterSpacing: ".09em", marginBottom: 5 }}>
        brake &amp; steer through the corner
      </Eyebrow>
      <svg
        viewBox="0 0 330 74"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 74, display: "block" }}
        aria-hidden
      >
        <line x1="0" y1="36" x2="330" y2="36" stroke={inkA(0.09)} />
        <path
          d={`M 0 70 L ${brakePts.join(" L ")} L 330 70 Z`}
          fill="rgba(224,104,94,.22)"
          stroke={CH.loss}
          strokeWidth={1.3}
        />
        <polyline points={steerPts.join(" ")} fill="none" stroke={CH.a} strokeWidth={1.4} />
      </svg>
    </Panel>
  );
}

