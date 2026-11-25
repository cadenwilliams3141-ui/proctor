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
 * rather than printing a number. *
 * YOUR EQUIPMENT sits after the chain, unnumbered, because it is not part of
 * it: the brake sensor reading while your foot was on the throttle, and the
 * wheel clipping at its limit, are the rig talking — not you, not the car.
 * It replaced a "worth keeping an eye on" panel that repeated two cards
 * from step 01 word for word. */

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
  explainTrailSession,
  wheelName,
} from "@/lib/proctor/explain";
import { equipmentReadings } from "@/lib/proctor/equipment";
import { fixed } from "@/lib/proctor/format";
import { brakeCeiling } from "@/lib/proctor/pedals";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import {
  Missing,
  Stat,
  InputCards,
  EquipmentCards,
  ResponseRow,
  TorqueSection,
  SlipSection,
  GradeSection,
  GripSection,
  GripFigure,
  SpeedBands,
  BandBar,
  CornerGripBars,
  Figure,
  SlipPanel,
  cornerFor,
  ringStep,
  TractionCircle,
  EnvelopeBars,
} from "@/components/proctor/panels/ForcesPanels";
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
    "hardware", // → the equipment section's Missing, always rendered
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
  /* Three sentences, one per subject: the grip, what the electronics did with
     the brake, and how the brake met the steering on the way into corners.
     Deceleration per unit of pedal used to be the third; it still has its own
     card in step 02, so nothing measured left the screen. */
  const trailLine = bundle.trailBraking ? explainTrailSession(bundle.trailBraking) : null;
  const answer = [
    ...(grip ? explainGrip(grip).slice(0, 1) : []),
    ...(ir ? explainInputResponse(ir).slice(0, trailLine ? 1 : 2) : []),
    ...(trailLine ? [trailLine] : []),
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
        <ResponseRow ir={ir} absences={bundle.absences} />
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

      {/* ── Your equipment ──────────────────────────────────────────────────
          Every tier. A pedal sending signals that were not the driver is the
          one thing on this screen about the rig rather than the lap, and it is
          what a driver needs to hear about before trusting step 01. */}
      <Step title="Your equipment" sub="signals from the rig, not from you">
        <EquipmentCards hw={hw} absences={bundle.absences} />
      </Step>

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
