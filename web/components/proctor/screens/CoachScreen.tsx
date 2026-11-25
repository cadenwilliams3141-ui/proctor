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

import Absences from "@/components/proctor/ui/Absences";
import { Evidence } from "@/components/proctor/ui/Answer";
import { Lede } from "@/components/proctor/ui/Explain";
import { LapChart, MeasuredCards, StintSection } from "@/components/proctor/panels/ReportPanels";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import AspectStack from "@/components/proctor/panels/AspectStack";
import FocusBanner from "@/components/proctor/panels/FocusBanner";
import TrackMap from "@/components/proctor/ui/TrackMap";
import {
  GearFix,
  GearStrip,
  StatRow,
  SuggestionCard,
  VerdictChip,
} from "@/components/proctor/panels/CoachBits";
import { CH, dim } from "@/lib/proctor/channels";
import { ASPECT_LABEL, heroFigures, worthLine, type Suggestion } from "@/lib/proctor/coach";
import { explainSession } from "@/lib/proctor/explain";
import { isUsable } from "@/lib/proctor/types";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import { atLeast, hiddenNote } from "@/lib/tier";

/* Absences this screen voices itself: the aspect timing, where the hero says
   why there is no one thing. Everything else falls to the block at the foot. */
const VOICED = new Set(["driving_aspects"]);

export default function CoachScreen() {
  const { bundle, coachReport: r, state } = useProctor();

  if (!bundle || !r) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const da = bundle.drivingAspects;
  const s = bundle.session;
  const deep = atLeast(state.tier, "deep");
  const one = r.oneThing;
  // Glance hides the drift notes (when there are any) and the session context.
  const note = hiddenNote(state.tier, deep ? 0 : 1 + (r.suggestions.some((x) => x.key === "drift.improving") ? 1 : 0));

  return (
    <div className="scrollpane roomy" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      {/* ── The session, in one line ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px", marginBottom: "var(--space-5)" }}>
        <span style={{ font: "var(--font-heading-weight) 16px var(--font-heading)" }}>{s.track_name ?? "Unknown track"}</span>
        <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>
          {[s.car_name ?? "unknown car", s.session_type, fmtDay(s.recorded_at)].filter(Boolean).join(" · ")}
        </span>
        {da && (
          <span className="num" style={{ fontSize: 12.5, color: "var(--color-neutral-500)" }}>
            {da.laps_used.length} clean · typical{" "}
            <span style={{ color: "var(--color-text)" }}>{fmtLap(da.median_lap_s)}</span> · second-best{" "}
            <span style={{ color: CH.gain }}>{fmtLap(da.second_best_lap_s)}</span>
          </span>
        )}
      </div>

      <div className="carbon-split">
        {/* ── Last time's focus, then this time's one thing ───────────────── */}
        <div style={{ minWidth: 0 }}>
          <FocusBanner />
          <OneThing />

          {note && <div style={{ marginTop: "var(--space-6)", fontSize: 11, color: "var(--color-neutral-500)" }}>{note}</div>}

          {deep && <DriftNotes suggestions={r.suggestions} />}

          {/* ── The session as a whole ──────────────────────────────────────
              From the retired Session report: the one-line read of the laps,
              every lap against your best, and how the run drifted from first
              lap to last. Deep and up — the coach is the answer; this is the
              context. */}
          {deep && <SessionContext />}

          <section style={{ marginTop: "var(--space-8)" }}>
            {/* When there is no aspect timing, the hero states why in the
                module's own words, so the foot does not say it twice. When
                there is, there is no such absence to skip. */}
            <Absences absences={bundle.absences} exclude={r.available ? undefined : VOICED} />
          </section>
        </div>

        {/* ── The parts of the driving, worth first ────────────────────────── */}
        <aside className="carbon-side" style={{ minWidth: 0 }}>
          <AspectStack outlined={one.kind === "none" ? null : one.suggestion.aspect} showGap />
        </aside>
      </div>
    </div>
  );
}

function OneThing() {
  const { bundle, coachReport: r, dispatch } = useProctor();
  if (!bundle || !r) return null;
  const one = r.oneThing;

  const corners = one.kind === "none" ? [] : one.suggestion.corners;
  const aspect = one.kind === "none" ? null : r.aspects.find((a) => a.key === one.suggestion.aspect) ?? null;
  const tone = one.kind === "gear" ? CH.warn : CH.a;

  return (
    <section className="coach-hero" aria-label="Your one thing">
      <div className="coach-hero-body">
        <div className="coach-hero-text">
          <Eyebrow size={12} color={one.kind === "none" ? undefined : tone} style={{ marginBottom: "var(--space-3)" }}>
            {one.kind === "gear" ? "Before technique: your gear" : "Your one thing"}
          </Eyebrow>

          {one.kind === "suggestion" && (
            <SuggestionCard
              s={one.suggestion}
              big
              figures={heroFigures(one.suggestion, aspect)}
              actions={
                <>
                  {aspect && <VerdictChip verdict={aspect.gear.verdict} label="Gear" />}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => dispatch({ t: "aspect", aspect: one.suggestion.aspect })}
                    style={{ fontSize: 12, padding: "5px 8px" }}
                  >
                    All of your {ASPECT_LABEL[one.suggestion.aspect].toLowerCase()}
                  </button>
                </>
              }
            />
          )}

          {one.kind === "gear" && (
            <>
              <h2 style={{ margin: 0, font: "var(--font-heading-weight) 26px/1.15 var(--font-heading)", textWrap: "balance" }}>
                Fix the {one.finding.label.toLowerCase()} before working on your{" "}
                {ASPECT_LABEL[one.suggestion.aspect].toLowerCase()}
              </h2>
              <StatRow figures={heroFigures(one.suggestion, aspect).slice(0, 2)} />
              <GearFix finding={one.finding} />
              <BlockedLine s={one.suggestion} />
            </>
          )}

          {one.kind === "none" && (
            <>
              <h2 style={{ margin: 0, font: "var(--font-heading-weight) 22px/1.25 var(--font-heading)", color: dim(85), maxWidth: 640 }}>
                {r.available ? "No single habit stood out this session." : "No coaching for this session yet."}
              </h2>
              <p style={{ margin: "var(--space-3) 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-300)", maxWidth: 640 }}>
                {/* The module's own words, as a sentence. */}
                {one.reason.charAt(0).toUpperCase() + one.reason.slice(1)}
                {/[.!?]$/.test(one.reason) ? "" : "."}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dispatch({ t: "screen", screen: "analyze" })}
                style={{ marginTop: "var(--space-4)", fontSize: 12.5, padding: "7px 12px" }}
              >
                Compare laps instead
              </button>
            </>
          )}
        </div>

        {corners.length > 0 && bundle.map.x_m.length > 0 && (
          <div className="coach-hero-map">
            {/* A fixed box: the map's SVG fills its container, and under 860px
                the panel is the card's full width. */}
            <div style={{ width: 270, height: 230, maxWidth: "100%" }}>
              <TrackMap
                x={bundle.map.x_m}
                y={bundle.map.y_m}
                w={270}
                h={230}
                pad={18}
                baseWidth={9}
                eraser="var(--color-rail)"
                highlights={corners.flatMap((id) => {
                  const c = bundle.corners.find((k) => k.id === id);
                  if (!c) return [];
                  const n = bundle.map.x_m.length;
                  return [{
                    from: Math.round(c.start_pct * (n - 1)),
                    to: Math.round(c.end_pct * (n - 1)),
                    color: tone,
                    weight: 1,
                  }];
                })}
                apexes={bundle.corners.filter((c) => corners.includes(c.id))}
              />
            </div>
          </div>
        )}
      </div>

      {/* You or your gear, one cell a device — the card's footer. */}
      <GearStrip />
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
