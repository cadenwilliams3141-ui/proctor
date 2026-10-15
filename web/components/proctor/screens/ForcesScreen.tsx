"use client";

/* Forces — the chain from the driver's foot to the ground, in order.
 *
 * ┌ WHY THIS IS ONE SCREEN ─────────────────────────────────────────────────┐
 * │ Rig health and the grip layer used to be two different parts of this     │
 * │ app, and they are not two subjects. The torque in the wheel IS the       │
 * │ contact patch talking to the driver's hands; the ABS cutting pressure IS │
 * │ the tyres refusing what the pedal asked for. Split apart, each half read │
 * │ as a pile of unrelated statistics. Run in order, they are one sentence:  │
 * │                                                                          │
 * │   01 what you asked for                                                  │
 * │   02 what the car did with it                                            │
 * │   03 what came back through the wheel                                    │
 * │   04 what the ground gave                                                │
 * │   05 where the car pointed, against where it went                        │
 * │                                                                          │
 * │ The order is the content. A numbered step says "this follows from the    │
 * │ last one" in a way fourteen equal panels could not.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ANSWER FIRST. The screen opens with sentences and one number. Every chart
 * that was here before is still here, one click away behind <Evidence> —
 * nothing was summarised away, and the caveats did NOT go behind the fold with
 * the charts, because a caveat qualifies the sentence the reader actually
 * reads. See components/proctor/ui/Answer.tsx for that rule and why it exists.
 *
 * TWO KINDS OF WRITING. Panels state what this file showed. TechniqueNotes
 * blocks state what the shape generally means, and carry a label saying they
 * are not a reading of this file. They must never be confused, which is why
 * they never share a panel.
 *
 * THE NUMBERS ARE REAL. The cards here once carried a brake ceiling of "93.4"
 * and an FFB figure of "1.87" as literals in this file's own source. They come
 * off the modules now, and where a module could not measure one, it says so
 * rather than printing a number. */

import { useMemo } from "react";
import { Ban, CircleAlert, Gauge, TriangleAlert } from "lucide-react";

import Absences from "@/components/proctor/ui/Absences";
import Answer, { Evidence, HeroNumber, Step } from "@/components/proctor/ui/Answer";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import GripLoadCurve from "@/components/proctor/views/GripLoadCurve";
import Panel from "@/components/proctor/ui/Panel";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import {
  explainEvent,
  explainGrip,
  explainInputResponse,
  explainPattern,
  wheelName,
} from "@/lib/proctor/explain";
import { fixed } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { atLeast, hiddenNote } from "@/lib/tier";
import {
  techniqueForGrade,
  techniqueForInputResponse,
  techniqueForSlip,
  techniqueForSteerTorque,
} from "@/lib/proctor/technique";
import {
  isUsable,
  type ContactPatchData,
  type GripData,
  type HardwareData,
  type InputResponseData,
  type ModuleAbsence,
  type TrackEvent,
} from "@/lib/proctor/types";

/* Absences this screen states in its own words, where the reader went looking
   for the number. The summary block at the foot skips them, so one missing
   measurement is reported once rather than twice.

   Tier-dependent, and that is the whole difficulty. A section a lower detail
   level does not render is not voicing anything — the same rule that took
   `input_response` off ReportScreen's list when it moved behind a fold. Steps
   03 and 05 are the only places contact_patch is voiced, and both are
   deep-only, so at "glance" that key MUST fall through to the summary block.
   Get this wrong and turning the detail down silently deletes a negative
   result, which is the one thing the honesty rules exist to prevent. */
function voicedHere(deep: boolean): ReadonlySet<string> {
  const keys = [
    "input_response", // → step 02's ResponseRow, always rendered
    "grip", // → step 04's Missing, always rendered
    "traction_circle", // → TractionCircle's own empty state, always rendered
  ];
  // Steps 03 and 05 are the only voices contact_patch has.
  if (deep) keys.push("contact_patch");
  return new Set(keys);
}

export default function ForcesScreen() {
  const { bundle, state } = useProctor();

  const lockups = useMemo(
    () => (bundle ? bundle.events.filter((e) => e.kind === "lockup") : []),
    [bundle],
  );
  const spins = useMemo(
    () => (bundle ? bundle.events.filter((e) => e.kind === "wheelspin") : []),
    [bundle],
  );

  if (!bundle) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const hw = bundle.hardware;
  const grip = bundle.grip;
  const ir = bundle.inputResponse;
  const cp = bundle.contactPatch;

  const deep = atLeast(state.tier, "deep");

  /* "Glance" promises "the answer and little else" (lib/tier.ts) and on this
     screen it was delivering 10,827 characters — byte for byte what "deep"
     showed, because nothing here read the tier at all. The chain's first two
     steps ARE the answer, and step 04 carries the traction circle that was
     deliberately surfaced on 2026-09-01, so those stay. What comes off is the
     three sections a reader at a glance did not ask for: the torque the wheel
     returned, the slip angle, and the road's slope underneath both.

     COUNTED, NOT ASSUMED. The Decision of 2026-07-23 requires the "N panels
     hidden" note to be RIGHT — claiming a panel is hidden when none is teaches
     the reader to ignore the note. GradeSection renders nothing at all unless
     the grade was measured, so a hardcoded 3 would over-count on every session
     without elevation. The count is derived from the same conditions the
     sections themselves use. */
  const gradeDrawn = Boolean(cp?.grade?.measured);
  const hidden = deep ? 0 : 2 + (gradeDrawn ? 1 : 0);
  const note = hiddenNote(state.tier, hidden);

  /* The answer this screen exists to give, in sentences. Grip first because it
     is the end of the chain — what the ground actually gave — and the inputs
     read as the story of how it was asked for. */
  const answer = [
    ...(grip ? explainGrip(grip).slice(0, 1) : []),
    ...(ir ? explainInputResponse(ir).slice(0, 2) : []),
  ];

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <Answer
        items={answer}
        hero={
          grip ? (
            <HeroNumber
              value={grip.session.peak_mu.toFixed(2)}
              unit="g per g"
              label="the most grip you used — horizontal force over the load pressing the car down"
              tone={CH.a}
            />
          ) : undefined
        }
        caveat={<Caveat maxWidth={720}>{noteFor("grip.mu")}</Caveat>}
      />

      {/* ═══ 01 What you asked for ══════════════════════════════════════════ */}
      <Step
        n={1}
        title="What you asked for"
        sub="your pedals and your hands, before the car had a say"
      >
        <InputCards hw={hw} ir={ir} />
      </Step>

      {/* ═══ 02 What the car did with it ════════════════════════════════════ */}
      <Step
        n={2}
        title="What the car did with it"
        sub="where the electronics or the tyres took some of it back"
      >
        <ResponseRow ir={ir} hw={hw} absences={bundle.absences} />
        <TechniqueNotes notes={techniqueForInputResponse(ir)} />
        <Evidence
          label="Show every moment a wheel let go"
          hint={`${lockups.length} lockups, ${spins.length} wheelspin, with the inputs on the car at the time`}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
              gap: "var(--space-4)",
            }}
          >
            <SlipPanel kind="lockup" events={lockups} />
            <SlipPanel kind="wheelspin" events={spins} />
          </div>
        </Evidence>
      </Step>

      {/* ═══ 03 What came back through the wheel ════════════════════════════
          Deep and up. The technique note travels WITH its section rather than
          being gated separately: a note hangs off a measured finding, so a note
          left on screen after its measurement was hidden would be the only
          thing said about the subject — which is exactly what the 2026-08-27
          rule forbids. */}
      {deep && (
        <Step
          n={3}
          title="What came back through the wheel"
          sub="the front tyres, reported in newton-metres at your hands"
        >
          <TorqueSection cp={cp} hw={hw} absences={bundle.absences} />
          <TechniqueNotes notes={techniqueForSteerTorque(cp)} />
        </Step>
      )}

      {/* ═══ 04 What the ground gave ════════════════════════════════════════ */}
      <Step
        n={4}
        title="What the ground gave"
        sub="grip, measured rather than modelled"
      >
        {/* THE TRACTION CIRCLE IS NOT GATED ON THE GRIP MODULE.
            It was, and that made surfacing it worthless on every real session.
            traction_circle is one of the original modules and has a stored
            block on everything in the database; grip shipped 2026-08-02 and has
            a block on nothing until a re-ingest runs. Nesting the plot inside
            `grip ? …` meant the one panel in this step that HAD data was hidden
            behind the one that did not, and the step rendered as a bare
            "re-ingest to fix" notice with a drawable g-g plot sitting behind
            it.

            TractionCircle reads bundle.traction and EnvelopeBars reads
            bundle.laps — neither touches grip — and each carries its own empty
            state. So they render on their own terms, and the grip commentary
            below says what it can separately. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            gap: "var(--space-4)",
          }}
        >
          <TractionCircle />
          <EnvelopeBars />
        </div>

        {grip ? (
          <>
            <Panel title="In plain English" padding="var(--space-4)">
              <Explain items={explainGrip(grip)} max={5} />
            </Panel>
            <Evidence
              label="Show how the grip was measured"
              hint="the formula, speed bands, the load curve and per-corner grip"
            >
              <GripSection grip={grip} />
            </Evidence>
          </>
        ) : (
          <Missing absences={bundle.absences} k="grip" />
        )}
      </Step>

      {/* ═══ 05 Where the car pointed against where it went ═════════════════ */}
      {deep && (
        <Step
          n={5}
          title="Where the car pointed, against where it went"
          sub="slip angle, measured from the car's own velocity"
        >
          <SlipSection cp={cp} absences={bundle.absences} />
          <TechniqueNotes notes={techniqueForSlip(cp)} />
        </Step>
      )}

      {/* ── The road under all of it ──────────────────────────────────────── */}
      {deep && (
        <>
          <GradeSection cp={cp} />
          <TechniqueNotes notes={techniqueForGrade(cp)} />
        </>
      )}

      {/* ── The walls ─────────────────────────────────────────────────────── */}
      <Panel padding="var(--space-4)" style={{ marginTop: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <Ban size={17} strokeWidth={1.6} color={dim(45)} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <div style={{ font: "500 12.5px var(--font-heading)", marginBottom: 4 }}>
              Not possible from disk telemetry — and it will not be faked.
            </div>
            <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6, maxWidth: 760 }}>
              {noteFor("racecraft")} {noteFor("brake.temperature")} {noteFor("tire.load_kg")}
            </div>
          </div>
        </div>
      </Panel>

      {hw && hw.concerns.length > 0 && (
        <Panel
          title="Worth keeping an eye on"
          sub="watch items, not diagnoses"
          padding="var(--space-4)"
          style={{ marginTop: "var(--space-4)" }}
        >
          {hw.concerns.map((c) => (
            <div key={c.area} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 10 }}>
              <TriangleAlert size={13} strokeWidth={1.9} color={CH.warn} style={{ flex: "none", marginTop: 2 }} />
              <div>
                <div style={{ font: "500 12px var(--font-heading)", marginBottom: 2 }}>{c.area}</div>
                <div style={{ fontSize: 11.5, color: dim(62), lineHeight: 1.55 }}>{c.observation}</div>
                <div style={{ fontSize: 10.5, color: dim(38), marginTop: 2 }}>{c.watch}</div>
              </div>
            </div>
          ))}
        </Panel>
      )}
      {hw && hw.concerns.length === 0 && hw.concerns_finding && (
        <Caveat maxWidth={700}>{hw.concerns_finding}</Caveat>
      )}

      {/* ── What is not here ───────────────────────────────────────────────
          This screen folded charts behind <Evidence> and now gates three
          sections by tier, and it had NO summary block at all — so an absence
          whose only voice was one of those sections was reported nowhere the
          moment either mechanism hid it. Absences are never tier-gated, so
          this block renders at every detail level and `voicedHere` widens as
          the tier narrows. */}
      {note && (
        <div style={{ marginTop: "var(--space-6)", fontSize: 10.5, color: dim(42) }}>{note}</div>
      )}

      <section style={{ marginTop: "var(--space-8)" }}>
        <Absences absences={bundle.absences} exclude={voicedHere(deep)} />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The chain, step by step
// ─────────────────────────────────────────────────────────────────────────────

/** A module that never ran. Its own reason, verbatim — never a shrug. */
function Missing({ absences, k }: { absences: ModuleAbsence[]; k: string }) {
  const absence = absences.find((a) => a.key === k);
  return (
    <Panel padding="var(--space-4)">
      <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, maxWidth: 660 }}>
        {absence?.reason ??
          "This session was ingested before this measurement existed. Re-ingesting it from the rig computes it from the same bytes."}
      </div>
    </Panel>
  );
}

/** One statistic card, or an em dash and the module's reason for it. */
function Stat({
  label,
  value,
  unit,
  bar,
  note,
  color = "var(--color-text)",
  i = 0,
}: {
  label: string;
  value: number | null;
  unit: string;
  bar: number | null;
  note: string;
  color?: string;
  i?: number;
}) {
  return (
    <Panel
      padding="var(--space-4)"
      style={{ animation: "fadeUp .4s both", animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s` }}
    >
      <Eyebrow size={9.5}>{label}</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
        <span
          className="num"
          style={{ font: "500 26px var(--font-heading)", color: value == null ? dim(35) : color }}
        >
          {value == null ? "—" : fixed(value, value >= 100 ? 0 : 2)}
        </span>
        <span style={{ fontSize: 10.5, color: dim(38) }}>{unit}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: dim(8), marginTop: "var(--space-3)", overflow: "hidden" }}>
        {bar != null && (
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, Math.min(100, bar))}%`,
              background: color,
              transformOrigin: "left",
              animation: "growX .6s cubic-bezier(.2,.8,.2,1) both",
              animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s`,
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(50), marginTop: "var(--space-2)" }}>
        {note}
      </div>
    </Panel>
  );
}

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
  gap: "var(--space-3)",
} as const;

/** Step 1: the driver's side of the chain — what was asked for, nothing else. */
function InputCards({ hw, ir }: { hw: HardwareData | null; ir: InputResponseData | null }) {
  const lock = ir?.steering.measured ? ir.steering.peak_steer_deg : null;
  return (
    <div style={GRID}>
      <Stat
        i={0}
        label="brake ceiling"
        value={hw?.brake_ceiling_pct ?? null}
        unit="% of pedal travel"
        bar={hw?.brake_ceiling_pct ?? null}
        note={
          hw?.brake_reason ??
          (hw?.brake_ceiling_pct == null
            ? "The hardware module did not run on this session."
            : `Your own maximum while moving${
                hw.stationary_ticks_excluded != null
                  ? `, with ${hw.stationary_ticks_excluded.toLocaleString()} stationary ticks excluded`
                  : ""
              } — not a limit of the pedal.`)
        }
      />
      <Stat
        i={1}
        label="most lock used"
        value={lock ?? null}
        unit="° of steering"
        bar={lock == null ? null : Math.min(100, (lock / 180) * 100)}
        note={
          lock == null
            ? "Not measured for this session."
            : "The most steering you asked for at any point while moving."
        }
      />
      <Stat
        i={2}
        label="pedal noise floor"
        value={hw?.pedal_noise.spike_ticks ?? null}
        unit={
          hw?.pedal_noise.qualifying_ticks != null
            ? `of ${hw.pedal_noise.qualifying_ticks.toLocaleString()} full-throttle ticks`
            : "spikes"
        }
        bar={
          hw?.pedal_noise.spike_ticks != null && hw.pedal_noise.qualifying_ticks
            ? (hw.pedal_noise.spike_ticks / hw.pedal_noise.qualifying_ticks) * 100
            : null
        }
        note={
          hw?.pedal_noise.reason ??
          (hw?.pedal_noise.max_spike != null
            ? `Peak reading ${hw.pedal_noise.max_spike} where the pedal should be silent.`
            : "Not measured for this session.")
        }
      />
      <Stat
        i={3}
        label="wheel against its stops"
        value={hw?.ffb.clipping_pct ?? null}
        unit="% of moving"
        bar={hw?.ffb.clipping_pct ?? null}
        color={CH.a}
        note={
          hw?.ffb.finding ??
          hw?.ffb.reason ??
          "While the wheel is saturated the force stops changing, so that detail never reached your hands."
        }
      />
    </div>
  );
}

/** Step 2: what came back changed. */
function ResponseRow({
  ir,
  hw,
  absences,
}: {
  ir: InputResponseData | null;
  hw: HardwareData | null;
  absences: ModuleAbsence[];
}) {
  if (!ir) return <Missing absences={absences} k="input_response" />;

  const abs = ir.brake.measured ? ir.brake.abs : undefined;
  const slip = ir.throttle.measured ? ir.throttle.slip : undefined;

  return (
    <>
      <div style={GRID}>
        <Stat
          i={0}
          label="braking with the ABS in"
          value={abs?.engaged_pct_of_braking ?? hw?.abs.engaged_pct_of_braking ?? null}
          unit="% of braking"
          bar={abs?.engaged_pct_of_braking ?? hw?.abs.engaged_pct_of_braking ?? null}
          color={CH.warn}
          note={
            abs?.finding ??
            hw?.abs.finding ??
            hw?.abs.reason ??
            "The share of your braking where the car was deciding the pressure, not your foot."
          }
        />
        <Stat
          i={1}
          label="pressure it took back"
          value={abs?.mean_cut_while_engaged_pct ?? null}
          unit="% while engaged"
          bar={abs?.mean_cut_while_engaged_pct ?? null}
          color={CH.warn}
          note={
            abs?.mean_cut_while_engaged_pct == null
              ? "The file records that it engaged, but not how much pressure it removed."
              : "Not the pedal failing — the car deciding the tyres could not hold what you asked for."
          }
        />
        <Stat
          i={2}
          label="a wheel ahead of the ground"
          value={slip?.share_of_on_power_pct ?? null}
          unit="% of time on power"
          bar={slip?.share_of_on_power_pct ?? null}
          color={CH.loss}
          note={
            slip?.finding ??
            (slip == null
              ? "Not measured for this session."
              : `At its worst a wheel was ${fixed(slip.peak_excess_pct, 0)}% ahead of the ground.`)
          }
        />
        <Stat
          i={3}
          label="deceleration per unit of pedal"
          value={(ir.brake.measured ? ir.brake.decel_per_pedal_g : null) ?? null}
          unit="g"
          bar={null}
          note={
            ir.brake.measured && ir.brake.decel_per_pedal_g != null
              ? "What a fully loaded pedal bought you this session — your own figure, not the car's rating."
              : "Not measured for this session."
          }
        />
      </div>
      <Caveat maxWidth={760} style={{ marginTop: "var(--space-3)" }}>{noteFor("input.response")}</Caveat>
    </>
  );
}

/** Step 3: the column, in newton-metres. */
function TorqueSection({
  cp,
  hw,
  absences,
}: {
  cp: ContactPatchData | null;
  hw: HardwareData | null;
  absences: ModuleAbsence[];
}) {
  if (!cp) return <Missing absences={absences} k="contact_patch" />;
  const t = cp.steerTorque;
  if (!t.measured) {
    return (
      <Panel padding="var(--space-4)">
        <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, maxWidth: 660 }}>
          {t.reason ?? "Column torque could not be read on this session."}
        </div>
      </Panel>
    );
  }

  const measured = t.bands.filter((b) => b.measured && b.median_torque_nm != null);
  const top = Math.max(1, ...measured.map((b) => b.median_torque_nm ?? 0));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "var(--space-4)" }}>
      <Panel
        title="Torque against lock"
        sub="how hard the front tyres pushed back"
        padding="var(--space-4)"
        foot={<Caveat>{noteFor("steer.torque")}</Caveat>}
      >
        {t.bands.map((b) => (
          <div key={b.band} style={{ marginBottom: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: dim(52), minWidth: 62 }}>{b.band}</span>
              <span className="num" style={{ fontSize: 12, color: b.measured ? "var(--color-text)" : dim(32) }}>
                {b.measured && b.median_torque_nm != null ? `${b.median_torque_nm.toFixed(1)} N·m` : "—"}
              </span>
              {!b.measured && (
                <span style={{ fontSize: 10, color: dim(30) }}>{b.reason}</span>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 3, background: dim(8), overflow: "hidden" }}>
              {b.measured && b.median_torque_nm != null && (
                <div
                  style={{
                    height: "100%",
                    width: `${(b.median_torque_nm / top) * 100}%`,
                    background: b.band === t.most_torque_band ? CH.a : dim(26),
                    animation: "growX .5s cubic-bezier(.2,.8,.2,1) both",
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {t.falloff_note && (
          <p style={{ margin: "var(--space-3) 0 0", fontSize: 12, lineHeight: 1.6, color: dim(64) }}>
            {t.falloff_note}
          </p>
        )}
      </Panel>

      <Panel title="What the wheel was doing" padding="var(--space-4)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "var(--space-4)" }}>
          <Figure label="peak torque" value={fixed(t.peak_torque_nm, 1)} unit="N·m" accent />
          <Figure label="median torque" value={fixed(t.median_torque_nm, 1)} unit="N·m" />
          {hw?.steerTorque.available && (
            <Figure
              label="at your own maximum"
              value={fixed(hw.steerTorque.at_own_max_pct, 2)}
              unit="% of moving"
            />
          )}
          {t.falloff_past_peak_nm != null && (
            <Figure label="falloff past peak" value={fixed(t.falloff_past_peak_nm, 2)} unit="N·m" />
          )}
        </div>
        <p style={{ margin: "var(--space-4) 0 0", fontSize: 12, lineHeight: 1.6, color: dim(60) }}>
          Force-feedback percentage is this same torque scaled to whatever your
          rig&apos;s range is set to, so it cannot be compared between sessions.
          Newton-metres can.
        </p>
      </Panel>
    </div>
  );
}

/** Step 5: the angle between pointing and going. */
function SlipSection({ cp, absences }: { cp: ContactPatchData | null; absences: ModuleAbsence[] }) {
  if (!cp) return <Missing absences={absences} k="contact_patch" />;

  const { slip, rotation, corners } = cp;
  if (!slip.measured) {
    return (
      <Panel padding="var(--space-4)">
        <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, maxWidth: 660 }}>
          {slip.reason ?? "Slip angle could not be read on this session."}
        </div>
      </Panel>
    );
  }

  const rows = corners.corners.filter((c) => c.measured && c.peak_slip_deg != null);
  const top = Math.max(0.1, ...rows.map((c) => c.peak_slip_deg ?? 0));

  return (
    <>
      <div style={GRID}>
        <Stat
          i={0}
          label="most slip angle"
          value={slip.peak_deg ?? null}
          unit="° between pointing and going"
          bar={slip.peak_deg == null ? null : Math.min(100, (slip.peak_deg / 15) * 100)}
          color={CH.a}
          note="Measured from the car's own velocity vector. Nothing here is fitted."
        />
        <Stat
          i={1}
          label="typical slip angle"
          value={slip.median_deg ?? null}
          unit="°"
          bar={slip.median_deg == null ? null : Math.min(100, (slip.median_deg / 15) * 100)}
          note="The middle of the whole session, straights included."
        />
        <Stat
          i={2}
          label="rotating more than the path"
          value={(rotation.measured ? rotation.rotated_more_than_path_pct : null) ?? null}
          unit="% of ticks"
          bar={(rotation.measured ? rotation.rotated_more_than_path_pct : null) ?? null}
          color={CH.b}
          note={
            rotation.measured
              ? "The car turning faster than a steady circular path through the same corner would need."
              : (rotation.reason ?? "Not measured for this session.")
          }
        />
        <Stat
          i={3}
          label="channels agree"
          value={(rotation.measured ? rotation.path_agreement : null) ?? null}
          unit="correlation"
          bar={
            rotation.measured && rotation.path_agreement != null
              ? Math.abs(rotation.path_agreement) * 100
              : null
          }
          note={
            rotation.path_agreement == null
              ? "One of the two channels held steady this session, so there is nothing to correlate."
              : "How closely the measured yaw rate tracks the one the path implies. Near 1 or -1 means this comparison is reading what it thinks it is."
          }
        />
      </div>

      <Caveat maxWidth={760} style={{ marginTop: "var(--space-3)" }}>{noteFor("slip.angle")}</Caveat>

      {rows.length > 0 && (
        <Evidence label="Show slip angle corner by corner" hint={`${rows.length} corners, pooled across every clean lap`}>
          <Panel
            title="Corner by corner"
            sub={corners.reference_lap != null ? `corners from lap ${corners.reference_lap}` : undefined}
            padding="var(--space-4)"
            foot={
              <Caveat>
                Every clean lap&apos;s ticks through each corner are pooled, so these
                describe the corner across the run rather than on any one lap. A
                corner high on this list is one the car was rotating more in — the
                file cannot say whether that was wanted.
              </Caveat>
            }
          >
            {rows.map((c) => (
              <div key={c.id} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 11.5, minWidth: 44 }}>Turn {c.id}</span>
                  <span className="num" style={{ fontSize: 12, color: CH.a }}>
                    {c.peak_slip_deg?.toFixed(2)}°
                  </span>
                  {c.peak_lock_deg != null && (
                    <span style={{ fontSize: 10.5, color: dim(38) }}>
                      at up to {c.peak_lock_deg.toFixed(0)}° of lock
                    </span>
                  )}
                  {c.peak_torque_nm != null && (
                    <span style={{ fontSize: 10.5, color: dim(38) }}>
                      · {c.peak_torque_nm.toFixed(1)} N·m back
                    </span>
                  )}
                </div>
                <div style={{ height: 6, borderRadius: 3, background: dim(8), overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${((c.peak_slip_deg ?? 0) / top) * 100}%`,
                      background: CH.a,
                      animation: "growX .5s cubic-bezier(.2,.8,.2,1) both",
                    }}
                  />
                </div>
              </div>
            ))}
          </Panel>
        </Evidence>
      )}

      {rows.length === 0 && corners.reason && (
        <Caveat maxWidth={760}>{corners.reason}</Caveat>
      )}
    </>
  );
}

/** The road itself. Small, but it changes what every braking figure means. */
function GradeSection({ cp }: { cp: ContactPatchData | null }) {
  const g = cp?.grade;
  if (!g?.measured) return null;

  const b = g.braking;
  return (
    <Panel
      title="The road under all of it"
      sub="slope, and what it did to your braking figures"
      padding="var(--space-4)"
      style={{ marginTop: "var(--space-6)" }}
      foot={<Caveat>{noteFor("grade.correction")}</Caveat>}
    >
      <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
        <Figure label="steepest climb" value={fixed(g.steepest_climb_pct, 2)} unit="%" />
        <Figure label="steepest descent" value={fixed(g.steepest_descent_pct, 2)} unit="%" />
        {b.measured && (
          <>
            <Figure label="peak braking, as measured" value={fixed(b.peak_decel_g_uncorrected, 2)} unit="g" />
            <Figure
              label="peak braking, hill removed"
              value={fixed(b.peak_decel_g_grade_corrected, 2)}
              unit="g"
              accent
            />
          </>
        )}
      </div>
      <p style={{ margin: "var(--space-4) 0 0", fontSize: 12, lineHeight: 1.6, color: dim(60), maxWidth: 760 }}>
        {b.measured
          ? "Both figures are shown because the uncorrected one is what every other panel in this app uses. The corrected one is what the brakes and tyres actually did once gravity is taken back out."
          : (b.reason ?? "No braking happened on a slope this session.")}
      </p>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grip
// ─────────────────────────────────────────────────────────────────────────────

function GripSection({ grip }: { grip: GripData }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "var(--space-4)" }}>
      <Panel
        title="How it is measured"
        sub="force sideways over force downwards"
        padding="var(--space-4)"
        foot={<Caveat>{noteFor("grip.mu")}</Caveat>}
      >
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            color: dim(66),
            background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
            borderRadius: "var(--radius-sm)",
            padding: "9px 11px",
            lineHeight: 1.7,
            marginBottom: "var(--space-3)",
          }}
        >
          grip = √(lateral² + longitudinal²) ÷ vertical
        </div>
        <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: "0 0 var(--space-3)" }}>
          All three are accelerometer channels the file already carries. The top
          is the force the tires were putting into the road; the bottom is the
          force pressing them into it — weight plus downforce plus whatever the
          kerbs added. The ratio is a friction coefficient, measured rather than
          modelled.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 135px), 1fr))", gap: "var(--space-3)" }}>
          <Figure label="peak grip" value={grip.session.peak_mu.toFixed(2)} unit="g per g" accent />
          <GripFigure
            label="peak lateral"
            g={grip.session.peak_lateral_g}
            ticks={grip.session.lateral_ticks}
            why={grip.session.lateral_reason}
          />
          <GripFigure
            label="peak braking"
            g={grip.session.peak_braking_g}
            ticks={grip.session.braking_ticks}
            why={grip.session.braking_reason}
          />
          <Figure label="median grip used" value={grip.session.median_mu.toFixed(2)} unit="g per g" />
          <GripFigure
            label="peak traction"
            g={grip.session.peak_traction_g}
            ticks={grip.session.traction_ticks}
            why={grip.session.traction_reason}
          />
          <Figure
            label="load at its peak"
            value={grip.session.peak_vertical_load_g.toFixed(2)}
            unit="g down"
          />
        </div>

        <div className="rule" style={{ "--fade": "20px", margin: "var(--space-4) 0 var(--space-3)" } as React.CSSProperties} />

        <Eyebrow size={9.5}>grip against speed</Eyebrow>
        <div style={{ marginTop: 7 }}>
          <SpeedBands grip={grip} />
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
        <GripLoadCurve grip={grip} />

        <Panel title="In plain English" padding="var(--space-4)">
          <Explain items={explainGrip(grip)} max={5} />
        </Panel>

        {grip.corners.length > 0 && (
          <Panel
            title="Grip corner by corner"
            sub="pooled across every clean lap"
            padding="var(--space-4)"
            foot={
              <Caveat>
                A corner low on this list is one where the car carried less force
                than it managed elsewhere. Whether that is the corner, the tires
                or the lap is not something one session can separate.
              </Caveat>
            }
          >
            <CornerGripBars grip={grip} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** A directional peak that the session may simply not contain enough of.
 *
 *  Renders the module's own reason instead of a number when the state was too
 *  rare to take a peak from — the figure it replaces used to be a hard 0.00,
 *  which reads as "the car never braked hard" rather than "you barely braked". */
function GripFigure({
  label,
  g,
  ticks,
  why,
}: {
  label: string;
  g: number | null;
  ticks: number;
  why: string | null;
}) {
  if (g == null) {
    return (
      <div>
        <Eyebrow size={9.5}>{label}</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
          <span style={{ font: "500 18px var(--font-heading)", color: dim(30) }}>&mdash;</span>
        </div>
        <div style={{ fontSize: 10, color: dim(38), lineHeight: 1.45, marginTop: 1 }}>
          {why ?? `only ${ticks} ticks`}
        </div>
      </div>
    );
  }
  return <Figure label={label} value={g.toFixed(2)} unit="g" />;
}

/* Grip against speed, in two columns rather than one.
 *
 * This used to plot the ratio alone, and the ratio FALLS with speed on any
 * winged car — so a reader saw "grip drops the faster I go" and had no way to
 * see the other half. Downforce does not raise the ratio; it raises the LOAD,
 * and load-sensitive rubber then returns a little less per unit of it. Both
 * columns together are the story; either one alone misleads.
 *
 * Two scales, so two sets of bars side by side with their own headers — never
 * one plot with two axes, which would invent a relationship between a ratio and
 * a force by whatever alignment the scales happened to land on.
 */
function SpeedBands({ grip }: { grip: GripData }) {
  const measured = grip.bands.filter((b) => b.measured && b.peak_mu != null);
  if (measured.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: dim(50) }}>
        No speed band carried enough ticks to measure grip in.
      </div>
    );
  }
  const muHi = Math.max(...measured.map((b) => b.peak_mu as number), 0.1);
  const loadHi = Math.max(
    ...measured.map((b) => b.median_vertical_load_g ?? 0),
    0.1,
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: 5 }}>
        <span style={{ width: 88 }} />
        <Eyebrow size={9} style={{ flex: 1, color: dim(38) }}>
          load pressing down
        </Eyebrow>
        <Eyebrow size={9} style={{ flex: 1, color: dim(38) }}>
          force back per g of load
        </Eyebrow>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {grip.bands.map((b) => (
          <div key={b.band} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ width: 88, fontSize: 10.5, color: dim(50), textAlign: "right" }}>
              {b.band}
            </span>
            <BandBar
              value={b.measured ? b.median_vertical_load_g ?? null : null}
              max={loadHi}
              color={CH.b}
              reason={b.reason}
            />
            <BandBar
              value={b.measured ? b.peak_mu ?? null : null}
              max={muHi}
              color={CH.a}
              reason={b.reason}
            />
          </div>
        ))}
      </div>

      {grip.downforce && (
        <p style={{ margin: "var(--space-3) 0 0", fontSize: 11, lineHeight: 1.55, color: dim(50) }}>
          {grip.downforce.downforce_note}. {grip.downforce.mu_note}.
        </p>
      )}
    </div>
  );
}

function BandBar({
  value,
  max,
  color,
  reason,
}: {
  value: number | null;
  max: number;
  color: string;
  reason?: string;
}) {
  return (
    <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
        {value != null && (
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${((value / max) * 100).toFixed(1)}%`,
              borderRadius: 5,
              background: color,
              transformOrigin: "left",
              animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
            }}
          />
        )}
      </span>
      <span
        className={value != null ? "num" : undefined}
        style={{
          width: 46,
          textAlign: "right",
          fontSize: 10.5,
          color: value != null ? dim(62) : dim(32),
        }}
        title={reason}
      >
        {value != null ? value.toFixed(2) : "—"}
      </span>
    </span>
  );
}

function CornerGripBars({ grip }: { grip: GripData }) {
  const rows = grip.corners.filter((c) => c.measured && c.peak_mu != null);
  if (rows.length === 0) {
    return <div style={{ fontSize: 11.5, color: dim(50) }}>No corner could be measured.</div>;
  }
  const hi = Math.max(...rows.map((r) => r.peak_mu as number), 0.1);

  return (
    <div className="scrollpane" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260 }}>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span style={{ width: 30, fontSize: 11, color: dim(60), fontWeight: 500 }}>T{r.id}</span>
          <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${(((r.peak_mu as number) / hi) * 100).toFixed(1)}%`,
                borderRadius: 5,
                background: CH.a,
                transformOrigin: "left",
                animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${(0.05 + i * 0.03).toFixed(2)}s`,
              }}
            />
          </span>
          <span className="num" style={{ width: 40, textAlign: "right", fontSize: 11, color: dim(62) }}>
            {(r.peak_mu as number).toFixed(2)}
          </span>
          <span style={{ width: 66, fontSize: 10, color: dim(36), textAlign: "right" }}>
            {r.radius_m != null ? `${r.radius_m} m` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <Eyebrow size={9}>{label}</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
        <span
          className="num"
          style={{ font: "500 17px var(--font-heading)", color: accent ? CH.a : "var(--color-text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 9.5, color: dim(36) }}>{unit}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slip events
// ─────────────────────────────────────────────────────────────────────────────

function SlipPanel({ kind, events }: { kind: "lockup" | "wheelspin"; events: TrackEvent[] }) {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const pattern = kind === "lockup" ? bundle.eventPatterns.lockup : bundle.eventPatterns.wheelspin;
  // `counts` in the module holds the true total; the event list is capped at 50
  // most-severe, so the two can legitimately disagree and the panel says which
  // number is which rather than quietly showing the shorter one as the total.
  const stored = pattern.measured && pattern.events != null ? pattern.events : events.length;
  const color = kind === "lockup" ? CH.loss : CH.warn;

  return (
    <Panel
      title={kind === "lockup" ? "Lockups" : "Wheelspin"}
      sub={`${events.length} shown`}
      padding="var(--space-4)"
      right={<CircleAlert size={14} strokeWidth={1.8} color={events.length ? color : dim(30)} />}
      foot={
        <Caveat>
          {kind === "lockup"
            ? "A lockup here is a wheel turning below half the car's ground speed while the brake pedal was loaded. The channels say when it happened and what was on the car; they cannot say why you were on the brake that hard."
            : "Wheelspin here is a wheel turning more than 10% faster than the ground while you were on power. The driven axle is not modelled, so this is whichever of the four ran away."}
        </Caveat>
      }
    >
      <div style={{ marginBottom: "var(--space-3)" }}>
        <Explain items={[explainPattern(pattern, kind, stored)]} />
      </div>

      {events.length > 0 && (
        <>
          {pattern.measured && pattern.wheel_counts && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
              {Object.entries(pattern.wheel_counts).map(([w, count]) => (
                <span
                  key={w}
                  className="tag tag-outline"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  title={`${wheelName(w)} was involved in ${count} of them`}
                >
                  {wheelName(w)} · {count}
                </span>
              ))}
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>lap</th>
                <th style={{ width: 56 }}>corner</th>
                <th>what was on the car</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 8).map((e, i) => {
                const corner = cornerFor(bundle.corners, e.pct);
                return (
                  <tr key={`${e.lap_number}-${e.pct}-${i}`}>
                    <td className="num">{e.lap_number}</td>
                    <td style={{ color }}>{corner ? `T${corner}` : `${(e.pct * 100).toFixed(0)}%`}</td>
                    <td style={{ color: dim(62), fontSize: 11, lineHeight: 1.5 }}>
                      {explainEvent(kind, e.inputs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {events.length > 8 && (
            <div style={{ fontSize: 10.5, color: dim(38), marginTop: 6 }}>
              The 8 most severe of {events.length} stored are listed. All of them are
              marked on the track map.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* An event is attributed to the corner it BELONGS to, not the corner whose
   geometry happens to contain it. A lockup lives in the braking zone, which is
   before the corner turns in, so matching on [start, end] alone leaves most
   lockups labelled "—". The lead-in below is the same padding the ledger uses. */
const LEAD_IN = 0.035;

function cornerFor(corners: { id: number; start_pct: number; end_pct: number }[], p: number) {
  return corners.find((c) => {
    const start = c.start_pct - LEAD_IN;
    // A corner near the start/finish line has a lead-in that wraps.
    return start < 0 ? p >= start + 1 || p <= c.end_pct : p >= start && p <= c.end_pct;
  })?.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// The g-g plot
// ─────────────────────────────────────────────────────────────────────────────

/** Ring spacing for the g-g plot.
 *
 *  A fixed 0.5 g step is right for a road car and wrong for anything that
 *  reaches 5 g: the labels stack on top of each other in the middle of the plot
 *  and none of them can be read. The step grows so the plot never carries more
 *  than five rings. */
function ringStep(maxG: number): number {
  if (maxG <= 2.5) return 0.5;
  if (maxG <= 5) return 1;
  return Math.ceil(maxG / 5);
}

function TractionCircle() {
  const { bundle } = useProctor();

  const geom = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (210 - 34) / maxG;
    const X = (lat: number) => 210 + lat * s;
    const Y = (lon: number) => 210 - lon * s;
    const rings: { r: number; g: number }[] = [];
    const step = ringStep(maxG);
    for (let g = step; g <= maxG; g += step) rings.push({ r: g * s, g });
    const poly = bundle.traction.envelope
      .map((e) => {
        const r = (e.angle_deg * Math.PI) / 180;
        return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
      })
      .join(" ");
    // Perimeter, so the polygon can draw itself.
    const pts = poly.split(" ").map((p) => p.split(",").map(Number));
    let len = 0;
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return { X, Y, rings, poly, len };
  }, [bundle]);

  if (!bundle || !geom) return null;

  if (bundle.traction.envelope.length === 0) {
    return (
      <Panel title="Everything you demonstrated" padding="var(--space-4)">
        <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6 }}>
          {bundle.absences.find((a) => a.key === "traction_circle")?.reason ??
            "No g-g envelope was computed for this session."}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Everything you demonstrated"
      sub="every sample of every clean lap"
      padding="var(--space-4)"
      foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}
    >
      <svg viewBox="0 0 420 420" style={{ width: "100%", height: 360, display: "block" }} aria-hidden>
        {geom.rings.map((r) => (
          <g key={r.g}>
            <circle cx={210} cy={210} r={r.r} fill="none" stroke={inkA(0.07)} />
            <text x={214} y={210 - r.r + 11} fill={inkA(0.26)} fontSize={9}>
              {r.g.toFixed(r.g < 10 ? 1 : 0)} g
            </text>
          </g>
        ))}
        <line x1={210} y1={20} x2={210} y2={400} stroke={inkA(0.07)} />
        <line x1={20} y1={210} x2={400} y2={210} stroke={inkA(0.07)} />

        {bundle.traction.scatter
          .filter((_, i) => i % 3 === 0)
          .map(([lat, lon], i) => (
            <circle key={i} cx={geom.X(lat)} cy={geom.Y(lon)} r={1.3} fill={CH.a} opacity={0.3} />
          ))}

        <polygon
          points={geom.poly}
          fill="none"
          stroke={CH.b}
          strokeWidth={1.8}
          style={
            {
              "--len": `${geom.len}px`,
              strokeDasharray: geom.len,
              strokeDashoffset: geom.len,
              animation: "drawIn 1.4s ease-out both",
              animationDirection: "reverse",
            } as React.CSSProperties
          }
        />

        <text x={216} y={30} fill={inkA(0.34)} fontSize={10}>accelerating</text>
        <text x={216} y={408} fill={inkA(0.34)} fontSize={10}>braking</text>
        <text x={22} y={202} fill={inkA(0.34)} fontSize={10}>left</text>
        <text x={366} y={202} fill={inkA(0.34)} fontSize={10}>right</text>
      </svg>
    </Panel>
  );
}

function EnvelopeBars() {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const rows = bundle.laps
    .filter(isUsable)
    .map((l) => ({ n: l.lap_number, v: bundle.traction.laps[l.lap_number] }))
    .filter((r): r is { n: number; v: number } => r.v != null);

  return (
    <Panel
      title="Envelope use, lap by lap"
      sub="share of your own session boundary reached"
      padding="var(--space-4)"
      right={<Gauge size={14} strokeWidth={1.7} color={dim(38)} />}
      foot={
        <Caveat>
          Bars are scaled 0–100%, not normalised to the best lap. A lap at 80%
          reads as 80% — normalising would make every session look the same at a
          glance, which is the opposite of useful. Laps the module could not score
          are left out rather than drawn at zero.
        </Caveat>
      }
    >
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: dim(58) }}>
          No clean lap could be scored against this session&apos;s envelope.
        </div>
      ) : (
        <div className="scrollpane" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 360 }}>
          {rows.map((r, i) => (
            <div key={r.n} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span className="num" style={{ width: 22, textAlign: "right", fontSize: 11, color: dim(50) }}>
                {r.n}
              </span>
              <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    // 0-100 of the axis, not of the maximum.
                    width: `${r.v.toFixed(1)}%`,
                    borderRadius: 5,
                    background: CH.a,
                    transformOrigin: "left",
                    animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${(0.1 + i * 0.03).toFixed(2)}s`,
                  }}
                />
              </span>
              <span className="num" style={{ width: 42, textAlign: "right", fontSize: 11, color: dim(62) }}>
                {fixed(r.v, 1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
