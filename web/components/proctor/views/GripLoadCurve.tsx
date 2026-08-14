"use client";

/* Force against the load that produced it.
 *
 * ┌ WHY THIS PICTURE AND NOT A BIGGER NUMBER ───────────────────────────────┐
 * │ The grip block's headline is peak mu — horizontal force over vertical   │
 * │ load. mu is a RATIO, so its largest values come from the ticks with the │
 * │ smallest denominator: the car at its lightest, over a crest, skimming a │
 * │ kerb. Ranking ticks by that ratio finds the moments the car was least   │
 * │ planted and calls them peak grip.                                       │
 * │                                                                         │
 * │ Binning by load asks the question that has an answer instead: at THIS   │
 * │ much load, how much force came back. Plotted, three things are legible  │
 * │ at once that no scalar carries:                                         │
 * │                                                                         │
 * │   how far right the line reaches  — the load the car ever carried,      │
 * │                                     which is weight plus downforce      │
 * │   whether the line bends below    — rubber is load sensitive; force per │
 * │   a straight ray                    unit of load falls as load rises    │
 * │   how far the line sits under     — grip left unused. That is           │
 * │   the ray it started on             commitment, not tire.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The reference rays are lines of constant mu (y = mu·x). If grip were
 * load-independent the measured line would run straight along one of them. It
 * does not, and the gap between where it starts and where it ends IS the
 * finding — which is why they are drawn rather than described.
 *
 * Single series, so no legend box: the title says what is plotted. Bins too
 * sparse to trust are drawn hollow rather than dropped, because a missing point
 * and an uncertain one are different facts — and the hollow convention is
 * spelled out under the plot, since an encoding nobody explains is decoration.
 */

import { useMemo, useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import type { GripData, GripLoadBin } from "@/lib/proctor/types";

const VBW = 560;
const VBH = 330;
const PAD = { top: 18, right: 54, bottom: 40, left: 46 };

/** Below this a bin is drawn hollow: measured, but thin enough that the reader
 *  should weigh it less. The module's own slope already weights by tick count. */
const SPARSE_TICKS = 120;

export default function GripLoadCurve({ grip }: { grip: GripData }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showValues, setShowValues] = useState(false);

  const curve = grip.byLoad;

  const geom = useMemo(() => {
    const bins = (curve?.bins ?? []).filter(
      (b): b is GripLoadBin & { peak_horizontal_g: number } =>
        b.measured && typeof b.peak_horizontal_g === "number",
    );
    if (bins.length < 2) return null;

    const loads = bins.map((b) => b.load_g);
    const forces = bins.map((b) => b.peak_horizontal_g);

    // Both axes start at zero: a constant-mu ray passes through the origin, so
    // a truncated axis would bend a straight reference line and invent the very
    // curvature this chart exists to show.
    const xMax = Math.max(...loads) * 1.12;
    const yMax = Math.max(...forces) * 1.14;

    const x = (v: number) => PAD.left + (v / xMax) * (VBW - PAD.left - PAD.right);
    const y = (v: number) => VBH - PAD.bottom - (v / yMax) * (VBH - PAD.top - PAD.bottom);

    // Constant-mu rays spanning the data, on clean 0.25 steps.
    const muLo = Math.min(...bins.map((b) => b.peak_horizontal_g / b.load_g));
    const muHi = Math.max(...bins.map((b) => b.peak_horizontal_g / b.load_g));
    const rays: number[] = [];
    for (let m = Math.floor(muLo * 4) / 4; m <= muHi + 0.25; m += 0.25) {
      if (m > 0) rays.push(Math.round(m * 100) / 100);
    }

    /* The line joins only the bins thick enough to trust.
     *
     * Drawn through everything, the first two bins — a hundred-odd ticks of
     * crest, where the car is unloaded AND the driver is asking for nothing —
     * produced a near-vertical leap into the populated middle. That slope is
     * commitment, not grip, and a line implies a continuity between the two
     * that the data does not have. Sparse bins still appear, hollow and
     * unconnected: an uncertain point and a missing one are different facts. */
    const solid = bins.filter((b) => b.ticks >= SPARSE_TICKS);
    const path = solid
      .map((b, i) => `${i === 0 ? "M" : "L"}${x(b.load_g).toFixed(2)} ${y(b.peak_horizontal_g).toFixed(2)}`)
      .join(" ");

    return { bins, solid, x, y, xMax, yMax, rays, path };
  }, [curve]);

  if (!curve || !curve.measured || !geom) {
    return (
      <Panel title="Force against the load that made it" padding="var(--space-4)">
        <div style={{ fontSize: 12, color: dim(55), lineHeight: 1.6 }}>
          {curve?.reason ??
            "This session was ingested before the grip-against-load curve existed. Re-ingesting it from the rig computes it from the same bytes."}
        </div>
      </Panel>
    );
  }

  const { bins, solid, x, y, xMax, yMax, rays, path } = geom;
  const active = hover != null ? bins[hover] : null;

  // Direct labels are selective: the two ends of the curve, which are the two
  // numbers the finding is about. Everything else lives in the tooltip and the
  // table below, so no value is reachable only by hovering.
  const labelled = solid.length >= 2 ? solid : bins;
  const first = labelled[0];
  const last = labelled[labelled.length - 1];

  return (
    <Panel
      title="Force against the load that made it"
      sub="every moving tick, binned by vertical load"
      padding="var(--space-4)"
      foot={
        <Caveat>
          Still the grip you used, not the grip the tires had. A bin you never
          pushed in reads low because nothing asked for more — which is why the
          line sitting under a ray is a statement about commitment, not rubber.
        </Caveat>
      }
    >
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        role="img"
        aria-label={`Peak horizontal force against vertical load. ${curve.load_sensitivity_note ?? ""}`}
        onPointerLeave={() => setHover(null)}
      >
        {/* Constant-mu rays. Hairline, solid, recessive — reference, not data. */}
        {rays.map((m) => {
          const xEnd = Math.min(xMax, yMax / m);
          const yEnd = m * xEnd;
          return (
            <g key={m}>
              <line
                x1={x(0)}
                y1={y(0)}
                x2={x(xEnd)}
                y2={y(yEnd)}
                stroke={inkA(0.11)}
                strokeWidth={1}
              />
              <text
                x={x(xEnd) + 4}
                y={y(yEnd) + 3}
                style={{ font: "500 9px var(--font-heading)", fill: dim(30) }}
              >
                μ {m.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Axes: one step off the surface, hairline, solid. */}
        <line x1={x(0)} y1={y(0)} x2={x(xMax)} y2={y(0)} stroke={inkA(0.16)} strokeWidth={1} />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(yMax)} stroke={inkA(0.16)} strokeWidth={1} />

        {[0.5, 1.0, 1.5, 2.0, 2.5].filter((v) => v <= xMax).map((v) => (
          <text
            key={`xt${v}`}
            x={x(v)}
            y={VBH - PAD.bottom + 15}
            textAnchor="middle"
            className="num"
            style={{ font: "10px var(--font-heading)", fill: dim(38) }}
          >
            {v.toFixed(1)}
          </text>
        ))}
        {[0.5, 1.0, 1.5, 2.0, 2.5].filter((v) => v <= yMax).map((v) => (
          <text
            key={`yt${v}`}
            x={x(0) - 8}
            y={y(v) + 3}
            textAnchor="end"
            className="num"
            style={{ font: "10px var(--font-heading)", fill: dim(38) }}
          >
            {v.toFixed(1)}
          </text>
        ))}

        <text
          x={(x(0) + x(xMax)) / 2}
          y={VBH - 6}
          textAnchor="middle"
          style={{ font: "500 10px var(--font-heading)", fill: dim(42) }}
        >
          vertical load pressing the tires down (g)
        </text>
        <text
          x={-(y(0) + y(yMax)) / 2}
          y={13}
          transform="rotate(-90)"
          textAnchor="middle"
          style={{ font: "500 10px var(--font-heading)", fill: dim(42) }}
        >
          horizontal force produced (g)
        </text>

        {/* The measured curve: 2px, round join. */}
        <path
          d={path}
          fill="none"
          stroke={CH.a}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ animation: "drawIn .7s ease both" }}
        />

        {bins.map((b, i) => {
          const sparse = b.ticks < SPARSE_TICKS;
          const on = hover === i;
          return (
            <g key={b.load_g}>
              {/* Hit target well beyond the 8px mark — a pinpoint dot is an
                  anti-pattern, and these sit close together at the dense end. */}
              <circle
                cx={x(b.load_g)}
                cy={y(b.peak_horizontal_g)}
                r={14}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setHover(i)}
              />
              <circle
                cx={x(b.load_g)}
                cy={y(b.peak_horizontal_g)}
                r={on ? 6 : 4.5}
                fill={sparse ? "var(--color-surface)" : CH.a}
                stroke={CH.a}
                strokeWidth={sparse ? 1.6 : 0}
                // 2px surface ring so dots stay legible where they crowd.
                paintOrder="stroke"
              />
              {!sparse && (
                <circle
                  cx={x(b.load_g)}
                  cy={y(b.peak_horizontal_g)}
                  r={on ? 6 : 4.5}
                  fill="none"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  opacity={0.55}
                />
              )}
            </g>
          );
        })}

        {/* Selective direct labels: the two ends the finding is about. */}
        {[first, last].map((b, i) => (
          <text
            key={`lbl${i}`}
            /* Both labels sit BELOW their mark. Above-right put the right-hand
               one straight through the hollow sparse dots that continue past
               the solid line, and a label crossing a mark is unreadable
               whichever of the two the reader was trying to see. Under the
               curve is empty on both ends. */
            x={x(b.load_g) + (i === 0 ? -9 : 9)}
            y={y(b.peak_horizontal_g) + 17}
            textAnchor={i === 0 ? "end" : "start"}
            className="num"
            style={{ font: "500 10px var(--font-heading)", fill: dim(62) }}
          >
            μ {(b.peak_horizontal_g / b.load_g).toFixed(2)}
          </text>
        ))}

        {active && (
          <Tooltip
            bin={active}
            cx={x(active.load_g)}
            cy={y(active.peak_horizontal_g)}
            sparse={active.ticks < SPARSE_TICKS}
          />
        )}
      </svg>

      <p style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.55, color: dim(40) }}>
        Hollow points hold fewer than {SPARSE_TICKS} ticks — measured, but thin
        enough to weigh lightly, so the line joins only the rest. The faint rays
        are lines of constant ratio; a tire that did not care about load would
        track along one.
      </p>

      <div style={{ marginTop: "var(--space-3)" }}>
        <Eyebrow size={9.5}>what the shape says</Eyebrow>
        <p style={{ margin: "5px 0 0", fontSize: 12, lineHeight: 1.6, color: dim(66) }}>
          {curve.load_sensitivity_note}
        </p>
        {curve.mu_per_g_of_load != null && (
          <p style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.55, color: dim(44) }}>
            Fitted across every bin and weighted by how many ticks each holds, so the
            thin bins at the ends cannot set the direction on their own:{" "}
            <span className="num">{curve.mu_per_g_of_load.toFixed(2)}</span> of ratio
            per g of load.
          </p>
        )}
      </div>

      {/* Tooltips enhance, never gate: every plotted value is also here. */}
      <button
        type="button"
        onClick={() => setShowValues((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          marginTop: "var(--space-3)",
          font: "500 9.5px var(--font-heading)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: dim(42),
        }}
        aria-expanded={showValues}
      >
        {showValues ? "hide values" : "show values"}
      </button>
      {showValues && (
        <table className="table" style={{ marginTop: 7 }}>
          <thead>
            <tr>
              <th>load (g)</th>
              <th style={{ textAlign: "right" }}>peak force (g)</th>
              <th style={{ textAlign: "right" }}>ratio</th>
              <th style={{ textAlign: "right" }}>ticks</th>
            </tr>
          </thead>
          <tbody>
            {(curve.bins ?? []).map((b) => (
              <tr key={b.load_g}>
                <td className="num">{b.load_g.toFixed(2)}</td>
                <td className="num" style={{ textAlign: "right" }}>
                  {b.measured && b.peak_horizontal_g != null ? b.peak_horizontal_g.toFixed(2) : "—"}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {b.measured && b.peak_mu != null ? b.peak_mu.toFixed(2) : "—"}
                </td>
                <td className="num" style={{ textAlign: "right", color: dim(45) }}>
                  {b.ticks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Tooltip({
  bin,
  cx,
  cy,
  sparse,
}: {
  bin: GripLoadBin & { peak_horizontal_g: number };
  cx: number;
  cy: number;
  sparse: boolean;
}) {
  const w = 168;
  const h = sparse ? 66 : 52;
  const left = cx > VBW - w - 20;
  const bx = left ? cx - w - 12 : cx + 12;
  const by = Math.min(Math.max(cy - h / 2, 4), VBH - h - 4);

  return (
    <g pointerEvents="none">
      <rect
        x={bx}
        y={by}
        width={w}
        height={h}
        rx={6}
        fill="var(--color-surface)"
        stroke={inkA(0.14)}
        strokeWidth={1}
      />
      <text x={bx + 10} y={by + 16} style={{ font: "500 10.5px var(--font-heading)", fill: dim(78) }}>
        {bin.load_g.toFixed(2)} g of load
      </text>
      <text x={bx + 10} y={by + 31} className="num" style={{ font: "10.5px var(--font-heading)", fill: dim(60) }}>
        {bin.peak_horizontal_g.toFixed(2)} g back · ratio {(bin.peak_horizontal_g / bin.load_g).toFixed(2)}
      </text>
      <text x={bx + 10} y={by + 45} className="num" style={{ font: "10px var(--font-heading)", fill: dim(40) }}>
        {bin.ticks} ticks
      </text>
      {sparse && (
        <text x={bx + 10} y={by + 58} style={{ font: "10px var(--font-heading)", fill: dim(40) }}>
          thin — weigh it lightly
        </text>
      )}
    </g>
  );
}
