"use client";

/* View 0 — "Corners". One corner at a time, the track first.
 *
 * Built to be read in seconds. The question a driver brings to a lap is "where
 * did it go, and what was different there" — so the screen leads with the
 * corner drawn to scale and the two lines through it, puts every corner's gap
 * in one row underneath, and keeps the words to one short fact per phase with
 * the number in bold. Everything else in the app is still one click away; this
 * is the screen the app now opens on.
 *
 * ┌ THE RULES IT KEEPS ─────────────────────────────────────────────────────┐
 * │ - The comparison is always the driver against THEMSELVES: this lap      │
 * │   against their own best clean lap (lap A), never anyone else's.        │
 * │ - Facts describe and never prescribe. "Braked 12 m later" is in the      │
 * │   file; "brake later" is not. See lib/proctor/phases.ts.                 │
 * │ - The road is the measured surface or it is not drawn as a road.        │
 * │ - No number on this screen is a literal in this file.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import NotDrawable from "@/components/proctor/ui/NotDrawable";
import { excludedReason } from "@/components/proctor/shell/LapRail";
import CornerMap from "@/components/proctor/views/CornerMap";
import CornerTrace from "@/components/proctor/views/CornerTrace";
import { CH, MATCHED_BAND_S, deltaSense, dim, type DeltaSense } from "@/lib/proctor/channels";
import { explainTrailCorner } from "@/lib/proctor/explain";
import { fmtCornerGeometry, fmtDelta, fmtLap } from "@/lib/proctor/format";
import { wrapIndex } from "@/lib/proctor/geometry";
import { deltaCurve } from "@/lib/proctor/ledger";
import { DEFAULT_RULES, readLap, type CornerReading, type Fact, type Phase, type PhaseRules } from "@/lib/proctor/phases";
import { useProctor } from "@/lib/proctor/store";
import type { Corner, SessionBundle } from "@/lib/proctor/types";
import { atLeast, type Tier } from "@/lib/tier";

/** Facts per phase at each detail level. Glance is one line a phase — the
 *  biggest thing — and the rest is a click on the detail switch away. */
const FACTS_AT: Record<Tier, number> = { glance: 1, deep: 2, everything: 99 };

export default function CornerReview() {
  const { bundle, state, dispatch, traceA, traceB, ledger, readiness, referenceLap, selectedCornerId } =
    useProctor();
  const [hoverPhase, setHoverPhase] = useState<Phase | null>(null);

  const n = traceA && traceB ? Math.min(traceA.speed.length, traceB.speed.length) : 0;
  const metresPerSample = useMemo(() => (bundle && n ? lapLengthM(bundle) / n : 0), [bundle, n]);

  const rules = useMemo<PhaseRules>(() => {
    const t = bundle?.trailBraking?.thresholds;
    return t
      ? {
          brakeOn: t.brake_on_pct / 100,
          brakeOff: t.brake_off_pct / 100,
          turnInFrac: t.turn_in_pct_of_peak_lat / 100,
          fullThrottle: DEFAULT_RULES.fullThrottle,
        }
      : DEFAULT_RULES;
  }, [bundle]);

  const isBest = state.lapA != null && state.lapA === referenceLap;
  const bestName = isBest ? "Your best" : `Lap ${state.lapA}`;
  const lapName = `Lap ${state.lapB}`;

  const readings = useMemo<CornerReading[]>(() => {
    if (!bundle || !ledger || !traceA || !traceB || !metresPerSample) return [];
    const tw = bundle.trackWidth;
    const tb = bundle.trackBoundary;
    // The line-at-apex fact needs the reference line's normals on the SAME grid
    // as the traces. Without that, it is left out rather than misaligned.
    const src =
      tw && tw.centre_x_m.length === n
        ? { x: tw.centre_x_m, y: tw.centre_y_m, normalX: tw.normal_x, normalY: tw.normal_y, origin: tw.origin }
        : tb && tb.centre_x_m.length === n
          ? { x: tb.centre_x_m, y: tb.centre_y_m, normalX: tb.normal_x, normalY: tb.normal_y, origin: tb.origin }
          : null;
    return readLap(ledger.corners, traceA, traceB, {
      metresPerSample,
      centre: src,
      rules,
      ref: isBest ? "your best" : `lap ${state.lapA}`,
    });
  }, [bundle, ledger, traceA, traceB, metresPerSample, n, rules, isBest, state.lapA]);

  const delta = useMemo(() => (traceA && traceB ? deltaCurve(traceA, traceB) : []), [traceA, traceB]);

  const reading = readings.find((r) => r.id === selectedCornerId) ?? readings[0] ?? null;
  const cd = ledger?.corners.find((c) => c.corner.id === reading?.id) ?? null;

  // The chosen lap's chip is scrolled into view when it changes, so on a long
  // run the lap being read is never off the end of the strip.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.cr-lapchip[data-on="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.lapB, readiness.state]);

  // ←/→ walks the corners in track order, the way a lap is driven.
  useEffect(() => {
    if (readings.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const k = readings.findIndex((r) => r.id === reading?.id);
      const next = readings[(k + (e.key === "ArrowRight" ? 1 : -1) + readings.length) % readings.length];
      dispatch({ t: "corner", id: next.id });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readings, reading?.id, dispatch]);

  if (readiness.state !== "ready" || !bundle || !ledger || !traceA || !traceB) {
    return <NotDrawable readiness={bundle ? readiness : { state: "loading" }} />;
  }

  if (!reading || !cd) {
    return (
      <div style={{ padding: "var(--space-8) var(--space-6)", maxWidth: 620 }}>
        <div style={{ font: "500 15px var(--font-heading)", marginBottom: 6 }}>No corners found on this lap.</div>
        <div style={{ fontSize: 12.5, color: dim(60), lineHeight: 1.6 }}>
          Corners are found where your best lap slowed down and sped up again. This one never did enough of
          that to call a corner, so there is nothing to step through.
        </div>
      </div>
    );
  }

  // The stretch drawn: the corner's window and a margin either side, so the
  // approach and the run out are both in frame.
  const pad = Math.max(8, Math.round(n * 0.012));
  const view = { from: cd.from - pad, to: cd.to + pad };
  const cursorIdx = cursorIn(state.cursor, n, view);
  const sense = deltaSense(reading.delta);
  const lapA = bundle.laps.find((l) => l.lap_number === state.lapA);
  const lapB = bundle.laps.find((l) => l.lap_number === state.lapB);
  const lapGap = ledger.lapDelta;

  const shown = FACTS_AT[state.tier];
  const hiddenFacts = reading.phases.reduce((s, ph) => s + Math.max(0, ph.facts.length - shown), 0);
  const pedals = atLeast(state.tier, "deep");

  const trail = bundle.trailBraking?.corners.find((c) => c.id === reading.id) ?? null;
  // Across every clean lap, not just this one: the headline at deep, all of it
  // at everything. It is the one place this view looks beyond the lap pair.
  const trailAll = trail ? explainTrailCorner(trail) : [];
  const trailLine = atLeast(state.tier, "everything")
    ? trailAll
    : atLeast(state.tier, "deep")
      ? trailAll.slice(0, 1)
      : [];
  const hiddenTrail = trailAll.length - trailLine.length;

  const rank = [...readings].sort((x, y) => y.delta - x.delta).findIndex((r) => r.id === reading.id) + 1;

  return (
    <div className="cr">
      {/* ── The lap being read, and what it is read against ─────────────── */}
      <div className="cr-head">
        <div className="cr-lapline">
          <span className="cr-eyebrow">Lap {state.lapB}</span>
          <span className="num" style={{ font: "600 20px var(--font-heading)" }}>
            {fmtLap(lapB?.lap_time_s)}
          </span>
          <span
            className="num"
            style={{ font: "600 20px var(--font-heading)", color: lapGap > 0 ? CH.loss : lapGap < 0 ? CH.gain : dim(70) }}
          >
            {fmtDelta(lapGap)}
          </span>
          <span style={{ fontSize: 12, color: dim(52), whiteSpace: "nowrap" }}>
            against {isBest ? "your best" : `lap ${state.lapA}`}, {fmtLap(lapA?.lap_time_s)}
            {!isBest && referenceLap != null && (
              <button
                type="button"
                className="pk cr-linkbtn"
                onClick={() => dispatch({ t: "lapA", lap: referenceLap })}
              >
                compare with your best
              </button>
            )}
          </span>
        </div>
        <div className="cr-laps scrollpane-x" role="listbox" aria-label="Lap to read">
          {bundle.laps
            .filter((l) => bundle.traces[l.lap_number])
            .map((l) => {
              const isA = l.lap_number === state.lapA;
              const isB = l.lap_number === state.lapB;
              const why = excludedReason(l);
              return (
                <button
                  key={l.lap_number}
                  type="button"
                  role="option"
                  aria-selected={isB}
                  className="pk cr-lapchip"
                  data-on={isB}
                  data-ref={isA}
                  data-out={why != null}
                  disabled={isA}
                  title={isA ? "The lap everything here is measured against" : why ? `Lap ${l.lap_number} is ${why}` : undefined}
                  onClick={() => dispatch({ t: "lapB", lap: l.lap_number })}
                >
                  <span className="cr-lapchip-n">{l.lap_number}</span>
                  <span className="num">{l.lap_time_s != null ? fmtLap(l.lap_time_s).replace(/^0:/, "") : "—"}</span>
                  {isA && <span className="cr-lapchip-tag">{isBest ? "best" : "vs"}</span>}
                </button>
              );
            })}
        </div>
      </div>

      {/* ── The corner card ─────────────────────────────────────────────── */}
      <aside className="cr-card scrollpane" aria-label={`Turn ${reading.id}`}>
        <div className="cr-card-top">
          <button
            type="button"
            className="pk cr-step"
            aria-label="Previous corner"
            onClick={() => dispatch({ t: "corner", id: step(readings, reading.id, -1) })}
          >
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cr-eyebrow">Turn</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ font: "600 30px/1 var(--font-heading)" }}>{reading.id}</span>
              <span className="num" style={{ font: "600 22px/1 var(--font-heading)", color: senseColor(sense) }}>
                {fmtDelta(reading.delta)} s
              </span>
            </div>
          </div>
          <button
            type="button"
            className="pk cr-step"
            aria-label="Next corner"
            onClick={() => dispatch({ t: "corner", id: step(readings, reading.id, 1) })}
          >
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="cr-card-sub">
          {fmtCornerGeometry(cd.corner.radius_m, cd.corner.dir)} ·{" "}
          {sense === "loss"
            ? `${ordinal(rank)} most time lost of ${readings.length}`
            : sense === "gain"
              ? `time gained here`
              : `matched within ${fmtMsBand()}`}
        </div>

        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {reading.phases.map((ph) => (
            <PhaseBlock
              key={ph.id}
              phase={ph}
              worst={reading.worst === ph.id}
              shown={shown}
              onHover={setHoverPhase}
            />
          ))}
        </div>

        {trailLine.length > 0 && (
          <div className="cr-across">
            <div className="cr-eyebrow" style={{ marginBottom: 4 }}>Across your clean laps</div>
            {trailLine.map((e, k) => (
              <div key={k} style={{ fontSize: 12, lineHeight: 1.5, color: dim(72), marginTop: k ? 4 : 0 }}>
                {e.headline}
              </div>
            ))}
          </div>
        )}

        {(hiddenFacts + hiddenTrail > 0 || !pedals) && (
          <div className="cr-hidden">
            {[
              hiddenFacts + hiddenTrail > 0
                ? `${hiddenFacts + hiddenTrail} more reading${hiddenFacts + hiddenTrail === 1 ? "" : "s"}`
                : null,
              !pedals ? "the pedal traces" : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            hidden at &ldquo;{state.tier}&rdquo; detail. The data is there; switch detail above to see it.
          </div>
        )}

        <div className="cr-foot">
          {cutNote(reading, isBest ? "your best" : `lap ${state.lapA}`)} Distances are good to{" "}
          {Math.round(metresPerSample)} m.
        </div>
      </aside>

      {/* ── The track ───────────────────────────────────────────────────── */}
      <section className="cr-map" aria-label="The corner, to scale">
        <CornerMap
          tb={bundle.trackBoundary}
          tw={bundle.trackWidth}
          circuit={bundle.map}
          best={traceA}
          lap={traceB}
          reading={reading}
          win={{ from: cd.from, to: cd.to }}
          view={view}
          cursor={cursorIdx}
          hoverPhase={hoverPhase}
          bestName={bestName}
          lapName={lapName}
          sense={sense}
        />
        <CornerChips readings={readings} selected={reading.id} corners={bundle.corners} />
      </section>

      {/* ── The telemetry under it ──────────────────────────────────────── */}
      <section className="cr-tel">
        <CornerTrace
          best={traceA}
          lap={traceB}
          delta={delta}
          reading={reading}
          view={view}
          cursor={cursorIdx}
          onCursor={(i) => dispatch({ t: "cursor", cursor: wrapIndex(i, n) / (n - 1) })}
          hoverPhase={hoverPhase}
          metresPerSample={metresPerSample}
          pedals={pedals}
          bestName={bestName}
          lapName={lapName}
        />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PhaseBlock({
  phase,
  worst,
  shown,
  onHover,
}: {
  phase: Phase;
  worst: boolean;
  shown: number;
  onHover: (p: Phase | null) => void;
}) {
  const sense = deltaSense(phase.delta);
  return (
    <div
      className="cr-phase"
      data-worst={worst}
      onPointerEnter={() => onHover(phase)}
      onPointerLeave={() => onHover(null)}
    >
      <div className="cr-phase-head">
        <span className="cr-phase-tag" data-sense={sense} data-worst={worst}>
          {phase.label}
        </span>
        <span className="num" style={{ font: "600 13px var(--font-heading)", color: senseColor(sense) }}>
          {sense === "matched" ? "matched" : `${fmtDelta(phase.delta)} s`}
        </span>
      </div>
      {phase.facts.slice(0, shown).map((f, k) => (
        <FactLine key={k} fact={f} />
      ))}
    </div>
  );
}

function FactLine({ fact }: { fact: Fact }) {
  return (
    <div className="cr-fact">
      {fact.map((s, k) =>
        s.strong ? (
          <strong key={k} style={{ fontWeight: 600, color: "var(--color-text)" }}>
            {s.text}
          </strong>
        ) : (
          <span key={k}>{s.text}</span>
        ),
      )}
    </div>
  );
}

function CornerChips({
  readings,
  selected,
  corners,
}: {
  readings: CornerReading[];
  selected: number;
  corners: Corner[];
}) {
  const { dispatch } = useProctor();
  return (
    <div className="cr-chips scrollpane-x" role="tablist" aria-label="Corners">
      {readings.map((r) => {
        const sense = deltaSense(r.delta);
        const on = r.id === selected;
        const c = corners.find((x) => x.id === r.id);
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={on}
            className="pk cr-chip"
            data-on={on}
            data-sense={sense}
            title={c ? fmtCornerGeometry(c.radius_m, c.dir) : undefined}
            onClick={() => dispatch({ t: "corner", id: r.id })}
          >
            <span>T{r.id}</span>
            <span className="num">{sense === "matched" ? "=" : fmtDelta(r.delta, 2)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Where the phase lines were drawn, in the words of what actually happened. */
function cutNote(r: CornerReading, ref: string): string {
  const Ref = ref.charAt(0).toUpperCase() + ref.slice(1);
  switch (r.fallback) {
    case null:
      return `Phases are cut where ${ref} turned in, was slowest, and was back to full throttle.`;
    case "no-turn-in":
      return `${Ref} has no clear turn-in here, so the corner is cut into equal quarters.`;
    case "no-throttle":
      return `${Ref} was not back to full throttle inside this corner, so it is cut into equal quarters.`;
    case "out-of-order":
      return `On ${ref} the turn-in, slowest point and throttle did not come in that order here, so the corner is cut into equal quarters.`;
  }
}

function senseColor(s: DeltaSense): string {
  return s === "loss" ? CH.loss : s === "gain" ? CH.gain : dim(62);
}

function step(readings: CornerReading[], id: number, by: 1 | -1): number {
  const k = readings.findIndex((r) => r.id === id);
  return readings[(k + by + readings.length) % readings.length].id;
}

function ordinal(k: number): string {
  const s = k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] ?? "th";
  return `${k}${s}`;
}

function fmtMsBand(): string {
  return `${Math.round(MATCHED_BAND_S * 1000)} ms`;
}

/** Metres round one lap: the track length iRacing states, else the length of
 *  the stored centreline. Both are about the circuit, not a guess. */
function lapLengthM(bundle: SessionBundle): number {
  const km = bundle.session.track_length_km;
  if (km != null && km > 0) return km * 1000;
  const { x_m, y_m } = bundle.map;
  let len = 0;
  for (let i = 1; i < x_m.length; i++) len += Math.hypot(x_m[i] - x_m[i - 1], y_m[i] - y_m[i - 1]);
  return len;
}

/** The store's cursor (0..1 round the lap) as an unwrapped index inside the
 *  drawn stretch, or null when it is somewhere else on the lap. */
function cursorIn(cursor: number, n: number, view: { from: number; to: number }): number | null {
  const k = Math.round(cursor * (n - 1));
  for (const u of [k - n, k, k + n]) if (u >= view.from && u <= view.to) return u;
  return null;
}
