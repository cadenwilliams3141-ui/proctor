/* Where each number on screen actually comes from.
 *
 * The product rule is that limits and ideals come from the driver's own data
 * and are LABELLED AS SUCH. This module is that labelling, in one place, so a
 * panel cannot quietly present a UI-side inference as something the file said.
 *
 * `measured`  the .ibt carries it; the parser read it.
 * `derived`   computed here from measured channels. True, but ours, not the
 *             file's — and it must say so wherever it is shown.
 * `awaited`   the redesign needs it and the parser does not emit it yet. The
 *             UI approximates it and flags the approximation.
 * `absent`    no channel exists. Reported absent, never estimated.
 */

export type Provenance = "measured" | "derived" | "awaited" | "absent";

export interface FieldNote {
  provenance: Provenance;
  /** Shown to the user, verbatim, wherever the field appears. */
  note: string;
}

export const FIELD_PROVENANCE: Record<string, FieldNote> = {
  "corner.sections": {
    provenance: "awaited",
    note: "Per-corner sub-section deltas are split here from the delta trace. corner_sections.per_lap already carries them for the reference lap; the parser does not yet emit them for an arbitrary lap pair.",
  },
  "corner.remainder": {
    provenance: "derived",
    note: "The lap gap minus the sum of the corner gaps. What is left went to the parts of the lap that are not corners.",
  },
  "corner.radius_m": {
    provenance: "derived",
    note: "Corner radius and direction are fitted to the recorded GPS path of your reference lap — the radius your line took through the corner, not the track's surveyed radius. If the parser starts emitting them, its values are used instead.",
  },
  "corner.boundaries": {
    provenance: "derived",
    note: "Corner boundaries come from the reference lap's own curvature.",
  },
  "traction.envelope": {
    provenance: "derived",
    note: "The boundary is the outer edge of what you demonstrated this session — not a physics limit. Each 10° bin takes the 98th percentile of the g there, then a ±10° rolling maximum closes the gaps a thin bin would otherwise cut into it. Treat it as a boundary estimate rather than an exact edge.",
  },
  "traction.lapUtilisation": {
    provenance: "measured",
    note: "Percentage of this session's own envelope each lap reached. Bars are scaled 0–100%, not to the best lap.",
  },
  "tire.left_front": {
    provenance: "measured",
    note: "Left-front is the only tire-temperature channel the .ibt carries, so the other three corners are reported absent rather than estimated.",
  },
  "tire.other_corners": {
    provenance: "absent",
    note: "No channel exists for the other three tires. Nothing is shown for them.",
  },
  "brake.temperature": {
    provenance: "absent",
    note: "The .ibt carries no brake-temperature channel at all — only line pressure. No brake-temp reading is shown anywhere in this app.",
  },
  "brake.ceiling": {
    provenance: "measured",
    note: "Your own maximum brake application while moving, not a hardware limit. Samples below 5 m/s are excluded because the sim forces brake to 1.0 when stopped.",
  },
  "lap.reference": {
    provenance: "measured",
    note: "The reference is your own fastest clean lap of this session, so a gap here is a difference from something you have already done — not from a target.",
  },
  "live.sweep": {
    provenance: "derived",
    note: "Position over time, reconstructed from your own speed channel: the grid is evenly spaced in distance, so the time to cross each step is that step divided by the speed you were doing, and the running total is scaled onto the lap time actually recorded. At 1× the marker reaches each point of the circuit at the moment you reached it. It is a replay of where the car was, not a re-simulation — between two stored samples the position is interpolated.",
  },
  "grip.mu": {
    provenance: "measured",
    note: "Horizontal force over vertical force, both read from the accelerometers at the same instant. This is the grip you USED, not the grip the tires had — a careful lap reads low because you asked for less. One accelerometer means it is a whole-car figure and cannot name a single tire, and the vertical channel carries downforce and bumps as well as weight.",
  },
  "input.response": {
    provenance: "measured",
    note: "Both sides of each control are recorded: the pedal sensor under your foot and the pressure the car applied, the throttle you asked for and the wheel speeds that resulted, the lock you turned and the lateral force that came back. The gap between them is measured, not inferred.",
  },
  "stint.trend": {
    provenance: "derived",
    note: "A drift across the laps of one run, fitted over your clean laps in the order you drove them. It names no cause: tires, brakes, fuel load, track surface and simply learning the lap all move these numbers, and one session cannot separate them.",
  },
  "track.width": {
    provenance: "derived",
    note: "The band between your leftmost and rightmost line across the clean laps of this session, measured perpendicular to your reference lap. It is the road YOU used — the .ibt carries no kerbs, white lines or surveyed track edges, so where the band is narrow you were repeatable, not hemmed in.",
  },
  "racecraft": {
    provenance: "absent",
    note: "Racecraft and positioning need other-car channels the disk .ibt does not carry. Not possible from this data — and it will not be faked.",
  },
};

export function noteFor(key: string): string {
  return FIELD_PROVENANCE[key]?.note ?? "";
}
