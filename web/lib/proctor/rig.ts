/* The rig's mounting slots, the layouts a rig comes in, and the arithmetic the
 * 3D view needs that is worth testing without a GPU.
 *
 * The slots are the seven places hardware bolts on. They are a fixed list, not
 * data: which PRODUCT sits in a slot is something Proctor cannot record yet, and
 * nothing in a .ibt identifies the hardware that produced a channel. So this
 * module names the slots and says nothing about what is in them.
 *
 * `node` is the name of the slot's node in each layout's model under
 * public/rig/. The models are built by docs/rig-3d/blender/build_rig.py, and
 * rig.test.ts opens every one of them and checks these names against it — a
 * rebuilt model that renames a node fails a test instead of drawing a rig with a
 * part that cannot be clicked. */

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

/* ── Layouts ───────────────────────────────────────────────────────────────
   Not everyone has a cockpit. Plenty of people drive from a desk with the wheel
   clamped to its edge, or from a stand that folds away afterwards. These are
   three drawings of how a rig is put together, not three records of anyone's
   rig: picking one changes the picture and nothing else.

   Every layout has the same seven slots, in different places. The two side
   screens — and on a freestanding stand, the wings that carry them — are child
   nodes whose names end `_side`, so one model serves both a single screen and
   triples. */

export type RigLayoutKey = "desk" | "stand" | "cockpit";
export type RigScreens = "single" | "triple";

/** A direction to stand in, relative to what is being looked at: x to the
 *  driver's right, y up, and the driver faces -z. */
type Direction = readonly [number, number, number];

export interface RigLayout {
  key: RigLayoutKey;
  label: string;
  /** One line on what the layout is, for the panel's subtitle. */
  blurb: string;
  model: string;
  /** Top-down soft shadow of the rig, laid on the floor under it. */
  shadow: string;
  /** A render of the layout from the home camera, shown while the 3D loads. */
  poster: string;
  /** How the layout is usually set up, which is also what its poster shows. */
  screens: RigScreens;
  /** Where to look at a slot from. A slot without an entry is shown from home.
   *  These differ by layout because what is in the way differs: a desk top hides
   *  the pedals from above, and a chair back hides the wheel from behind. */
  vantage: Partial<Record<RigSlotKey, Direction>>;
}

const files = (key: RigLayoutKey) => ({
  model: `/rig/${key}.glb`,
  shadow: `/rig/${key}-floor.png`,
  poster: `/rig/${key}.jpg`,
});

export const RIG_LAYOUTS: readonly RigLayout[] = [
  {
    key: "desk",
    label: "Desk",
    blurb: "wheel, shifter and handbrake clamped to a desk, pedals on the floor",
    ...files("desk"),
    screens: "single",
    vantage: {
      wheelbase: [-0.5, 0.95, 0.35],
      rim: [-0.8, 0.4, 0.75],
      // from beside the chair, low enough to see under the desk and clear of its legs
      pedals: [-0.6, 0.28, 1.0],
      shifter: [0.9, 0.45, 0.9],
      handbrake: [-0.9, 0.45, 0.9],
    },
  },
  {
    key: "stand",
    label: "Wheel stand",
    blurb: "a folding stand that carries the wheel, pedals and shifter",
    ...files("stand"),
    screens: "single",
    vantage: {
      wheelbase: [-0.5, 0.95, 0.35],
      rim: [-0.8, 0.4, 0.75],
      pedals: [0.55, 0.62, -1.0],
      shifter: [0.9, 0.45, 0.9],
      handbrake: [-0.9, 0.45, 0.9],
    },
  },
  {
    key: "cockpit",
    label: "Cockpit",
    blurb: "an aluminium profile frame with a bucket seat",
    ...files("cockpit"),
    screens: "triple",
    vantage: {
      wheelbase: [-0.95, 0.62, -0.55],
      rim: [-0.45, 0.42, 1.0],
      pedals: [0.55, 0.62, -1.0],
      shifter: [0.9, 0.45, 0.9],
      handbrake: [-0.9, 0.45, 0.9],
    },
  },
];

export const DEFAULT_RIG_LAYOUT: RigLayoutKey = "cockpit";

export function rigLayout(key: RigLayoutKey): RigLayout {
  // The fallback cannot be reached through the type; it is here so a caller is
  // never handed undefined if the list and the type ever drift apart.
  return RIG_LAYOUTS.find((l) => l.key === key) ?? RIG_LAYOUTS[RIG_LAYOUTS.length - 1];
}

/** True for a node that only exists when there are three screens. */
export function isSideNode(name: string): boolean {
  return name.endsWith("_side");
}

/* ── Remembering the choice ────────────────────────────────────────────────
   Which layout, and how many screens in each, kept in this browser's own
   storage. It is a preference about a drawing, so it does not need a database
   and does not follow the driver to another device. Whatever comes back out of
   storage is treated as untrusted: it may be from an older version, or not
   written by this app at all. */

export interface RigPrefs {
  layout: RigLayoutKey;
  screens: Record<RigLayoutKey, RigScreens>;
}

export const RIG_PREFS_KEY = "proctor-rig-layout";

export function defaultRigPrefs(): RigPrefs {
  const screens = {} as Record<RigLayoutKey, RigScreens>;
  for (const l of RIG_LAYOUTS) screens[l.key] = l.screens;
  return { layout: DEFAULT_RIG_LAYOUT, screens };
}

export function parseRigPrefs(raw: string | null | undefined): RigPrefs {
  const prefs = defaultRigPrefs();
  if (!raw) return prefs;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof saved !== "object" || saved === null) return prefs;
  const { layout, screens } = saved as { layout?: unknown; screens?: unknown };
  if (RIG_LAYOUTS.some((l) => l.key === layout)) prefs.layout = layout as RigLayoutKey;
  if (typeof screens === "object" && screens !== null) {
    for (const l of RIG_LAYOUTS) {
      const s = (screens as Record<string, unknown>)[l.key];
      if (s === "single" || s === "triple") prefs.screens[l.key] = s;
    }
  }
  return prefs;
}

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
