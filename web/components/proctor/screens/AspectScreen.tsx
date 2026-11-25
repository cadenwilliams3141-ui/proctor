"use client";

/* One part of the driving at a time: braking, turn-in & steering, throttle &
 * exit, the line, or grip.
 *
 * The order is the lesson:
 *   1. what it seems to be worth, and where on the lap
 *   2. what to try — aimed at what your own quick passes did
 *   3. your habits, corner by corner: typical against your quick passes
 *   4. you or your gear?
 *   5. the evidence: the physics panels that used to live on their own screen
 *
 * Caveats, absences and technique notes stay beside the answer and never go
 * inside <Evidence> (the 2026-08-14 Decision; ui/Evidence.test.ts checks). */

import { useMemo } from "react";

import Absences from "@/components/proctor/ui/Absences";
import { Evidence, HeroNumber } from "@/components/proctor/ui/Answer";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import TrackMap from "@/components/proctor/ui/TrackMap";
import IntoTheCorner from "@/components/proctor/panels/IntoTheCorner";
import {
  CompareButton,
  GearFix,
  SuggestionCard,
  VerdictChip,
  WorthBar,
} from "@/components/proctor/panels/CoachBits";
import {
  EnvelopeBars,
  GripSection,
  SlipPanel,
  SlipSection,
  TorqueSection,
  TractionCircle,
} from "@/components/proctor/panels/ForcesPanels";
import { ASPECT_ICON } from "@/components/proctor/screens/CoachScreen";
import { CH, dim } from "@/lib/proctor/channels";
import { ASPECT_LABEL, ASPECT_ORDER, aspectHeadline, type AspectKey } from "@/lib/proctor/coach";
import { fixed } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { techniqueForSlip, techniqueForSteerTorque } from "@/lib/proctor/technique";
import type { AspectCorner, AspectMetricKey } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

/** The habits each aspect is read through, with the words and unit for each. */
const HABITS: Record<AspectKey, { key: AspectMetricKey; label: string; unit: string; dp: number }[]> = {
  braking: [
    { key: "brake_point_m", label: "brake point", unit: "m before the apex", dp: 1 },
    { key: "peak_brake_pct", label: "peak pressure", unit: "% pedal", dp: 0 },
  ],
  turn_in: [
    { key: "corrections", label: "steering corrections to the apex", unit: "", dp: 0 },
    { key: "envelope_use_pct", label: "grip used, turn-in to apex", unit: "% of yours", dp: 0 },
    { key: "min_speed_kmh", label: "slowest point", unit: "km/h", dp: 0 },
  ],
  throttle: [
    { key: "pickup_m", label: "throttle pickup", unit: "m from the apex", dp: 1 },
    { key: "full_m", label: "flat out", unit: "m from the apex", dp: 1 },
    { key: "pickup_to_full_s", label: "pickup to flat out", unit: "s", dp: 2 },
    { key: "exit_lifts", label: "lifts on the way out", unit: "", dp: 0 },
    { key: "exit_speed_kmh", label: "speed when flat out", unit: "km/h", dp: 0 },
  ],
  line: [
    { key: "offset_turn_in_m", label: "at turn-in", unit: "m left of your reference line", dp: 1 },
    { key: "offset_apex_m", label: "at the apex", unit: "m left of your reference line", dp: 1 },
    { key: "offset_exit_m", label: "at the exit", unit: "m left of your reference line", dp: 1 },
  ],
  grip: [{ key: "envelope_use_pct", label: "grip used, turn-in to apex", unit: "% of yours", dp: 0 }],
};

/** Module absences each aspect states itself, where the reader looks for them. */
const VOICED: Record<AspectKey, string[]> = {
  braking: ["driving_aspects", "trail_braking"],
  turn_in: ["driving_aspects", "contact_patch"],
  throttle: ["driving_aspects"],
  line: ["driving_aspects", "track_width"],
  grip: ["driving_aspects", "grip", "traction_circle"],
};

export default function AspectScreen() {
  const { bundle, coachReport: r, state, dispatch } = useProctor();
  const key = state.aspect;
  const a = r?.aspects.find((x) => x.key === key) ?? null;
  const da = bundle?.drivingAspects ?? null;

  const ranked = useMemo(() => (a ? [...a.corners].sort((x, y) => y.atStakeS - x.atStakeS) : []), [a]);
  const selectedId = state.selCorner ?? ranked[0]?.id ?? da?.corners[0]?.id ?? null;
  const corner: AspectCorner | null = da?.corners.find((c) => c.id === selectedId) ?? null;

  if (!bundle || !r || !a) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const deep = atLeast(state.tier, "deep");
  const max = Math.max(...ranked.map((c) => c.atStakeS), 1e-6);
  const n = bundle.map.x_m.length;
  const toIdx = (p: number) => Math.round(p * (n - 1));
  const handed = (a.handedTo ?? []).filter((h) => r.gates && h.atStakeS >= r.gates.min_at_stake_s);
  const tips = a.suggestions.filter((s) => s.key !== "drift.improving");
  const drift = a.suggestions.filter((s) => s.key === "drift.improving");

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      {/* ── The five aspects ──────────────────────────────────────────────── */}
      <nav aria-label="Aspects" className="aspect-tabs" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "var(--space-5)" }}>
        {ASPECT_ORDER.map((k) => {
          const x = r.aspects.find((y) => y.key === k)!;
          const Icon = ASPECT_ICON[k];
          const on = k === key;
          return (
            <button
              key={k}
              type="button"
              className="pk"
              aria-pressed={on}
              onClick={() => dispatch({ t: "aspect", aspect: k })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: 8,
                border: 0,
                font: "500 12px var(--font-heading)",
                color: on ? "var(--color-text)" : dim(55),
                background: on ? dim(7) : "transparent",
                boxShadow: on ? `inset 0 0 0 1px ${dim(14)}` : "none",
              }}
            >
              <Icon size={14} strokeWidth={1.7} />
              {ASPECT_LABEL[k]}
              {x.atStakeS != null && (
                <span className="num" style={{ fontSize: 10.5, color: x.linked ? CH.warn : CH.loss }}>
                  {x.atStakeS.toFixed(2)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── 1. What it seems to be worth, and where ───────────────────────── */}
      <section
        style={{
          display: "flex",
          gap: "var(--space-6)",
          alignItems: "flex-start",
          padding: "var(--space-5)",
          background: "var(--color-surface)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-sm)",
        }}
        className="aspect-answer"
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "500 17px/1.4 var(--font-heading)", textWrap: "balance" }}>{aspectHeadline(a, r.gates)}</div>
          {handed.map((h) => (
            <div key={h.aspect} style={{ marginTop: 6, fontSize: 12.5, color: dim(62) }}>
              <span className="num">{h.atStakeS.toFixed(2)} s</span> of the time here went with your{" "}
              <button
                type="button"
                className="pk"
                onClick={() => dispatch({ t: "aspect", aspect: h.aspect })}
                style={{ border: 0, background: "transparent", padding: 0, color: CH.a, cursor: "pointer", font: "inherit" }}
              >
                {ASPECT_LABEL[h.aspect].toLowerCase()}
              </button>
              , so it is counted there.
            </div>
          ))}
          {a.tendency && <div style={{ marginTop: 8, fontSize: 12.5, color: dim(62) }}>{a.tendency}</div>}
          {!r.available && <div style={{ marginTop: 8, fontSize: 12.5, color: dim(62) }}>{r.reason}</div>}
          <Caveat maxWidth={720}>{noteFor(a.linked ? "coach.linked" : "aspect.at_stake")}</Caveat>
        </div>
        <HeroNumber
          value={a.atStakeS == null ? "—" : a.atStakeS.toFixed(2)}
          unit={a.atStakeS == null ? undefined : "s"}
          label={a.linked ? "went with these differences, a lap — overlapping the rest" : "up to, a lap, against your own quick passes"}
          tone={a.atStakeS ? (a.linked ? CH.warn : CH.loss) : dim(40)}
        />
      </section>

      {ranked.length > 0 && (
        <div className="aspect-where" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          <Panel title="Where on the lap" sub="corners by what this seems to be worth there">
            <div style={{ display: "grid", gap: 6 }}>
              {ranked.map((c) => {
                const on = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="crow"
                    aria-pressed={on}
                    onClick={() => dispatch({ t: "corner", id: c.id })}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "38px 1fr 64px",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 8px",
                      border: 0,
                      borderRadius: 6,
                      background: on ? dim(6) : "transparent",
                      color: "var(--color-text)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ font: "500 12px var(--font-heading)" }}>T{c.id}</span>
                    <WorthBar value={c.atStakeS} max={max} linked={a.linked} />
                    <span className="num" style={{ fontSize: 11.5, textAlign: "right", color: dim(70) }}>
                      {c.atStakeS.toFixed(3)} s
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel padding="var(--space-3)">
            <div style={{ height: 260 }}>
              {n > 0 && (
                <TrackMap
                  x={bundle.map.x_m}
                  y={bundle.map.y_m}
                  w={280}
                  h={260}
                  pad={18}
                  baseWidth={7}
                  highlights={ranked.flatMap((c) => {
                    const k = bundle.corners.find((x) => x.id === c.id);
                    if (!k) return [];
                    return [{
                      from: toIdx(k.start_pct),
                      to: toIdx(k.end_pct),
                      color: c.id === selectedId ? CH.a : a.linked ? CH.warn : CH.loss,
                      weight: c.id === selectedId ? 1 : c.atStakeS / max,
                    }];
                  })}
                  apexes={bundle.corners.filter((k) => ranked.some((c) => c.id === k.id))}
                />
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* ── 2. What to try ────────────────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <Eyebrow style={{ marginBottom: "var(--space-3)" }}>What to try</Eyebrow>
        {tips.length ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {tips.map((s) => (
              <Panel key={`${s.key}-${s.corners.join(",")}`} padding="var(--space-4)">
                <SuggestionCard s={s} />
              </Panel>
            ))}
          </div>
        ) : (
          <Panel padding="var(--space-4)">
            <div style={{ fontSize: 13, lineHeight: 1.6, color: dim(66), maxWidth: 680 }}>
              {r.available
                ? "None of your habits here went with quicker passes strongly enough, across enough laps, to point at. That is a result: the time is real, but the file does not show what made the difference."
                : r.reason}
            </div>
          </Panel>
        )}
        {drift.map((s) => (
          <Panel key={`drift-${s.corners.join(",")}`} padding="var(--space-4)" style={{ marginTop: "var(--space-3)" }}>
            <SuggestionCard s={s} showWhy={false} />
          </Panel>
        ))}
      </section>

      {/* ── 3. Your habits, corner by corner ──────────────────────────────── */}
      {corner && HABITS[key].some((h) => corner.metrics[h.key]) && (
        <section style={{ marginTop: "var(--space-6)" }}>
          <Eyebrow style={{ marginBottom: "var(--space-3)" }}>Your habits at T{corner.id}</Eyebrow>
          <Panel padding="var(--space-4)">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th style={{ textAlign: "right" }}>typical</th>
                  <th style={{ textAlign: "right", color: CH.gain }}>your quick passes</th>
                  <th style={{ textAlign: "right" }}>link to time</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {HABITS[key].map((h) => {
                  const m = corner.metrics[h.key];
                  if (!m) return null;
                  return (
                    <tr key={h.key}>
                      <td style={{ color: dim(62), fontSize: 11.5 }}>{h.label}</td>
                      <td className="num" style={{ textAlign: "right" }}>{fixed(m.typical, h.dp)}</td>
                      <td className="num" style={{ textAlign: "right", color: CH.gain }}>{fixed(m.quick, h.dp)}</td>
                      <td className="num" style={{ textAlign: "right", color: dim(55), fontSize: 11 }}>
                        {m.link ? `ρ ${m.link.rho.toFixed(2)} · p ${m.link.p.toFixed(3)} · ${m.link.n} laps` : "no variation"}
                      </td>
                      <td style={{ color: dim(40), fontSize: 10.5 }}>{h.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: "var(--space-3)" }}>
              <CompareButton lap={corner.zones[zoneOf(key)].best_lap} corner={corner.id} />
            </div>
            <Caveat maxWidth={720}>
              Quick passes are the quickest third of your clean laps through this stretch. ρ is how
              closely the habit tracked the time across laps; p is how often chance alone would show
              a link that strong.
            </Caveat>
          </Panel>
        </section>
      )}

      {/* ── 4. You or your gear? ──────────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--space-3)" }}>
          <Eyebrow>You or your gear?</Eyebrow>
          {a.gear.findings.length > 0 && <VerdictChip verdict={a.gear.verdict} />}
        </div>
        <Panel padding="var(--space-4)">
          {a.gear.findings.length === 0 ? (
            <div style={{ fontSize: 12.5, color: dim(62) }}>
              Nothing on a rig decides {key === "line" ? "where the car goes" : "how much grip the tyres had"} — this one is
              the driving and the car.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {a.gear.findings.map((f) =>
                f.verdict === "gear-first" ? (
                  <GearFix key={f.label} finding={f} />
                ) : (
                  <div key={f.label} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <VerdictChip verdict={f.verdict} />
                    <span style={{ font: "500 12.5px var(--font-heading)" }}>{f.label}</span>
                    <span style={{ fontSize: 12.5, color: dim(62) }}>{f.detail}</span>
                  </div>
                ),
              )}
            </div>
          )}
          {a.gear.context && <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: dim(58) }}>{a.gear.context}</div>}
          <Caveat maxWidth={720}>{noteFor("gear.verdict")}</Caveat>
        </Panel>
      </section>

      {/* ── 5. The evidence ───────────────────────────────────────────────── */}
      {deep && <AspectEvidence aspect={key} cornerId={selectedId} />}

      <section style={{ marginTop: "var(--space-8)" }}>
        <Absences
          absences={bundle.absences.filter((x) => VOICED[key].includes(x.key) || x.permanent)}
          title={`What this session does not show about your ${ASPECT_LABEL[key].toLowerCase()}`}
        />
      </section>
    </div>
  );
}

function zoneOf(k: AspectKey) {
  return k === "braking" ? "braking" : k === "throttle" ? "exit" : "rotation";
}

function AspectEvidence({ aspect, cornerId }: { aspect: AspectKey; cornerId: number | null }) {
  const { bundle, dispatch } = useProctor();
  if (!bundle) return null;
  const lockups = bundle.events.filter((e) => e.kind === "lockup");
  const spins = bundle.events.filter((e) => e.kind === "wheelspin");
  const trailCorner = bundle.trailBraking?.corners.find((c) => c.id === cornerId) ?? null;

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <Eyebrow style={{ marginBottom: "var(--space-3)" }}>The evidence</Eyebrow>

      {aspect === "braking" && cornerId != null && (
        <>
          <IntoTheCorner trail={bundle.trailBraking} corner={trailCorner} id={cornerId} />
          <Evidence label="Show every lockup" hint={`${lockups.length} lockups, with the inputs on the car at the time`}>
            <SlipPanel kind="lockup" events={lockups} />
          </Evidence>
        </>
      )}

      {aspect === "turn_in" && (
        <>
          <TorqueSection cp={bundle.contactPatch} hw={bundle.hardware} absences={bundle.absences} />
          <TechniqueNotes notes={techniqueForSteerTorque(bundle.contactPatch)} />
          <SlipSection cp={bundle.contactPatch} absences={bundle.absences} />
          <TechniqueNotes notes={techniqueForSlip(bundle.contactPatch)} />
          {bundle.balance?.corners && (
            <Panel title="Where the car slid, front or rear" sub="against this session's own average — relative, not absolute" style={{ marginTop: "var(--space-4)" }}>
              <BalanceRows />
            </Panel>
          )}
        </>
      )}

      {aspect === "throttle" && (
        <Evidence label="Show every wheelspin" hint={`${spins.length} wheelspin events, with the inputs on the car at the time`} defaultOpen>
          <SlipPanel kind="wheelspin" events={spins} />
        </Evidence>
      )}

      {aspect === "line" && (
        <Panel padding="var(--space-4)">
          <div style={{ fontSize: 12.5, color: dim(66), marginBottom: "var(--space-3)" }}>
            The line every clean lap drove, against the road this circuit has shown so far.
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              dispatch({ t: "view", view: "line" });
              dispatch({ t: "screen", screen: "analyze" });
            }}
            style={{ fontSize: 11.5, padding: "5px 10px" }}
          >
            Open the racing line
          </button>
        </Panel>
      )}

      {aspect === "grip" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "var(--space-4)" }}>
            <TractionCircle />
            <EnvelopeBars />
          </div>
          {bundle.grip && (
            <Evidence label="Show how the grip was measured" hint="the formula, speed bands, the load curve and per-corner grip">
              <GripSection grip={bundle.grip} />
            </Evidence>
          )}
          <Evidence label="Show every moment a wheel let go" hint={`${lockups.length} lockups, ${spins.length} wheelspin`}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: "var(--space-4)" }}>
              <SlipPanel kind="lockup" events={lockups} />
              <SlipPanel kind="wheelspin" events={spins} />
            </div>
          </Evidence>
        </>
      )}
    </section>
  );
}

function BalanceRows() {
  const { bundle } = useProctor();
  const corners = bundle?.balance?.corners ?? [];
  return (
    <table className="table">
      <thead>
        <tr>
          <th />
          <th style={{ textAlign: "right" }}>front slid</th>
          <th style={{ textAlign: "right" }}>rear slid</th>
          <th>lean</th>
        </tr>
      </thead>
      <tbody>
        {corners.map((c) => (
          <tr key={c.id}>
            <td style={{ font: "500 12px var(--font-heading)" }}>T{c.id}</td>
            <td className="num" style={{ textAlign: "right" }}>{fixed(c.understeer_pct, 0)}</td>
            <td className="num" style={{ textAlign: "right" }}>{fixed(c.oversteer_pct, 0)}</td>
            <td style={{ fontSize: 11.5, color: dim(62) }}>{c.lean === "understeer" ? "front" : c.lean === "oversteer" ? "rear" : c.lean}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
