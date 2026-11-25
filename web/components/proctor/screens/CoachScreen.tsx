"use client";

/* Coach — the session home. What to work on next, then each part of the
 * driving, then whether the rig was in the way.
 *
 * ┌ WHY THIS SCREEN LEADS ──────────────────────────────────────────────────┐
 * │ A driver after a session wants one thing to practise, not twenty panels │
 * │ of true statements. So the screen opens with ONE suggestion — the habit  │
 * │ that went with the most time across the most corners — and everything   │
 * │ else is one click deeper, by aspect.                                    │
 * │                                                                         │
 * │ The suggestion is aimed at what the driver's own quick passes did, and  │
 * │ quotes them. If the rig was what stood in the way, the one thing is the │
 * │ equipment fix instead, because a tip about a press the pedal cannot     │
 * │ report is not one the driver can act on. See lib/proctor/coach.ts.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Every number here comes off the coach report or the bundle. Nothing is
 * typed into this file; components/proctor/ui/Literals.test.ts checks. */

import { useMemo } from "react";
import { Disc3, RotateCw, Route, TrendingUp, Waves } from "lucide-react";

import Absences from "@/components/proctor/ui/Absences";
import { Evidence } from "@/components/proctor/ui/Answer";
import { Lede } from "@/components/proctor/ui/Explain";
import { LapChart, MeasuredCards, StintSection } from "@/components/proctor/panels/ReportPanels";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import FocusBanner from "@/components/proctor/panels/FocusBanner";
import TrackMap from "@/components/proctor/ui/TrackMap";
import {
  AspectTile,
  GearFix,
  SuggestionCard,
  VerdictChip,
} from "@/components/proctor/panels/CoachBits";
import { CH, dim } from "@/lib/proctor/channels";
import { ASPECT_LABEL, aspectHeadline, worthLine, type AspectKey, type Suggestion } from "@/lib/proctor/coach";
import { explainSession } from "@/lib/proctor/explain";
import { allGearChecks } from "@/lib/proctor/gearCheck";
import { isUsable } from "@/lib/proctor/types";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { atLeast, hiddenNote } from "@/lib/tier";

export const ASPECT_ICON: Record<AspectKey, typeof Disc3> = {
  braking: Disc3,
  turn_in: RotateCw,
  throttle: TrendingUp,
  line: Route,
  grip: Waves,
};

/* Absences this screen voices itself: the aspect timing, where the hero says
   why there is no one thing. Everything else falls to the block at the foot. */
const VOICED = new Set(["driving_aspects"]);

export default function CoachScreen() {
  const { bundle, coachReport: r, state, dispatch } = useProctor();

  if (!bundle || !r) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const da = bundle.drivingAspects;
  const s = bundle.session;
  const billedMax = Math.max(
    ...r.aspects.filter((a) => !a.linked).map((a) => a.atStakeS ?? 0),
    ...r.aspects.filter((a) => a.linked).map((a) => a.atStakeS ?? 0),
    1e-6,
  );
  const deep = atLeast(state.tier, "deep");
  const gear = allGearChecks({
    inputResponse: bundle.inputResponse,
    hardware: bundle.hardware,
    reportCard: bundle.reportCard,
  });
  // Glance hides the drift notes (when there are any) and the session context.
  const note = hiddenNote(state.tier, deep ? 0 : 1 + (r.suggestions.some((x) => x.key === "drift.improving") ? 1 : 0));

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      {/* ── The session, in one line ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px", marginBottom: "var(--space-4)" }}>
        <span style={{ font: "500 15px var(--font-heading)" }}>{s.track_name ?? "Unknown track"}</span>
        <span style={{ fontSize: 12, color: dim(55) }}>{s.car_name ?? "unknown car"}</span>
        <span style={{ fontSize: 12, color: dim(42) }}>
          {[s.session_type, fmtDay(s.recorded_at)].filter(Boolean).join(" · ")}
        </span>
        {da && (
          <span className="num" style={{ fontSize: 12, color: dim(55) }}>
            {da.laps_used.length} clean laps · typical {fmtLap(da.median_lap_s)} · second-best{" "}
            {fmtLap(da.second_best_lap_s)}
          </span>
        )}
      </div>

      {/* ── Last time's focus, then this time's one thing ─────────────────── */}
      <FocusBanner />
      <OneThing />

      {/* ── The parts of the driving ──────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: "var(--space-3)" }}>
          <Eyebrow>Your driving, part by part</Eyebrow>
          {da && (
            <span className="num" style={{ fontSize: 11, color: dim(42) }}>
              up to {da.theoretical_gap_s.toFixed(2)} s a lap if every stretch matched your own quick
              passes · {da.actual_gap_s.toFixed(2)} s between your typical and second-best laps
            </span>
          )}
        </div>
        <div className="coach-tiles">
          {r.aspects.map((a) => (
            <AspectTile key={a.key} a={a} max={billedMax} gates={r.gates} Icon={ASPECT_ICON[a.key]} />
          ))}
        </div>
        {da && <Caveat maxWidth={820}>{noteFor("aspect.at_stake")}</Caveat>}
      </section>

      {/* ── You or your gear ──────────────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <Eyebrow style={{ marginBottom: "var(--space-3)" }}>You or your gear?</Eyebrow>
        <Panel padding="var(--space-3) var(--space-4)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3) var(--space-6)", alignItems: "center" }}>
            {gear.map((g) => (
              <button
                key={g.aspect}
                type="button"
                className="pk"
                onClick={() => dispatch({ t: "screen", screen: "hardware" })}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}
              >
                <VerdictChip
                  verdict={g.verdict}
                  label={g.aspect === "braking" ? "Brake pedal" : g.aspect === "throttle" ? "Throttle" : "Wheel"}
                />
              </button>
            ))}
            {gear[0]?.context && <span style={{ fontSize: 11.5, color: dim(55) }}>{gear[0].context}</span>}
          </div>
        </Panel>
      </section>

      {note && <div style={{ marginTop: "var(--space-6)", fontSize: 10.5, color: dim(42) }}>{note}</div>}

      {deep && <DriftNotes suggestions={r.suggestions} />}

      {/* ── The session as a whole ────────────────────────────────────────
          From the retired Session report: the one-line read of the laps, every
          lap against your best, and how the run drifted from first lap to last.
          Deep and up — the coach above is the answer; this is the context. */}
      {deep && <SessionContext />}

      <section style={{ marginTop: "var(--space-8)" }}>
        {/* When there is no aspect timing, the hero states why in the module's
            own words, so the foot does not say it twice. When there is, there
            is no such absence to skip. */}
        <Absences absences={bundle.absences} exclude={r.available ? undefined : VOICED} />
      </section>
    </div>
  );
}

function OneThing() {
  const { bundle, coachReport: r, dispatch } = useProctor();
  if (!bundle || !r) return null;
  const one = r.oneThing;

  const corners = one.kind === "none" ? [] : one.suggestion.corners;
  const aspect = one.kind === "none" ? null : r.aspects.find((a) => a.key === one.suggestion.aspect) ?? null;

  return (
    <section
      className="coach-hero"
      style={{
        display: "flex",
        gap: "var(--space-6)",
        padding: "var(--space-5)",
        background: "var(--color-surface)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
        borderLeft: `3px solid ${one.kind === "gear" ? CH.warn : one.kind === "suggestion" ? CH.a : dim(20)}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow style={{ marginBottom: "var(--space-2)" }}>
          {one.kind === "gear" ? "Before technique: your gear" : "Your one thing for next session"}
        </Eyebrow>

        {one.kind === "suggestion" && (
          <>
            {aspect && (
              <div style={{ fontSize: 12.5, color: dim(62), marginBottom: "var(--space-2)" }}>
                {aspectHeadline(aspect, r.gates)}
              </div>
            )}
            <SuggestionCard s={one.suggestion} big />
            <div style={{ marginTop: "var(--space-3)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {aspect && <VerdictChip verdict={aspect.gear.verdict} label="Gear" />}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dispatch({ t: "aspect", aspect: one.suggestion.aspect })}
                style={{ fontSize: 11.5, padding: "5px 10px" }}
              >
                All of your {ASPECT_LABEL[one.suggestion.aspect].toLowerCase()}
              </button>
            </div>
          </>
        )}

        {one.kind === "gear" && (
          <>
            <div style={{ font: "500 20px/1.3 var(--font-heading)", textWrap: "balance" }}>
              Fix the {one.finding.label.toLowerCase()} before working on your{" "}
              {ASPECT_LABEL[one.suggestion.aspect].toLowerCase()}
            </div>
            <GearFix finding={one.finding} />
            <BlockedLine s={one.suggestion} />
          </>
        )}

        {one.kind === "none" && (
          <>
            <div style={{ font: "500 17px/1.4 var(--font-heading)", color: dim(80), maxWidth: 640 }}>
              {r.available ? "No single habit stood out this session." : "No coaching for this session yet."}
            </div>
            <p style={{ margin: "var(--space-2) 0 0", fontSize: 13, lineHeight: 1.6, color: dim(62), maxWidth: 640 }}>
              {one.reason}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => dispatch({ t: "screen", screen: "analyze" })}
              style={{ marginTop: "var(--space-3)", fontSize: 11.5, padding: "5px 10px" }}
            >
              Compare laps instead
            </button>
          </>
        )}
      </div>

      {corners.length > 0 && bundle.map.x_m.length > 0 && (
        <div className="coach-hero-map" style={{ width: 240, height: 200, flex: "none" }}>
          <TrackMap
            x={bundle.map.x_m}
            y={bundle.map.y_m}
            w={240}
            h={200}
            pad={16}
            baseWidth={7}
            eraser="var(--color-surface)"
            highlights={corners.flatMap((id) => {
              const c = bundle.corners.find((k) => k.id === id);
              if (!c) return [];
              const n = bundle.map.x_m.length;
              return [{
                from: Math.round(c.start_pct * (n - 1)),
                to: Math.round(c.end_pct * (n - 1)),
                color: one.kind === "gear" ? CH.warn : CH.a,
                weight: 1,
              }];
            })}
            apexes={bundle.corners.filter((c) => corners.includes(c.id))}
          />
        </div>
      )}
    </section>
  );
}

function SessionContext() {
  const { bundle, state } = useProctor();
  const stats = useMemo(() => {
    if (!bundle) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    if (!times.length) return { clean, times, mean: 0, sd: 0, best: null as number | null };
    const mean = times.reduce((a, v) => a + v, 0) / times.length;
    const sd = Math.sqrt(times.reduce((a, v) => a + (v - mean) ** 2, 0) / times.length);
    return { clean, times, mean, sd, best: Math.min(...times) };
  }, [bundle]);
  if (!bundle || !stats) return null;
  return (
    <section style={{ marginTop: "var(--space-8)" }}>
      <Eyebrow style={{ marginBottom: "var(--space-3)" }}>The session as a whole</Eyebrow>
      <Lede item={explainSession(bundle.laps, stats.clean)} />
      <Evidence label="Show every lap against your best" hint={`${bundle.laps.length} laps, ${stats.clean.length} of them clean`}>
        <LapChart best={stats.best} sd={stats.sd} />
      </Evidence>
      <Evidence label="Show how the run changed from start to finish" hint="lap time, brake response, tyre surface and fuel, in lap order">
        <StintSection />
      </Evidence>
      {/* "everything" promises every panel the session produced. */}
      {atLeast(state.tier, "everything") && (
        <div
          style={{
            marginTop: "var(--space-6)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
            gap: "var(--space-4)",
          }}
        >
          <MeasuredCards deep stats={stats} />
        </div>
      )}
    </section>
  );
}

function BlockedLine({ s }: { s: Suggestion }) {
  return (
    <p style={{ margin: "var(--space-3) 0 0", fontSize: 12.5, lineHeight: 1.6, color: dim(62), maxWidth: 680 }}>
      It stands in front of: <span style={{ color: "var(--color-text)" }}>{s.title}</span> — {worthLine(s)}.
    </p>
  );
}

/** Zones the driver got quicker in as the session went on: said, because a
 *  "best" that came late may be the stint settling rather than a habit. */
function DriftNotes({ suggestions }: { suggestions: Suggestion[] }) {
  const drift = suggestions.filter((s) => s.key === "drift.improving");
  if (!drift.length) return null;
  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <Eyebrow style={{ marginBottom: "var(--space-3)" }}>Already coming</Eyebrow>
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {drift.map((s) => (
          <Panel key={`${s.key}-${s.corners.join(",")}`} padding="var(--space-3) var(--space-4)">
            <SuggestionCard s={s} showWhy={false} />
          </Panel>
        ))}
      </div>
    </section>
  );
}
