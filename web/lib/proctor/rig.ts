/* The rig's mounting slots, and the arithmetic the 3D view needs that is worth
 * testing without a GPU.
 *
 * The slots are the seven places hardware bolts on. They are a fixed list, not
 * data: which PRODUCT sits in a slot is something Proctor cannot record yet, and
 * nothing in a .ibt identifies the hardware that produced a channel. So this
 * module names the slots and says nothing about what is in them.
 *
 * `node` is the name of the slot's node in public/rig/proctor_rig.glb. The
 * model is built by docs/rig-3d/blender/build_rig.py, and rig.test.ts opens the
 * GLB and checks these names against it — a rebuilt model that renames a node
 * fails a test instead of drawing a rig with a part that cannot be clicked. */

export type RigSlotKey =
  | "monitors"
  | "wheelbase"
  | "rim"
  | "pedals"
  | "shifter"
  | "handbrake"
  | "frame";

export interface RigSlot {
  key: RigSlotKey;
  label: string;
  node: string;
}

export const RIG_SLOTS: readonly RigSlot[] = [
  { key: "monitors", label: "Monitors", node: "slot_monitors" },
  { key: "wheelbase", label: "Wheelbase", node: "slot_wheelbase" },
  { key: "rim", label: "Wheel rim", node: "slot_rim" },
  { key: "pedals", label: "Pedals", node: "slot_pedals" },
  { key: "shifter", label: "Shifter", node: "slot_shifter" },
  { key: "handbrake", label: "Handbrake", node: "slot_handbrake" },
  { key: "frame", label: "Frame & seat", node: "slot_frame" },
];

/** The driver's eye point, as an empty node in the model. The seat view stands
 *  here, and the picture on the screens is projected from here. */
export const RIG_EYE_NODE = "anchor_eye";

export const RIG_MODEL_URL = "/rig/proctor_rig.glb";
export const RIG_FLOOR_SHADOW_URL = "/rig/floor_ao.png";
export const RIG_POSTER_URL = "/rig/poster.jpg";

/* ── Captions ──────────────────────────────────────────────────────────────
   Seven captions float over the model, and from most angles several of them
   land on top of each other: the rim, the wheelbase and the pedals are in a
   line when you stand behind the seat. Overlapping text is unreadable text, so
   a caption that would collide with one already placed is dropped for that
   frame. The selected slot is placed first, which is the only ordering that
   matters — the caption you asked about must not be the one that loses. */

export interface CaptionPoint<K extends string> {
  key: K;
  /** Stage pixels from the top-left corner. */
  x: number;
  y: number;
  /** Higher places first. 0 is an ordinary caption. */
  rank: number;
}

/** Below this stage width there is room for the selected slot's caption and
 *  nothing else. */
export const COMPACT_STAGE_PX = 420;

const CAPTION_W = 62;
const CAPTION_H = 20;

export function placeCaptions<K extends string>(
  points: readonly CaptionPoint<K>[],
  width: number,
  height: number,
): Set<K> {
  const shown = new Set<K>();
  const placed: { x: number; y: number }[] = [];
  const compact = width < COMPACT_STAGE_PX;

  // Array.prototype.sort is stable, so equal ranks keep the order they came in.
  for (const p of [...points].sort((a, b) => b.rank - a.rank)) {
    if (p.x < 8 || p.x > width - 8 || p.y < 14 || p.y > height - 8) continue;
    if (compact && p.rank === 0) continue;
    if (placed.some((q) => Math.abs(q.x - p.x) < CAPTION_W && Math.abs(q.y - p.y) < CAPTION_H)) {
      continue;
    }
    placed.push({ x: p.x, y: p.y });
    shown.add(p.key);
  }
  return shown;
}

/* ── Framing ───────────────────────────────────────────────────────────────
   The home view is composed for a 16:10 stage. A narrower stage would crop the
   side screens off, so the camera backs away instead. Never closer than the
   composed distance: a wider stage just gets more floor. */

export const DESIGN_ASPECT = 16 / 10;

export function pullBack(aspect: number): number {
  if (!(aspect > 0)) return 1;
  return Math.max(1, Math.pow(DESIGN_ASPECT / aspect, 0.9));
}

/** How far back a camera with this vertical field of view has to stand for a
 *  sphere of `radius` to fit, with a little air around it. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const half = (fovDeg * Math.PI) / 360;
  return (radius / Math.sin(half)) * 1.05 * pullBack(aspect);
}
