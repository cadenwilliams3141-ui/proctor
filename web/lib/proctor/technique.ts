/* The second half, and the labelled one.
 *
 * ┌ WHY THIS IS A SEPARATE FILE ────────────────────────────────────────────┐
 * │ explain.ts states what the file showed and never says what to do with   │
 * │ the controls. That rule stands — it is not relaxed here, and explain.ts │
 * │ is not modified.                                                        │
 * │                                                                         │
 * │ What this file adds is the OTHER half, kept visibly apart: what the     │
 * │ shape a driver is looking at usually corresponds to, as a matter of     │
 * │ driving convention rather than as a reading of their telemetry. A       │
 * │ falling self-aligning torque past a certain amount of lock IS the front │
 * │ axle past its best slip angle — that is mechanics, true of any car with │
 * │ pneumatic tyres, and saying so teaches the driver to read their own     │
 * │ data. What it is NOT is a claim about what this driver should have done │
 * │ in that corner, because the file never recorded why they did anything.  │
 * │                                                                         │
 * │ Three rules keep the halves apart, and all three are enforced by tests: │
 * │                                                                         │
 * │ 1. A note is keyed off a FINDING, never off a raw number. If the        │
 * │    measurement did not resolve, no note appears. A note can therefore   │
 * │    never be the only thing on screen about a subject.                   │
 * │ 2. A note never quotes this driver's values. It describes the shape,    │
 * │    the measurement beside it supplies the size.                         │
 * │ 3. Every note carries LABEL, verbatim, wherever it is rendered. The     │
 * │    label is what makes this honest rather than a verdict in disguise,   │
 * │    so it is part of the data and not a styling choice.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { MATCHED_BAND_S } from "@/lib/proctor/channels";
import type { ContactPatchData, CornerLedger, InputResponseData } from "@/lib/proctor/types";
import { SECTION_LABEL } from "@/lib/proctor/types";

/** Rendered under every technique block, without exception. */
export const LABEL =
  "General technique, not a reading of your file. Proctor cannot see why you did what you did — this is what the shape above usually corresponds to.";

export interface TechniqueNote {
  /** What the shape means, mechanically. One or two sentences. */
  body: string;
  /** The measured finding this note hangs off, so the pairing is traceable. */
  because: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The front axle, read through the column
// ─────────────────────────────────────────────────────────────────────────────

export function techniqueForSteerTorque(cp: ContactPatchData | null): TechniqueNote[] {
  const t = cp?.steerTorque;
  if (!t?.measured) return [];
  const falloff = t.falloff_past_peak_nm;
  if (falloff == null || falloff <= 0 || !t.most_torque_band) return [];

  return [
    {
      because: `column torque peaked at ${t.most_torque_band} of lock and fell past it`,
      body:
        "A tyre's self-aligning torque rises with slip angle up to the point of peak grip and falls away beyond it. That is why a front end that is past its best goes light in the hands rather than heavy: the wheel is reporting the tyre, and the tyre has stopped gripping harder. The band where the torque turns over is conventionally read as where the front axle ran out.",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Slip angle
// ─────────────────────────────────────────────────────────────────────────────

export function techniqueForSlip(cp: ContactPatchData | null): TechniqueNote[] {
  const slip = cp?.slip;
  if (!slip?.measured || slip.peak_deg == null) return [];

  const notes: TechniqueNote[] = [
    {
      because: "slip angle was measured from the car's own velocity vector",
      body:
        "Slip angle is the difference between where a car points and where it goes, and it is what actually generates cornering force — a tyre at zero slip angle produces no side force at all. Some is therefore necessary rather than a mistake; the conventional question is not whether there is any, but whether it is arriving where the driver intended it to.",
    },
  ];

  const corners = cp?.corners;
  if (corners?.measured && corners.most_slip && corners.least_slip) {
    notes.push({
      because: `the corners differed in how much slip they were taken with (T${corners.most_slip.id} highest, T${corners.least_slip.id} lowest)`,
      body:
        "Corners taken with markedly different slip angles are usually being driven with different techniques rather than being different corners — a slower, tighter corner asks for rotation, a fast sweeper asks for stability. Comparing a corner against itself lap to lap tends to say more than comparing two corners against each other.",
    });
  }
  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// The pedals against what the car did with them
// ─────────────────────────────────────────────────────────────────────────────

export function techniqueForInputResponse(ir: InputResponseData | null): TechniqueNote[] {
  const notes: TechniqueNote[] = [];
  if (!ir) return notes;

  const abs = ir.brake?.measured ? ir.brake.abs : undefined;
  if (abs && abs.engaged_pct_of_braking != null && abs.engaged_pct_of_braking > 0) {
    notes.push({
      because: "the ABS took pressure back on some share of your braking",
      body:
        "ABS engaging means the pressure being asked for exceeded what the front tyres could hold at that moment. Conventionally it is treated as a ceiling being found rather than a fault: it is doing its job, but while it is modulating, the pedal is no longer the thing deciding how hard the car stops.",
    });
  }

  const slip = ir.throttle?.measured ? ir.throttle.slip : undefined;
  if (slip && slip.share_of_on_power_pct != null && slip.share_of_on_power_pct > 0) {
    notes.push({
      because: "a wheel ran ahead of the ground for some share of your time on power",
      body:
        "A driven wheel turning faster than the car is travelling is converting engine torque into heat and tyre wear instead of forward motion. Past a few percent of slip, most tyres deliver less drive, not more — which is why traction is usually described as something a car is given rather than something it is asked for.",
    });
  }

  const st = ir.steering;
  if (st?.measured && st.falloff_past_peak_g != null && st.falloff_past_peak_g > 0) {
    notes.push({
      because: "lateral grip stopped rising past your most productive steering band",
      body:
        "Once lateral force stops growing with lock, additional steering is adding slip angle without adding grip — the front tyres are past their peak. This is the same event the column torque reports, seen on the other axis, and the two agreeing is the strongest version of the finding.",
    });
  }
  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Where a lap went
// ─────────────────────────────────────────────────────────────────────────────

export function techniqueForLap(ledger: CornerLedger | null): TechniqueNote[] {
  if (!ledger) return [];
  const losses = ledger.corners.filter((c) => c.delta > MATCHED_BAND_S);
  if (!losses.length) return [];

  const worst = losses.reduce((w, c) => (c.delta > w.delta ? c : w));
  const where = SECTION_LABEL[worst.dominant];

  // dominant indexes SECTION_LABEL: 0 on entry, 1 to the apex, 2 apex out,
  // 3 on the exit. The first half of a corner is read differently from the
  // second, so the note splits at the apex rather than per section.
  const body =
    worst.dominant <= 1
      ? "Time lost on the way into a corner is conventionally studied before time lost on the way out, because entry sets the speed and the attitude everything after it inherits. A corner exit rarely improves on its own while the entry stays as it was."
      : "Time lost between the apex and the exit usually traces back to the state the car was in at the apex rather than to the exit itself — where it was pointing and how much of the road was left. That is why the exit is normally read together with the entry rather than on its own.";

  return [
    {
      because: `the largest single loss was Turn ${worst.corner.id}, ${where}`,
      body,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// The road under the car
// ─────────────────────────────────────────────────────────────────────────────

export function techniqueForGrade(cp: ContactPatchData | null): TechniqueNote[] {
  const g = cp?.grade;
  if (!g?.measured || !g.braking?.measured) return [];
  if (g.braking.difference_g == null || Math.abs(g.braking.difference_g) < 0.01) return [];

  return [
    {
      because: "the road's slope changed what the braking figure means",
      body:
        "Braking downhill costs distance that braking uphill does not, because gravity is working with the car rather than against it. Braking points are conventionally learned per corner for exactly this reason — the same pedal does not buy the same stop twice on a circuit with elevation.",
    },
  ];
}
