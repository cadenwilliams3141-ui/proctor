"use client";

/* Corners. Every pass through one corner, and the evidence behind its action.
 *
 * The report says WHAT to do. This screen shows WHY it is believed: each pass
 * as a dot, time against the input the action is about, with the fastest
 * passes marked and the passes that were left out (off track, a tow, traffic)
 * drawn hollow and named. If the dots do not line up, there is no action, and
 * the screen says so rather than drawing one.
 *
 * Everything is the parser's own measurement (corner_laps, coach, watch); the
 * overlay uses the stored lap traces of two real passes — never a composite
 * drawn as if it had been driven. */

import { useEffect, useMemo, useState } from "react";

import ActionCard from "@/components/proctor/report/ActionCard";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim, inkA } from "@/lib/proctor/channels";
import { METRIC_LABEL, apexU, describeEvent } from "@/lib/proctor/coach";
import { cornerBundle, flagNames, segmentRange, typicalAndBest } from "@/lib/proctor/cornerView";
import { fixed } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import type { CoachCorner, CoachMetric, CornerRuns, PassMetric, SegmentCorner } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

const STATUS_TEXT: Record<CoachCorner["status"], string> = {
  action: "your fastest passes did something the others did not",
  unexplained: "your passes varied here, but no single input explained it",
  consistent: "your passes here were consistent — little time on the table",
  insufficient: "too few usable passes to compare",
};

/** Inputs worth plotting, and how to show them. Positional ones are drawn
 *  relative to the apex, which is how a driver thinks about them. */
const PLOTTABLE: { key: PassMetric; label: string; kind: "pos" | "speed" | "ratio" | "plain" }[] = [
  { key: "brake_on", label: "brake point", kind: "pos" },
  { key: "v_min", label: "slowest speed", kind: "speed" },
  { key: "full", label: "full throttle", kind: "pos" },
  { key: "pickup", label: "throttle pickup", kind: "pos" },
  { key: "turn_in", label: "turn-in", kind: "pos" },
  { key: "release", label: "brake release", kind: "pos" },
  { key: "brake_peak", label: "peak brake", kind: "ratio" },
  { key: "coast", label: "coasting", kind: "plain" },
  { key: "v_exit", label: "exit speed", kind: "speed" },
];

function display(kind: string, v: number, apex: number): number {
  if (kind === "pos") return v - apex;
  if (kind === "speed") return v * 3.6;
  if (kind === "ratio") return v * 100;
  return v;
}
function unitOf(kind: string): string {
  return kind === "pos" ? "m from the apex (− before)" : kind === "speed" ? "km/h" : kind === "ratio" ? "%" : "m";
}

/** Robust line through points, for drawing only (median of pairwise slopes). */
function theilSen(xs: number[], ys: number[]): { m: number; b: number } | null {
  const sl: number[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) sl.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  if (sl.length === 0) return null;
  sl.sort((a, b) => a - b);
  const m = sl[Math.floor(sl.length / 2)];
  const bs = xs.map((x, i) => ys[i] - m * x).sort((a, b) => a - b);
  return { m, b: bs[Math.floor(bs.length / 2)] };
}

export default function CornerScreen() {
  const { bundle, state, dispatch } = useProctor();
  const seg = bundle?.segments ?? null;
  const coach = bundle?.coach ?? null;

  const fallbackId = useMemo(() => {
    if (!coach || coach.corners.length === 0) return seg?.corners[0]?.id ?? null;
    if (coach.actions.length) return coach.actions[0].corner;
    return [...coach.corners].sort((a, b) => (b.opportunity_s ?? 0) - (a.opportunity_s ?? 0))[0].id;
  }, [coach, seg]);

  if (!bundle) return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;

  if (!seg || seg.corners.length === 0) {
    const why = bundle.absences.find((a) => a.key === "segments" || a.key === "coach");
    return (
      <div style={{ padding: "var(--space-6)" }}>
        <Eyebrow color="var(--color-accent-300)">corners</Eyebrow>
        <p style={{ fontSize: 14, color: dim(70), maxWidth: 680 }}>
          {why?.reason ?? "This session has no corner model."}
        </p>
        <p style={{ fontSize: 12.5, color: dim(55), maxWidth: 680, lineHeight: 1.55 }}>
          Corners are found from your own complete laps — where your median lap slowed and turned — so a
          session needs at least one valid lap from line to line before there is anything to show per corner.
          The laps that are here are still on the Data screen.
        </p>
      </div>
    );
  }

  const id = seg.corners.some((c) => c.id === state.selCorner) ? (state.selCorner as number) : fallbackId;
  const cb = id == null ? null : cornerBundle(id, seg, bundle.cornerLaps, coach);

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <nav aria-label="Corners" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {seg.corners.map((c) => {
          const st = coach?.corners.find((x) => x.id === c.id)?.status;
          const on = c.id === id;
          return (
            <button
              key={c.id}
              type="button"
              className="pk"
              onClick={() => dispatch({ t: "corner", id: c.id })}
              aria-pressed={on}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                font: "500 13px var(--font-heading)",
                color: on ? "var(--color-accent-200)" : dim(70),
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: st === "action" ? CH.gain : st === "unexplained" ? CH.warn : dim(30),
                }}
              />
              {c.name}
            </button>
          );
        })}
      </nav>
      <Caveat>{seg.numbering}.</Caveat>
      {cb && <CornerBody key={cb.corner.id} cb={cb} lengthM={seg.length_m} />}
    </div>
  );
}

function CornerBody({ cb, lengthM }: { cb: NonNullable<ReturnType<typeof cornerBundle>>; lengthM: number }) {
  const { state } = useProctor();
  const deep = atLeast(state.tier, "deep");
  const { corner, runs, status, actions } = cb;
  const geom = [
    corner.dir,
    corner.radius_m != null ? `${Math.round(corner.radius_m)} m radius` : null,
    corner.complex ? `complex, ${corner.sub_apexes.length} parts` : null,
    corner.kind === "lift" ? "a lift, no braking" : corner.kind === "flat" ? "flat out" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const excluded = Object.entries(status?.excluded ?? {});

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>{corner.name}</h1>
        <span style={{ fontSize: 12, color: dim(50) }}>{geom}</span>
        <span style={{ flex: 1 }} />
        {status && (
          <span style={{ fontSize: 12, color: dim(60) }}>
            {status.n} usable passes
            {excluded.length > 0 && ` · left out: ${excluded.map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")}`}
          </span>
        )}
      </header>
      {status && (
        <p style={{ margin: "var(--space-2) 0 0", fontSize: 13.5, color: dim(72) }}>
          {STATUS_TEXT[status.status]}
          {status.opportunity_s != null && status.status !== "insufficient"
            ? ` — about ${status.opportunity_s.toFixed(2)} s a lap between a typical pass and your fastest ones here.`
            : "."}
          {status.reason && status.status !== "action" ? ` ${status.reason}.` : ""}
        </p>
      )}

      {actions.length > 0 && (
        <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {actions.map((a) => (
            <ActionCard key={a.metric} action={a} showMap={false} showOpen={false} />
          ))}
        </div>
      )}
      {status?.differences && status.differences.length > 0 && (
        <div style={{ marginTop: "var(--space-3)", fontSize: 12.5, color: dim(65) }}>
          Where your fastest passes differed most — not enough passes, or not consistent enough, to say any of it
          made the difference:
          <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
            {status.differences.map((d) => (
              <li key={d.metric}>
                {METRIC_LABEL[d.metric as CoachMetric]}: typical {fixed(d.typical, d.unit === "m/s" ? 2 : 0)} {d.unit},
                fastest {fixed(d.fastest, d.unit === "m/s" ? 2 : 0)} {d.unit}
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))",
            gap: "var(--space-4)",
            marginTop: "var(--space-6)",
          }}
        >
          <EvidencePlot corner={corner} runs={runs} lengthM={lengthM} lead={actions[0]?.metric} />
          <StripPlot runs={runs} status={status} />
          <PhaseBars runs={runs} status={status} />
          <Overlay corner={corner} runs={runs} lengthM={lengthM} shortLaps={actions[0]?.short_laps} />
        </div>
      ) : (
        <p style={{ marginTop: "var(--space-6)", fontSize: 13, color: dim(60) }}>
          No complete pass through this corner was measured.
        </p>
      )}
      {runs && deep && <PassTable corner={corner} runs={runs} lengthM={lengthM} />}
    </div>
  );
}

const W = 520;
const H = 230;
const M = { l: 48, r: 12, t: 14, b: 34 };

function scale(lo: number, hi: number, a: number, b: number) {
  const span = hi - lo || 1;
  return (v: number) => a + ((v - lo) / span) * (b - a);
}
function extent(xs: number[], pad = 0.08): [number, number] {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const p = (hi - lo || Math.abs(hi) || 1) * pad;
  return [lo - p, hi + p];
}

function EvidencePlot({
  corner,
  runs,
  lengthM,
  lead,
}: {
  corner: SegmentCorner;
  runs: CornerRuns;
  lengthM: number;
  lead?: CoachMetric;
}) {
  const options = PLOTTABLE.filter((p) => (runs.runs.m[p.key] ?? []).filter((v) => v != null).length >= 3);
  const [pick, setPick] = useState<PassMetric>(
    options.find((o) => o.key === lead)?.key ?? options[0]?.key ?? "brake_on",
  );
  const { bundle } = useProctor();
  const status = bundle?.coach?.corners.find((c) => c.id === corner.id);
  const targets = new Set(status?.target_laps ?? []);
  const opt = options.find((o) => o.key === pick) ?? options[0];
  if (!opt) {
    return (
      <Panel title="The evidence">
        <p style={{ fontSize: 12, color: dim(55) }}>No input was measured on enough passes to plot.</p>
      </Panel>
    );
  }
  const apex = apexU(corner, lengthM);
  const pts = runs.runs.lap
    .map((lap, i) => {
      const raw = runs.runs.m[opt.key]?.[i];
      return raw == null
        ? null
        : {
            lap,
            x: display(opt.kind, raw, apex),
            y: runs.runs.time_s[i],
            ok: runs.runs.usable[i],
            why: flagNames(bundle?.cornerLaps?.flag_bits ?? {}, runs.runs.flags[i]),
          };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);
  const [x0, x1] = extent(pts.map((p) => p.x));
  const [y0, y1] = extent(pts.map((p) => p.y));
  const X = scale(x0, x1, M.l, W - M.r);
  const Y = scale(y0, y1, H - M.b, M.t);
  const ok = pts.filter((p) => p.ok);
  const line = ok.length >= 4 ? theilSen(ok.map((p) => p.x), ok.map((p) => p.y)) : null;

  return (
    <Panel
      title="The evidence"
      sub="one dot per pass: this input against the time for the corner and its straight"
      foot={
        <Caveat>
          Filled dots are the passes the coach compared; the accent ones are your fastest. Hollow dots were left out —
          hover one to see why. The dashed line is a robust trend through the filled dots, drawn for reading, not the
          coach&apos;s own (detrended) calculation.
        </Caveat>
      }
    >
      <div className="seg" style={{ alignSelf: "flex-start", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="seg-opt"
            data-active={o.key === opt.key}
            onClick={() => setPick(o.key)}
            aria-pressed={o.key === opt.key}
            style={{ fontSize: 11 }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label={`${opt.label} against corner time, one dot per pass`}>
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke={INK.neutral800} />
        <line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} stroke={INK.neutral800} />
        {[y0, (y0 + y1) / 2, y1].map((v) => (
          <text key={v} x={M.l - 6} y={Y(v) + 3} textAnchor="end" fontSize={9.5} fill={INK.neutral500} className="num">
            {v.toFixed(2)}
          </text>
        ))}
        {[x0, (x0 + x1) / 2, x1].map((v) => (
          <text key={v} x={X(v)} y={H - M.b + 14} textAnchor="middle" fontSize={9.5} fill={INK.neutral500} className="num">
            {v.toFixed(opt.kind === "speed" || opt.kind === "ratio" ? 1 : 0)}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill={INK.neutral500}>
          {opt.label}, {unitOf(opt.kind)}
        </text>
        <text x={12} y={(M.t + H - M.b) / 2} fontSize={10} fill={INK.neutral500}
          transform={`rotate(-90 12 ${(M.t + H - M.b) / 2})`} textAnchor="middle">
          corner time, s
        </text>
        {line && (
          <line x1={X(x0)} x2={X(x1)} y1={Y(line.m * x0 + line.b)} y2={Y(line.m * x1 + line.b)}
            stroke={INK.neutral500} strokeDasharray="4 4" strokeWidth={1.2} />
        )}
        {pts.map((p) => (
          <circle key={p.lap} cx={X(p.x)} cy={Y(p.y)} r={targets.has(p.lap) ? 5 : 4}
            fill={p.ok ? (targets.has(p.lap) ? CH.a : inkA(55)) : "none"}
            stroke={p.ok ? "none" : CH.warn} strokeWidth={1.4}>
            <title>{`lap ${p.lap}: ${p.x.toFixed(1)} · ${p.y.toFixed(3)} s${p.ok ? "" : ` · left out: ${p.why.join(", ")}`}`}</title>
          </circle>
        ))}
      </svg>
    </Panel>
  );
}

function StripPlot({ runs, status }: { runs: CornerRuns; status: CoachCorner | null }) {
  const pts = runs.runs.lap.map((lap, i) => ({ lap, t: runs.runs.time_s[i], ok: runs.runs.usable[i] }));
  const targets = new Set(status?.target_laps ?? []);
  const [y0, y1] = extent(pts.map((p) => p.t));
  const X = scale(0, Math.max(1, pts.length - 1), M.l, W - M.r);
  const Y = scale(y0, y1, H - M.b, M.t);
  const med = status?.median_s;
  const tgt = status?.target_s;
  return (
    <Panel title="Every pass, in order" sub="corner time lap by lap — drift over the run shows here"
      foot={<Caveat>Lines: your typical pass (median) and the median of your fastest passes. Hollow dots were left out.</Caveat>}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label="corner time for every pass in lap order">
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke={INK.neutral800} />
        {med != null && <line x1={M.l} x2={W - M.r} y1={Y(med)} y2={Y(med)} stroke={INK.neutral500} strokeDasharray="3 3" />}
        {tgt != null && <line x1={M.l} x2={W - M.r} y1={Y(tgt)} y2={Y(tgt)} stroke={CH.a} strokeDasharray="3 3" />}
        {[y0, y1].map((v) => (
          <text key={v} x={M.l - 6} y={Y(v) + 3} textAnchor="end" fontSize={9.5} fill={INK.neutral500} className="num">
            {v.toFixed(2)}
          </text>
        ))}
        {pts.map((p, i) => (
          <g key={p.lap}>
            <circle cx={X(i)} cy={Y(p.t)} r={4} fill={p.ok ? (targets.has(p.lap) ? CH.a : inkA(55)) : "none"}
              stroke={p.ok ? "none" : CH.warn} strokeWidth={1.4}>
              <title>{`lap ${p.lap}: ${p.t.toFixed(3)} s`}</title>
            </circle>
            {(pts.length <= 20 || i % 2 === 0) && (
              <text x={X(i)} y={H - M.b + 14} textAnchor="middle" fontSize={9} fill={INK.neutral500} className="num">
                {p.lap}
              </text>
            )}
          </g>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill={INK.neutral500}>lap</text>
      </svg>
    </Panel>
  );
}

function PhaseBars({ runs, status }: { runs: CornerRuns; status: CoachCorner | null }) {
  const gains = status?.phase_gain_s;
  const names = runs.phase_names;
  if (!gains || names.length === 0) {
    return (
      <Panel title="Where the time goes">
        <p style={{ fontSize: 12, color: dim(55) }}>Needs enough usable passes to compare phases.</p>
      </Panel>
    );
  }
  const vals = names.map((n) => gains[n] ?? 0);
  const max = Math.max(...vals.map(Math.abs), 0.001);
  return (
    <Panel title="Where the time goes" sub="how much quicker your fastest passes were, phase by phase"
      foot={<Caveat>Phases are cut at the same places for every pass — your typical brake point, turn-in, slowest point and full throttle — so they compare and add up.</Caveat>}>
      <div style={{ display: "grid", gap: 8, marginTop: "var(--space-2)" }}>
        {names.map((n, i) => {
          const v = vals[i];
          return (
            <div key={n} style={{ display: "grid", gridTemplateColumns: "80px 1fr 64px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: dim(65) }}>{n}</span>
              <span style={{ position: "relative", height: 10, background: "var(--color-neutral-800)", borderRadius: 5 }}>
                <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: dim(30) }} />
                <span style={{
                  position: "absolute", top: 0, bottom: 0, borderRadius: 5,
                  left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / max) * 50}%`,
                  width: `${(Math.abs(v) / max) * 50}%`,
                  background: v >= 0 ? CH.gain : CH.loss,
                }} />
              </span>
              <span className="num" style={{ fontSize: 12, textAlign: "right", color: v >= 0 ? CH.gain : CH.loss }}>
                {v >= 0 ? "−" : "+"}
                {Math.abs(v).toFixed(3)} s
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Overlay({
  corner,
  runs,
  lengthM,
  shortLaps,
}: {
  corner: SegmentCorner;
  runs: CornerRuns;
  lengthM: number;
  shortLaps?: number[];
}) {
  const { bundle, ensureTraces, pendingLaps } = useProctor();
  const { typical, best, fromShort } = typicalAndBest(runs, shortLaps);
  const who = fromShort ? "a pass that fell short" : "your typical pass";
  // Both passes, and the laps after them for a segment that runs over the line.
  useEffect(() => {
    if (typical == null || best == null) return;
    ensureTraces(corner.wraps ? [typical, best, typical + 1, best + 1] : [typical, best]);
  }, [ensureTraces, typical, best, corner.wraps]);
  if (!bundle || typical == null || best == null || typical === best) {
    return (
      <Panel title="Typical against fastest">
        <p style={{ fontSize: 12, color: dim(55) }}>Needs two different usable passes to overlay.</p>
      </Panel>
    );
  }
  const n = bundle.gridSize || bundle.map.x_m.length;
  const { from, to } = segmentRange(corner, lengthM, n);
  const series = (lap: number, key: "speed" | "brake" | "throttle") => {
    const out: number[] = [];
    for (let i = from; i <= to; i++) {
      const own = bundle.traces[lap];
      const tr = i >= n ? bundle.traces[lap + 1] ?? own : own;
      out.push(tr ? (tr[key][((i % n) + n) % n] ?? 0) : 0);
    }
    return out;
  };
  if (!bundle.traces[typical] || !bundle.traces[best]) {
    const waiting = pendingLaps.includes(typical) || pendingLaps.includes(best);
    return (
      <Panel title="Typical against fastest">
        <p style={{ fontSize: 12, color: dim(55) }}>
          {waiting ? "Loading these two passes…" : "No stored trace for one of these passes."}
        </p>
      </Panel>
    );
  }
  const vt = series(typical, "speed").map((v) => v * 3.6);
  const vb = series(best, "speed").map((v) => v * 3.6);
  const bt = series(typical, "brake");
  const bb = series(best, "brake");
  const tt = series(typical, "throttle");
  const tb = series(best, "throttle");
  const count = vt.length;
  const X = scale(0, count - 1, M.l, W - M.r);
  const [s0, s1] = extent([...vt, ...vb], 0.05);
  const SH = 150;
  const Ys = scale(s0, s1, SH, M.t);
  const path = (ys: number[], Y: (v: number) => number) =>
    ys.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const Yb = scale(0, 1, 188, 160);
  const Yt = scale(0, 1, 220, 192);
  const segLen = corner.seg_end_m - corner.seg_start_m;
  const marks = (["brake_on", "turn_in", "v_min_at", "full"] as const)
    .map((k) => ({ k, u: runs.landmarks[k] }))
    .filter((m): m is { k: typeof m.k; u: number } => m.u != null);
  const LABEL = { brake_on: "brake", turn_in: "turn in", v_min_at: "apex", full: "full" };

  return (
    <Panel title="Typical against fastest"
      sub={`lap ${typical} (${who}) against lap ${best} (your fastest), the whole segment`}
      foot={<Caveat>Two real passes from the stored lap traces (1000 points a lap), not a stitched composite. Speed on top, then brake, then throttle.</Caveat>}>
      <svg viewBox={`0 0 ${W} 232`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label="speed, brake and throttle of the typical and fastest pass">
        {marks.map((m) => {
          const x = X((m.u / segLen) * (count - 1));
          return (
            <g key={m.k}>
              <line x1={x} x2={x} y1={M.t} y2={222} stroke={INK.neutral800} strokeDasharray="2 3" />
              <text x={x + 3} y={M.t + 8} fontSize={9} fill={INK.neutral500}>{LABEL[m.k]}</text>
            </g>
          );
        })}
        <path d={path(vt, Ys)} fill="none" stroke={CH.b} strokeWidth={1.6} />
        <path d={path(vb, Ys)} fill="none" stroke={CH.a} strokeWidth={1.6} />
        <path d={path(bt, Yb)} fill="none" stroke={CH.b} strokeWidth={1.2} opacity={0.9} />
        <path d={path(bb, Yb)} fill="none" stroke={CH.a} strokeWidth={1.2} opacity={0.9} />
        <path d={path(tt, Yt)} fill="none" stroke={CH.b} strokeWidth={1.2} opacity={0.9} />
        <path d={path(tb, Yt)} fill="none" stroke={CH.a} strokeWidth={1.2} opacity={0.9} />
        {[s0, s1].map((v) => (
          <text key={v} x={M.l - 6} y={Ys(v) + 3} textAnchor="end" fontSize={9.5} fill={INK.neutral500} className="num">
            {Math.round(v)}
          </text>
        ))}
        <text x={M.l - 6} y={176} textAnchor="end" fontSize={9} fill={INK.neutral500}>brake</text>
        <text x={M.l - 6} y={208} textAnchor="end" fontSize={9} fill={INK.neutral500}>throttle</text>
      </svg>
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: dim(55) }}>
        <span><span style={{ color: CH.a }}>━</span> lap {best} · fastest</span>
        <span><span style={{ color: CH.b }}>━</span> lap {typical} · {fromShort ? "fell short" : "typical"}</span>
        <span>speed in km/h</span>
      </div>
    </Panel>
  );
}

function PassTable({ corner, runs, lengthM }: { corner: SegmentCorner; runs: CornerRuns; lengthM: number }) {
  const { bundle } = useProctor();
  const apex = apexU(corner, lengthM);
  const events = (bundle?.watch?.events ?? []).filter((e) => e.corner === corner.id);
  const status = bundle?.coach?.corners.find((c) => c.id === corner.id);
  const targets = new Set(status?.target_laps ?? []);
  const m = runs.runs.m;
  const rel = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v - apex)}`);
  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ fontSize: 13, margin: "0 0 var(--space-3)" }}>Pass by pass</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: dim(45), textAlign: "right" }}>
              {["lap", "time", "brake (m, − before apex)", "slowest (km/h)", "full throttle (m from apex)", "coast (m)", "what was watched"].map((h) => (
                <th key={h} style={{ fontWeight: 500, padding: "6px 8px", textAlign: h === "what was watched" ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.runs.lap.map((lap, i) => {
              const ok = runs.runs.usable[i];
              const why = flagNames(bundle?.cornerLaps?.flag_bits ?? {}, runs.runs.flags[i]);
              const ev = events.filter((e) => e.lap === lap).map(describeEvent);
              return (
                <tr key={lap} style={{ color: ok ? undefined : dim(45), borderTop: "1px solid var(--color-divider)" }}>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: targets.has(lap) ? CH.a : undefined }}>{lap}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{runs.runs.time_s[i].toFixed(3)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{rel(m.brake_on?.[i])}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{m.v_min?.[i] == null ? "—" : (m.v_min[i]! * 3.6).toFixed(1)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{rel(m.full?.[i])}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{m.coast?.[i] == null ? "—" : Math.round(m.coast[i]!)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "left", fontSize: 11.5 }}>
                    {[ok ? null : `left out: ${why.join(", ")}`, ...ev].filter(Boolean).join(" · ") || ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Caveat>Accent lap numbers are your fastest passes here. Greyed rows were left out of every comparison, with the reason.</Caveat>
    </section>
  );
}
