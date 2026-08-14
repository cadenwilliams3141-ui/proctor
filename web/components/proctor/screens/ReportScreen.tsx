"use client";

/* The session report.
 *
 * ┌ THE LAP CHART WAS BACKWARDS ────────────────────────────────────────────┐
 * │ The old chart plotted lap time upward, so a SLOWER lap was drawn        │
 * │ HIGHER. Every reader's instinct says higher is better, and here higher  │
 * │ meant worse — which is most of why it read as confusing. It also mixed  │
 * │ two grammars in one picture: a stem down to a baseline (a bar chart's   │
 * │ idea) with a line joining the tops (a trend's idea), so neither could   │
 * │ be read cleanly.                                                        │
 * │                                                                         │
 * │ It is now one grammar and one direction: bars measuring how far behind  │
 * │ your own best clean lap each lap was, hanging DOWN from a zero line at  │
 * │ the top. Your best lap is the line itself. A short bar is a good lap.   │
 * │ Excluded laps still appear — a lap that vanishes is a lap you cannot    │
 * │ reason about — with their own colour and their own reason on hover.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Two other rules this screen keeps: every lap appears, including the ones the
 * analysis excludes; and a module that could not run says WHY, as a finding,
 * rather than rendering an empty card. */

import { useMemo, useState } from "react";
import { Ban, Fuel, Gauge, ShieldCheck, Thermometer, TrendingDown, Waves } from "lucide-react";

import Absences from "@/components/proctor/ui/Absences";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain, { Lede } from "@/components/proctor/ui/Explain";
import Panel from "@/components/proctor/ui/Panel";
import { excludedReason } from "@/components/proctor/shell/LapRail";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { explainInputResponse, explainSession, explainStint } from "@/lib/proctor/explain";
import { fixed, fmtDay, fmtLap } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { isUsable, type Lap, type StintSeries } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

/* Absences this screen states in its own words, where the reader went looking
   for the number. The summary block at the bottom skips them so that one
   missing measurement is reported once rather than twice.
 *
 * Tier-dependent on purpose: a card that a lower detail level does not render
 * is not voicing anything, so its absence has to fall back through to the
 * summary block. Absences are never tier-gated — hiding a negative result at a
 * lower detail level would leave a gap the reader has to notice themselves. */
function voicedHere(deep: boolean): ReadonlySet<string> {
  const keys = [
    "stint", // → StintSection (always) and the "Fuel used" card
    "input_response", // → ResponseSection (always)
    "grip", // → the "Grip you demonstrated" card (always)
  ];
  // The tire card is deep-only.
  if (deep) keys.push("tire_temp_curve", "tire_temps");
  return new Set(keys);
}

export default function ReportScreen() {
  const { bundle, state } = useProctor();

  const stats = useMemo(() => {
    if (!bundle) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    if (times.length === 0) return { clean, times, mean: 0, sd: 0, best: null as number | null };
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / times.length);
    return { clean, times, mean, sd, best: Math.min(...times) };
  }, [bundle]);

  if (!bundle || !stats) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const { session } = bundle;
  const deep = atLeast(state.tier, "deep");

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "var(--space-6)",
          flexWrap: "wrap",
          rowGap: "var(--space-4)",
        }}
      >
        <div style={{ minWidth: 260 }}>
          <Eyebrow color="var(--color-accent-300)">session report</Eyebrow>
          <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>{session.track_name ?? "Unknown track"}</h1>
          <div
            style={{
              fontSize: 12,
              color: dim(48),
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>
              {[session.car_name, session.session_type, fmtDay(session.recorded_at), `${session.lap_count} ${session.lap_count === 1 ? "lap" : "laps"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {session.wear_masked && <span className="tag-warn">wear masked</span>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
          {[
            { l: "best clean lap", v: stats.best == null ? "—" : fmtLap(stats.best), c: CH.a },
            { l: "clean laps", v: `${stats.clean.length} of ${bundle.laps.length}` },
            { l: "your spread", v: stats.times.length ? `${stats.sd.toFixed(3)} s` : "—" },
            { l: "corners", v: String(bundle.corners.length) },
          ].map((s) => (
            <div key={s.l} style={{ textAlign: "right" }}>
              <Eyebrow size={9.5}>{s.l}</Eyebrow>
              <div
                className="num"
                style={{ font: "500 24px var(--font-heading)", color: s.c, marginTop: 2 }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>
      </header>

      <div style={{ marginTop: "var(--space-6)" }}>
        <Lede item={explainSession(bundle.laps, stats.clean)} />
      </div>

      <section style={{ marginTop: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
          <h2 style={{ fontSize: 13, margin: 0 }}>Every lap, against your own best</h2>
          <span style={{ fontSize: 11, color: dim(40) }}>
            bars hang down from your best clean lap — a short bar is a quick lap
          </span>
        </div>
        <LapChart best={stats.best} sd={stats.sd} />
      </section>

      {/* ── How the run changed ──────────────────────────────────────────── */}
      <StintSection />

      {/* ── Inputs against response ──────────────────────────────────────── */}
      <ResponseSection />

      {/* ── The measured cards ───────────────────────────────────────────── */}
      <section
        style={{
          marginTop: "var(--space-8)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: "var(--space-4)",
        }}
      >
        <MeasuredCards deep={deep} stats={stats} />
      </section>

      {/* ── What is not here ─────────────────────────────────────────────────
          One block, below the measurements, grouped by why. Absences that a
          section above already voiced in its own words are dropped: the reader
          met them where they went looking for the number, and repeating them
          here turned one missing thing into two. */}
      <section style={{ marginTop: "var(--space-8)" }}>
        <Absences absences={bundle.absences} exclude={voicedHere(deep)} />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The lap chart
// ─────────────────────────────────────────────────────────────────────────────

const VBW = 1180;
const VBH = 230;
const TOP = 26; // the zero line: your best clean lap
const BOTTOM = 186;
const LEFT = 46;
const RIGHT = 1168;

function LapChart({ best, sd }: { best: number | null; sd: number }) {
  const { bundle, state, dispatch } = useProctor();
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (!bundle || best == null) return null;
    const laps = bundle.laps;
    // The scale runs from 0 (your best) to the biggest gap any lap had, with a
    // little headroom. Excluded laps are drawn, so they count towards it: a
    // 40-second in-lap would otherwise squash every clean lap into one row, so
    // gaps past the cap are drawn clipped and labelled rather than rescaling
    // the whole chart around a lap nobody is comparing.
    const gaps = laps
      .map((l) => (l.lap_time_s == null ? null : l.lap_time_s - best))
      .filter((v): v is number => v != null);
    const cleanMax = Math.max(
      ...laps.filter(isUsable).map((l) => (l.lap_time_s as number) - best),
      sd * 2,
      0.35,
    );
    // Room for the excluded laps too, but never more than four times the clean
    // spread — beyond that they are clipped and marked.
    const cap = Math.min(Math.max(...gaps, cleanMax), cleanMax * 4);
    const slot = (RIGHT - LEFT) / Math.max(laps.length, 1);
    const barW = Math.max(2, Math.min(26, slot * 0.62));
    const X = (i: number) => LEFT + slot * (i + 0.5);
    const Y = (gap: number) => TOP + (Math.min(gap, cap) / Math.max(cap, 1e-6)) * (BOTTOM - TOP);

    // Thin the lap-number labels so they never collide: one every k laps, where
    // k is whatever keeps ~22px between them.
    const every = Math.max(1, Math.ceil(22 / Math.max(slot, 1)));

    // Ties happen. Only the first lap to set the time carries the label, or a
    // session of identical laps grows a row of identical numbers.
    const bestIndex = laps.findIndex(
      (l) => isUsable(l) && l.lap_time_s != null && l.lap_time_s - best <= 1e-9,
    );

    return { laps, cap, slot, barW, X, Y, every, bestIndex };
  }, [bundle, best, sd]);

  if (!bundle) return null;
  if (best == null || !chart) {
    return (
      <div style={{ fontSize: 12.5, color: dim(58), lineHeight: 1.6, maxWidth: 620 }}>
        No lap in this session was clean enough to measure the others against, so
        there is no baseline to draw. Every lap is still listed on the Analyze
        screen with the reason it was excluded.
      </div>
    );
  }

  const { laps, cap, X, Y, barW, every, bestIndex } = chart;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * cap);

  return (
    <>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: VBH, display: "block" }}
        role="img"
        aria-label="Each lap's gap to your best clean lap"
      >
        {/* One standard deviation of your clean laps, as a band under the zero
            line. Your own spread this session — never a benchmark. */}
        {sd > 0 && (
          <rect
            x={LEFT}
            y={Y(0)}
            width={RIGHT - LEFT}
            height={Math.max(1, Y(sd) - Y(0))}
            fill="color-mix(in srgb, #b5abfc 7%, transparent)"
          />
        )}

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={LEFT}
              y1={Y(t)}
              x2={RIGHT}
              y2={Y(t)}
              stroke={i === 0 ? inkA(0.3) : inkA(0.055)}
              strokeWidth={i === 0 ? 1.2 : 1}
            />
            <text x={LEFT - 8} y={Y(t) + 3.5} fill={inkA(i === 0 ? 0.5 : 0.3)} fontSize={9.5} textAnchor="end">
              {i === 0 ? "best" : `+${t.toFixed(2)}`}
            </text>
          </g>
        ))}

        {laps.map((lap, i) => {
          if (lap.lap_time_s == null) {
            // A lap with no recorded time has no bar. Marked, not skipped.
            return (
              <g key={lap.lap_number}>
                <title>{`Lap ${lap.lap_number} — no complete lap time was recorded`}</title>
                <text
                  x={X(i)}
                  y={Y(0) + 14}
                  fill={inkA(0.26)}
                  fontSize={10}
                  textAnchor="middle"
                >
                  ·
                </text>
                {i % every === 0 && <LapTick x={X(i)} n={lap.lap_number} dim />}
              </g>
            );
          }

          const gap = lap.lap_time_s - best;
          const usable = isUsable(lap);
          const isBest = usable && i === bestIndex;
          const clipped = gap > cap + 1e-9;
          const y = Y(gap);
          const on = hover === lap.lap_number;
          const selected = lap.lap_number === state.lapA || lap.lap_number === state.lapB;
          const fill = isBest ? CH.a : usable ? "rgba(181,171,252,.55)" : "rgba(224,183,106,.42)";
          const reason = excludedReason(lap);

          return (
            <g
              key={lap.lap_number}
              onPointerEnter={() => setHover(lap.lap_number)}
              onPointerLeave={() => setHover(null)}
              onClick={() =>
                bundle.traces[lap.lap_number] &&
                dispatch(
                  state.pick === "A"
                    ? { t: "lapA", lap: lap.lap_number }
                    : { t: "lapB", lap: lap.lap_number },
                )
              }
              style={{ cursor: bundle.traces[lap.lap_number] ? "pointer" : "default" }}
            >
              <title>
                {`Lap ${lap.lap_number} — ${fmtLap(lap.lap_time_s)}${
                  isBest ? " · your best clean lap" : ` · +${gap.toFixed(3)} s`
                }${reason ? ` · ${reason}` : ""}`}
              </title>
              {/* A generous invisible hit area: the bars can be 2px wide. */}
              <rect x={X(i) - chart.slot / 2} y={TOP - 8} width={chart.slot} height={BOTTOM - TOP + 22} fill="transparent" />
              <rect
                x={X(i) - barW / 2}
                y={Y(0)}
                width={barW}
                height={Math.max(1.5, y - Y(0))}
                rx={Math.min(2, barW / 3)}
                fill={fill}
                opacity={on || selected ? 1 : 0.9}
                stroke={selected ? INK.text : "none"}
                strokeWidth={selected ? 1 : 0}
              />
              {clipped && (
                /* Drawn to the floor with a break in it: the bar is shortened,
                   and the chart says so rather than quietly rescaling. */
                <g>
                  <line
                    x1={X(i) - barW / 2 - 2}
                    y1={BOTTOM - 4}
                    x2={X(i) + barW / 2 + 2}
                    y2={BOTTOM - 8}
                    stroke={INK.bg}
                    strokeWidth={3}
                  />
                  <line
                    x1={X(i) - barW / 2 - 2}
                    y1={BOTTOM + 1}
                    x2={X(i) + barW / 2 + 2}
                    y2={BOTTOM - 3}
                    stroke={INK.bg}
                    strokeWidth={3}
                  />
                </g>
              )}
              {isBest && (
                <text x={X(i)} y={TOP - 9} fill={CH.a} fontSize={10} fontWeight={500} textAnchor="middle">
                  {fmtLap(lap.lap_time_s)}
                </text>
              )}
              {(i % every === 0 || on || selected) && (
                <LapTick x={X(i)} n={lap.lap_number} dim={!usable} strong={on || selected} />
              )}
            </g>
          );
        })}

        <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} stroke={inkA(0.1)} />
      </svg>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginTop: 4 }}>
        <Key color={CH.a} label="your best clean lap" />
        <Key color="rgba(181,171,252,.55)" label="clean lap" />
        <Key color="rgba(224,183,106,.42)" label="out, in, partial or flagged — shown, never averaged in" />
        <Key color="color-mix(in srgb, #b5abfc 22%, transparent)" label="one standard deviation of your clean laps" />
      </div>

      <Caveat maxWidth={880} icon={false}>
        Every bar is how far behind your own fastest clean lap that lap was — no
        outside benchmark is involved. Click a bar to load that lap into the slot
        the Analyze rail is set to. Laps more than four times your clean spread
        behind are drawn clipped, with a break through the bar, so one slow in-lap
        cannot flatten the rest of the chart.
      </Caveat>
    </>
  );
}

function LapTick({ x, n, dim: isDim, strong }: { x: number; n: number; dim?: boolean; strong?: boolean }) {
  return (
    <text
      x={x}
      y={BOTTOM + 15}
      fill={inkA(strong ? 0.72 : isDim ? 0.24 : 0.42)}
      fontSize={9.5}
      fontWeight={strong ? 600 : 400}
      textAnchor="middle"
    >
      {n}
    </text>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: dim(45) }}>
      <span style={{ width: 10, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stint: how the run changed
// ─────────────────────────────────────────────────────────────────────────────

const TREND_ROWS: { key: string; label: string; good: "down" | "up" | "neither" }[] = [
  { key: "lap_time_s", label: "Lap time", good: "down" },
  { key: "decel_per_pedal_g", label: "Deceleration per unit of pedal", good: "up" },
  { key: "peak_braking_g", label: "Peak braking", good: "neither" },
  { key: "peak_lateral_g", label: "Peak lateral load", good: "neither" },
  { key: "lf_temp_middle_c", label: "Left-front middle surface", good: "neither" },
  { key: "lf_temp_spread_c", label: "Left-front edge spread", good: "neither" },
  { key: "abs_engaged_pct", label: "Braking with the ABS in", good: "neither" },
];

/* A section heading. Sections own their own heading now, so a section with
   nothing to show can render as one quiet line instead of a full-weight
   heading above an empty box — the empty box being the thing that made a
   session with plenty to say look broken. */
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 13, margin: "0 0 var(--space-3)" }}>{children}</h2>
  );
}

/** A section that has nothing to show: the heading, dimmed, and the reason on
 *  the same line. No panel — a panel drawn around nothing is exactly the blank
 *  box this screen had too many of. The sentence is still the module's own. */
function Unmeasured({ heading, reason }: { heading: string; reason: string }) {
  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 13, margin: 0, color: dim(52), fontWeight: 500 }}>{heading}</h2>
        <span
          style={{
            font: "500 9.5px var(--font-heading)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: dim(38),
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            boxShadow: `inset 0 0 0 1px ${dim(10)}`,
          }}
        >
          not measured
        </span>
      </div>
      <p
        style={{
          margin: "5px 0 0",
          fontSize: 11.5,
          lineHeight: 1.6,
          color: dim(44),
          maxWidth: 680,
          textWrap: "pretty",
        }}
      >
        {reason}
      </p>
    </section>
  );
}

const STINT_HEADING = "How the run changed, first lap to last";
const RESPONSE_HEADING = "What you asked for, and what the car did with it";

function StintSection() {
  const { bundle } = useProctor();
  const stint = bundle?.stint ?? null;

  if (!stint) {
    const absence = bundle?.absences.find((a) => a.key === "stint");
    return (
      <Unmeasured
        heading={STINT_HEADING}
        reason={
          absence?.reason ??
          "This session was ingested before the module that measures how a run changes existed. Re-ingest it from the rig and this section fills in — nothing about the file needs to change."
        }
      />
    );
  }

  const series = stint.trends.series ?? {};

  return (
    <section style={{ marginTop: "var(--space-8)" }}>
    <SectionHead>{STINT_HEADING}</SectionHead>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: "var(--space-4)" }}>
      <Panel
        title="What drifted"
        sub={
          stint.trends.measured
            ? `over ${stint.trends.clean_laps} clean laps`
            : "not enough clean laps to fit a trend"
        }
        padding="var(--space-4)"
        foot={<Caveat>{noteFor("stint.trend")}</Caveat>}
      >
        {stint.trends.measured ? (
          <table className="table">
            <thead>
              <tr>
                <th>measure</th>
                <th style={{ width: 78, textAlign: "right" }}>first third</th>
                <th style={{ width: 78, textAlign: "right" }}>last third</th>
                <th style={{ width: 86, textAlign: "right" }}>change</th>
              </tr>
            </thead>
            <tbody>
              {TREND_ROWS.map((row) => (
                <TrendRow key={row.key} row={row} s={series[row.key]} />
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6 }}>{stint.trends.reason}</div>
        )}
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
        <Panel
          title="In plain English"
          padding="var(--space-4)"
          right={<TrendingDown size={14} strokeWidth={1.7} color={dim(40)} />}
        >
          <Explain items={explainStint(stint)} max={5} />
        </Panel>

        {stint.fuel.measured && (
          <Panel padding="var(--space-4)" style={{ flex: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Fuel size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>Fuel</span>
            </div>
            <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
              <Figure label="used this session" value={fixed(stint.fuel.total_used_l, 1)} unit="L" />
              <Figure label="a lap, on average" value={fixed(stint.fuel.mean_per_lap_l, 2)} unit="L" />
              <Figure label="most in one lap" value={fixed(stint.fuel.max_per_lap_l, 2)} unit="L" />
            </div>
            <Caveat>{stint.fuel.refuel_note ?? stint.fuel.note}</Caveat>
          </Panel>
        )}
      </div>
    </div>
    </section>
  );
}

function TrendRow({
  row,
  s,
}: {
  row: { key: string; label: string; good: "down" | "up" | "neither" };
  s: StintSeries | undefined;
}) {
  if (!s?.measured || s.change == null) {
    return (
      <tr>
        <td style={{ color: dim(48) }}>{row.label}</td>
        <td colSpan={3} style={{ color: dim(40), fontSize: 11 }}>
          {s?.reason ?? "not carried by this session"}
        </td>
      </tr>
    );
  }

  /* Colour follows meaning, not sign. Lap time falling is a gain; deceleration
     per unit of pedal falling is a loss; a temperature moving is neither, and
     is left uncoloured rather than being given an implied verdict. */
  const sense =
    row.good === "neither"
      ? "none"
      : (row.good === "down" && s.change < 0) || (row.good === "up" && s.change > 0)
        ? "gain"
        : "loss";
  const color = sense === "gain" ? CH.gain : sense === "loss" ? CH.loss : dim(70);
  const flat = Math.abs(s.change) < (s.unit === "s" ? 0.02 : 0.01);

  return (
    <tr>
      <td>
        {row.label}
        {s.unit && <span style={{ color: dim(35), marginLeft: 5, fontSize: 10.5 }}>{s.unit}</span>}
      </td>
      <td className="num" style={{ textAlign: "right", color: dim(58) }}>{fixed(s.first_third, 2)}</td>
      <td className="num" style={{ textAlign: "right", color: dim(58) }}>{fixed(s.last_third, 2)}</td>
      <td className="num" style={{ textAlign: "right", color: flat ? dim(40) : color }}>
        {flat ? "level" : `${s.change > 0 ? "+" : ""}${s.change.toFixed(2)}`}
      </td>
    </tr>
  );
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <Eyebrow size={9}>{label}</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
        <span className="num" style={{ font: "500 18px var(--font-heading)" }}>{value}</span>
        {unit && <span style={{ fontSize: 10, color: dim(38) }}>{unit}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs against response
// ─────────────────────────────────────────────────────────────────────────────

function ResponseSection() {
  const { bundle } = useProctor();
  const ir = bundle?.inputResponse ?? null;

  if (!ir) {
    const absence = bundle?.absences.find((a) => a.key === "input_response");
    return (
      <Unmeasured
        heading={RESPONSE_HEADING}
        reason={
          absence?.reason ??
          "This session was ingested before the module that compares your inputs against the car's response existed. Re-ingest it from the rig and this section fills in."
        }
      />
    );
  }

  const brake = ir.brake;
  const throttle = ir.throttle;

  return (
    <section style={{ marginTop: "var(--space-8)" }}>
    <SectionHead>{RESPONSE_HEADING}</SectionHead>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: "var(--space-4)" }}>
      <Panel
        title="The gap between your controls and the car"
        padding="var(--space-4)"
        foot={<Caveat>{noteFor("input.response")}</Caveat>}
      >
        {brake.measured ? (
          <>
            <PairBar
              label="Brake"
              askedLabel="pedal, at its hardest"
              asked={brake.pedal_ceiling_pct}
              gotLabel="pressure the car used"
              got={brake.applied_ceiling_pct}
            />
            {brake.abs && (
              <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
                <Figure
                  label="braking with the ABS in"
                  value={fixed(brake.abs.engaged_pct_of_braking, 1)}
                  unit="%"
                />
                {brake.abs.mean_cut_while_engaged_pct != null && (
                  <Figure
                    label="pressure it removed"
                    value={fixed(brake.abs.mean_cut_while_engaged_pct, 1)}
                    unit="%"
                  />
                )}
                {brake.decel_per_pedal_g != null && (
                  <Figure
                    label="deceleration per unit of pedal"
                    value={fixed(brake.decel_per_pedal_g, 2)}
                    unit="g"
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: dim(55) }}>{brake.reason}</div>
        )}

        <div className="rule" style={{ "--fade": "20px", margin: "var(--space-4) 0" } as React.CSSProperties} />

        {throttle.measured && throttle.slip ? (
          <>
            <PairBar
              label="Throttle"
              askedLabel="asked for, on average"
              asked={throttle.mean_throttle_pct}
              gotLabel="put down without a wheel running away"
              got={Math.max(0, 100 - throttle.slip.share_of_on_power_pct)}
            />
            <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
              <Figure
                label="time on power with a wheel spinning"
                value={fixed(throttle.slip.share_of_on_power_pct, 1)}
                unit="%"
              />
              <Figure
                label="worst a wheel ran ahead of the ground"
                value={fixed(throttle.slip.peak_excess_pct, 0)}
                unit="%"
              />
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: dim(55) }}>
            {throttle.measured ? "No wheel-speed channels to compare the throttle against." : throttle.reason}
          </div>
        )}
      </Panel>

      <Panel title="In plain English" padding="var(--space-4)">
        <Explain items={explainInputResponse(ir)} max={5} />
      </Panel>
    </div>
    </section>
  );
}

/** Two bars on one scale: what was asked for, and what came back. */
function PairBar({
  label,
  askedLabel,
  asked,
  gotLabel,
  got,
}: {
  label: string;
  askedLabel: string;
  asked: number;
  gotLabel: string;
  got: number;
}) {
  return (
    <div>
      <div style={{ font: "500 12px var(--font-heading)", marginBottom: 7 }}>{label}</div>
      {[
        { l: askedLabel, v: asked, c: CH.b },
        { l: gotLabel, v: got, c: CH.a },
      ].map((row) => (
        <div key={row.l} style={{ marginBottom: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: dim(48) }}>
            <span>{row.l}</span>
            <span className="num">{row.v.toFixed(1)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: dim(8), overflow: "hidden", marginTop: 3 }}>
            <div
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, row.v))}%`,
                borderRadius: 4,
                background: row.c,
                transformOrigin: "left",
                animation: "growX .5s cubic-bezier(.2,.8,.2,1) both",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The measured cards
// ─────────────────────────────────────────────────────────────────────────────

function MeasuredCards({
  deep,
  stats,
}: {
  deep: boolean;
  stats: { times: number[]; sd: number; best: number | null; clean: Lap[] };
}) {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const hw = bundle.hardware;
  const grip = bundle.grip;
  const stint = bundle.stint;
  const flagged = bundle.laps.filter((l) => l.is_anomalous).length;
  const firstClean = stats.times[0];

  /* The module's own words for a card that has no number. The SHORT form: a
     card tile is a tight space, and the same forty-word sentence repeated
     across three tiles and two section notes is the clutter this screen was
     being cleaned of. The full reason stays one scroll away, in the summary
     block, which is what keeps the short form from becoming the only thing the
     reader is ever told. */
  const why = (key: string, fallback: string) =>
    bundle.absences.find((a) => a.key === key)?.short ?? fallback;

  /* Every value here comes off the bundle. This screen used to carry a brake
     ceiling of "93.4", a fuel figure of "31.4" and an anomalous-lap count of
     "1" as literals in its own source — numbers that survived a change of
     session and would have described the wrong run without ever looking wrong. */
  const cards: {
    title: string;
    Icon: typeof Gauge;
    value: string;
    unit: string;
    color?: string;
    body: string[];
    caveat: string;
    show: boolean;
    /* Set when there is no number. The card then renders as a compact tile
       carrying this sentence, instead of a full-size card built around an em
       dash with two paragraphs explaining a measurement that is not there. */
    unmeasured?: string;
  }[] = [
    {
      title: "Pace over the run",
      Icon: Waves,
      value:
        firstClean != null && stats.best != null ? (firstClean - stats.best).toFixed(3) : "—",
      unit: "s, first clean lap to best",
      color: CH.gain,
      body: [
        "Your first clean lap against your best clean lap of the same session.",
        "Read as a description of this run, not as a rate of improvement — a longer run would tell a different story.",
      ],
      caveat: "Compares your own laps within one session. Nothing outside it is used.",
      show: true,
      unmeasured:
        firstClean != null && stats.best != null
          ? undefined
          : "No lap in this session was clean enough to time, so there is no first-to-best gap to state.",
    },
    {
      title: "Consistency",
      Icon: Gauge,
      value: stats.times.length ? stats.sd.toFixed(3) : "—",
      unit: "s σ across clean laps",
      body: [
        "One standard deviation of your clean lap times.",
        "Flagged and partial laps take no part in this figure, and are not silently averaged in.",
      ],
      caveat:
        "A spread, not a grade. There is no target value here, because the right spread depends on the run you were doing.",
      show: true,
      /* One clean lap has a standard deviation of zero, which would read as
         perfect consistency. It is not a measurement of anything — a spread
         needs at least two laps to be a spread. */
      unmeasured:
        stats.times.length >= 2
          ? undefined
          : stats.times.length === 1
            ? "Only one clean lap in this session. A spread needs at least two."
            : "No clean laps in this session to take a spread across.",
    },
    {
      title: "Reference lap",
      Icon: ShieldCheck,
      value: fmtLap(stats.best),
      unit: "",
      color: CH.a,
      body: ["Your own fastest clean lap. Everything on the Analyze screen is measured against it."],
      caveat: noteFor("lap.reference"),
      show: true,
      unmeasured:
        stats.best != null
          ? undefined
          : "No lap was clean enough to serve as a reference, so nothing on Analyze has a baseline.",
    },
    {
      title: "Grip you demonstrated",
      Icon: Gauge,
      value: grip ? grip.session.peak_mu.toFixed(2) : "—",
      unit: "g of grip per g of load",
      color: CH.a,
      body: grip
        ? [
            `Peak ${grip.session.peak_combined_g.toFixed(2)} g combined, ${grip.session.peak_lateral_g.toFixed(2)} g lateral, ${grip.session.peak_braking_g.toFixed(2)} g braking.`,
            "Horizontal force over vertical load, both measured. It is the grip you used, not the grip the tires had.",
          ]
        : [],
      caveat: noteFor("grip.mu"),
      show: true,
      unmeasured: grip
        ? undefined
        : why("grip", "Not computed for this session."),
    },
    {
      title: "Brake ceiling",
      Icon: Gauge,
      value: hw?.brake_ceiling_pct != null ? hw.brake_ceiling_pct.toFixed(1) : "—",
      unit: "% of pedal travel",
      body: [
        "The hardest you pressed the brake while moving, across every application this session.",
        "Samples below 5 m/s are excluded: the sim forces brake to 1.0 when the car is stationary, which would otherwise read as a full-pressure application.",
      ],
      caveat: noteFor("brake.ceiling"),
      show: deep,
      unmeasured:
        hw?.brake_ceiling_pct != null
          ? undefined
          : hw
            ? (hw.brake_reason ?? "The brake channels carried nothing measurable while moving.")
            : why("hardware", "The hardware module produced nothing for this session."),
    },
    {
      title: "Left-front surface temp",
      Icon: Thermometer,
      value:
        bundle.tire.middle_c.length > 0
          ? `${Math.round(median(bundle.tire.middle_c))}`
          : "—",
      unit: "°C, middle band median",
      body: [
        "Left-front is the only tire-temperature channel in the file, split into inner, middle and outer bands.",
        "The full curve against track position is on the Map & delta view.",
      ],
      caveat: noteFor("tire.other_corners"),
      show: deep,
      /* An empty strip means either "the module ran but stored no across-lap
         curve" or "the module did not run at all", and those carry different
         absence keys. Whichever is present is the one that describes this
         session; only one of them can be. */
      unmeasured:
        bundle.tire.middle_c.length > 0
          ? undefined
          : (bundle.absences.find(
              (a) => a.key === "tire_temp_curve" || a.key === "tire_temps",
            )?.short ??
            "No across-lap tire-temperature curve is stored for this session."),
    },
    {
      title: "Fuel used",
      Icon: Fuel,
      value:
        stint?.fuel.measured && stint.fuel.total_used_l != null
          ? stint.fuel.total_used_l.toFixed(1)
          : "—",
      unit: "L over the session",
      body: ["Measured from the fuel-level channel between the first and last timed lap."],
      caveat:
        "Fuel level is a measured channel, so this is a reading rather than an estimate. It says nothing about what a race stint would need.",
      show: deep,
      /* Two different absences wear the same em dash here: the stint module
         never ran, or it ran and the fuel channel had nothing to say. Only the
         first has an absence entry, so the second uses the module's own note —
         reaching for `why("stint")` there would report a missing module that
         is in fact present. */
      unmeasured:
        stint?.fuel.measured && stint.fuel.total_used_l != null
          ? undefined
          : stint
            ? (stint.fuel.reason ??
              stint.fuel.note ??
              "The fuel-level channel carried nothing measurable across this session.")
            : why("stint", "Not computed for this session."),
    },
    {
      title: "Flagged laps",
      Icon: Ban,
      value: String(flagged),
      unit: "flagged, still shown",
      color: flagged > 0 ? CH.warn : undefined,
      body: [
        "Flagged laps stay visible everywhere in the app and stay out of every automatic comparison.",
        "You can still put one in a comparison deliberately from the lap rail — it says so when you do.",
      ],
      caveat:
        "Flagging is based on incident count and lap-time deviation from your own clean laps — not on any judgement about driving.",
      show: deep,
    },
  ];

  /* Cards that have a number keep their full weight. Cards that do not are
     demoted rather than dropped: the reader still learns the measurement
     exists and why it is not here, but it no longer takes the same room as a
     measurement that landed. Sorting them after the measured ones keeps the
     grid reading numbers-first. */
  const visible = cards.filter((c) => c.show);
  const measured = visible.filter((c) => !c.unmeasured);
  const missing = visible.filter((c) => c.unmeasured);

  return (
    <>
      {measured.map((c, i) => (
        <Panel
          key={c.title}
          padding="var(--space-4)"
          style={{ animation: "fadeUp .45s both", animationDelay: `${(i * 0.05).toFixed(2)}s` }}
          foot={<Caveat>{c.caveat}</Caveat>}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <c.Icon size={15} strokeWidth={1.7} color={CH.a} />
            <span style={{ font: "500 13px var(--font-heading)" }}>{c.title}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span className="num" style={{ font: "500 22px var(--font-heading)", color: c.color }}>
              {c.value}
            </span>
            <span style={{ fontSize: 11, color: dim(40) }}>{c.unit}</span>
          </div>
          {c.body.map((line) => (
            <p key={line} style={{ fontSize: 12, color: dim(72), margin: "6px 0 0", lineHeight: 1.5 }}>
              {line}
            </p>
          ))}
        </Panel>
      ))}

      {missing.map((c) => (
        <Panel key={c.title} padding="var(--space-4)" style={{ justifyContent: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <c.Icon size={14} strokeWidth={1.7} color={dim(38)} />
            <span style={{ font: "500 12.5px var(--font-heading)", color: dim(58) }}>{c.title}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: dim(34) }}>not measured</span>
          </div>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 11,
              lineHeight: 1.55,
              color: dim(44),
              textWrap: "pretty",
            }}
          >
            {c.unmeasured}
          </p>
        </Panel>
      ))}
    </>
  );
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
