/* Anatomy: a prototype-class race car, exploded, with each of its systems
 * mapped to the piece of sim hardware that stands in for it at home.
 *
 * WHAT THE TEXT IN HERE IS. General reference about classes of hardware — what
 * a load-cell brake measures, the range direct-drive bases come in. It is the
 * same for every driver and every session. None of it is read from a rig or
 * from telemetry, and the screen that shows it says so. It lives in this
 * module, not in a screen's source, for the reason a catalogue would.
 *
 * WHAT THE CAR IS. An original prototype-class design drawn for this view. It
 * is not any maker's car and carries nobody's marks or lights.
 *
 * The model is public/anatomy/gtp_prototype.glb: 120 top-level nodes, one per
 * component, each named for what it is. EXPLODE_RULES turns those names into
 * "which part of the story is this, and where does it go when the car comes
 * apart". anatomy.test.ts opens the GLB and checks every node is claimed by a
 * rule, so a rebuilt model that renames or adds a component fails a test
 * instead of leaving a piece of car hanging in place while the rest moves. */

export type AnatomyPartId =
  | "rig"
  | "base"
  | "rim"
  | "pedals"
  | "seat"
  | "shifter"
  | "display"
  | "motion"
  | "pc";

/** A part of the story, or one of the two groups that are only context: the
 *  bodywork that lifts off, and the aero and floor that stay put. */
export type AnatomyGroupId = AnatomyPartId | "body" | "aero";

export interface AnatomyPart {
  id: AnatomyPartId;
  /** Short name, for chips and the tags that float over the car. */
  short: string;
  /** The sim hardware. */
  name: string;
  /** What it stands in for on the car. */
  car: string;
  /** The node the floating tag points at. */
  anchor: string;
  /** Where on that node's bounding box the tag points, 0..1 per axis. */
  anchorAt?: readonly [number, number, number];
  desc: string;
  specs: readonly (readonly [string, string])[];
}

export const ANATOMY_PARTS: readonly AnatomyPart[] = [
  {
    id: "rig",
    short: "Rig",
    name: "Rig & cockpit",
    car: "Carbon monocoque",
    anchor: "monocoque",
    anchorAt: [1, 0.55, 0.45],
    desc: "The rigid frame everything bolts to. Any flex here blurs force feedback and pedal feel, which is why serious rigs are built from aluminium profile rather than tube steel or a desk clamp.",
    specs: [
      ["Build", "Aluminium profile, 40×80 to 40×160 mm"],
      ["Must be", "Rigid under full wheel torque and hard braking"],
      ["Adjusts", "Seat, wheel and pedal positions independently"],
    ],
  },
  {
    id: "base",
    short: "Wheel base",
    name: "Direct-drive wheel base",
    car: "Steering rack",
    anchor: "steering_rack",
    desc: "A servo motor bolted straight to the wheel shaft. It reads your steering angle and pushes back with the forces the sim calculates through the rack — grip, weight transfer, kerbs and slides.",
    specs: [
      ["Torque", "≈5 Nm entry level to 25 Nm+ high end"],
      ["Drive", "Direct drive, belt or gear"],
      ["Mount", "Front or bottom mount, quick release"],
    ],
  },
  {
    id: "rim",
    short: "Rim",
    name: "Wheel rim",
    car: "Steering wheel & display",
    anchor: "steering_wheel",
    desc: "Swappable rims — formula, GT or round — clip onto the base through the quick release. Paddles, buttons and rotaries map to shifting, brake bias, traction control, hybrid deployment and the pit limiter.",
    specs: [
      ["Diameter", "≈270 mm formula to 350 mm round"],
      ["Inputs", "Shift and clutch paddles, buttons, encoders"],
      ["Extras", "Integrated dash display, RPM LEDs"],
    ],
  },
  {
    id: "pedals",
    short: "Pedals",
    name: "Load-cell pedals",
    car: "Brake discs & calipers",
    anchor: "front_left_brake_disc",
    desc: "On the car, braking is line pressure squeezing the calipers. A load-cell brake measures force, not travel, so muscle memory learns pressure rather than position — trail braking becomes repeatable lap after lap.",
    specs: [
      ["Brake", "Load cell, rated to 100 kg+ of force"],
      ["Throttle", "Hall-effect or potentiometer sensor"],
      ["Upgrades", "Hydraulic dampers, active pedals"],
    ],
  },
  {
    id: "seat",
    short: "Seat",
    name: "Bucket seat",
    car: "Driver seat",
    anchor: "seat",
    desc: "A fixed bucket keeps your body planted against the forces your hands and feet are feeling, and sets the eye point your screens and field of view are calibrated to.",
    specs: [
      ["Types", "Upright GT or reclined formula"],
      ["Mount", "Side brackets on slider rails"],
      ["Pairs with", "Seat movers, active belt tensioners"],
    ],
  },
  {
    id: "shifter",
    short: "Shifter",
    name: "Shifter & handbrake",
    car: "Gearbox & driveshafts",
    anchor: "gearbox",
    anchorAt: [0.5, 1, 0.2],
    desc: "Prototypes shift on paddles, but plenty of sim cars don’t. Side-mounted sequential or H-pattern shifters cover them, plus a handbrake for rally and drift — both bolt to the rig beside the seat.",
    specs: [
      ["Modes", "Sequential or H-pattern"],
      ["Handbrake", "Load cell or Hall sensor"],
      ["Mount", "Left or right of the seat"],
    ],
  },
  {
    id: "display",
    short: "Displays",
    name: "Displays & VR",
    car: "Windscreen, canopy & mirrors",
    anchor: "windscreen",
    desc: "Your windscreen and mirrors. Triple monitors fill peripheral vision, a single ultrawide saves space, and VR gives true depth for judging braking points and gaps in traffic.",
    specs: [
      ["Setups", "Single, ultrawide, triple or VR headset"],
      ["Refresh", "High refresh — 120 Hz and up"],
      ["Calibrate", "Field of view set from seat-to-screen distance"],
    ],
  },
  {
    id: "motion",
    short: "Motion",
    name: "Motion & haptics",
    car: "Suspension & tyres",
    anchor: "rear_left_tyre",
    desc: "Actuators under the rig pitch and roll you through braking and corners. Tactile transducers buzz the seat and pedals with road texture, ABS pulses and wheelspin.",
    specs: [
      ["Motion", "2 to 6 DOF actuator platforms"],
      ["Haptics", "Transducers on seat and pedals"],
      ["Signal", "Driven by live telemetry from the sim"],
    ],
  },
  {
    id: "pc",
    short: "PC",
    name: "Sim PC",
    car: "Hybrid power unit",
    anchor: "airbox",
    desc: "The engine room. It runs the physics, the tyre model and force feedback many times a second, and renders the view across every screen.",
    specs: [
      ["CPU", "Fast single-thread performance for physics"],
      ["GPU", "Sized to resolution — triples and VR need more"],
      ["I/O", "USB for every peripheral, ideally powered hubs"],
    ],
  },
];

/** "03", "09": position in the list, as the tags and the panel show it. */
export function partNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export const ANATOMY_MODEL_URL = "/anatomy/gtp_prototype.glb";

/* ── Coming apart ──────────────────────────────────────────────────────────
   One rule per family of components, first match wins. `part` is the part of
   the story the component belongs to, or null for context. `offset` is where
   it travels to, in metres, in the model's axes (x to the car's left, y up, z
   toward the nose); x is mirrored for a `_right` component. `order` staggers
   the departure: 0 leaves first. */

export interface ExplodeRule {
  test: RegExp;
  part: AnatomyPartId | null;
  offset: readonly [number, number, number];
  order: number;
}

export const EXPLODE_RULES: readonly ExplodeRule[] = [
  { test: /^(nose_cone|front_deck|headlight_)/, part: null, offset: [0.1, 2.7, 0.9], order: 0 },
  { test: /^front_crash/, part: null, offset: [0, 0.1, 1.5], order: 1 },
  { test: /^front_fender/, part: null, offset: [0.5, 2.75, 0.35], order: 0 },
  { test: /^door/, part: null, offset: [0.55, 3.0, 0], order: 0 },
  { test: /^sidepod/, part: null, offset: [0.6, 2.7, 0], order: 0 },
  { test: /^(rear_fender|rear_outlet)/, part: null, offset: [0.5, 2.75, -0.4], order: 0 },
  { test: /^(engine_cover|shark_fin|rear_deck)/, part: null, offset: [0, 3.0, -0.4], order: 0 },
  { test: /^roof_scoop/, part: null, offset: [0, 3.15, -0.2], order: 0 },
  { test: /^mirror/, part: "display", offset: [0.55, 3.35, 0.2], order: 1 },
  { test: /^cockpit_canopy/, part: "display", offset: [0, 3.4, 0.1], order: 1 },
  { test: /^windscreen/, part: "display", offset: [0, 3.55, 0.45], order: 1 },
  { test: /^rear_wing_endplate|^tail_light/, part: null, offset: [0.2, 3.1, -1.0], order: 1 },
  { test: /^rear_wing/, part: null, offset: [0, 3.1, -1.0], order: 1 },
  { test: /^(rain_light|rear_crash|diffuser)/, part: null, offset: [0, 0.1, -1.6], order: 1 },
  { test: /^splitter/, part: null, offset: [0, 0, 1.9], order: 1 },
  { test: /^(floor|skid_plank)/, part: null, offset: [0, 0, 0], order: 0 },
  { test: /^(monocoque|dashboard)/, part: "rig", offset: [0, 0.12, 0], order: 4 },
  { test: /^seat/, part: "seat", offset: [0, 0.95, -0.1], order: 3 },
  { test: /^steering_(wheel|display)/, part: "rim", offset: [0, 1.0, 0.55], order: 2 },
  { test: /^steering_rack/, part: "base", offset: [0, 0.35, 1.0], order: 3 },
  { test: /^(gearbox|bellhousing)/, part: "shifter", offset: [0, 0.3, -1.3], order: 3 },
  { test: /^driveshaft/, part: "shifter", offset: [0.35, 0.3, -1.3], order: 3 },
  { test: /^(engine_block|motor_generator)/, part: "pc", offset: [0, 0.3, -0.45], order: 3 },
  { test: /^cylinder_head/, part: "pc", offset: [0.2, 0.55, -0.45], order: 3 },
  { test: /^intake_plenum/, part: "pc", offset: [0, 0.75, -0.45], order: 3 },
  { test: /^airbox/, part: "pc", offset: [0, 0.95, -0.3], order: 3 },
  { test: /^turbo/, part: "pc", offset: [0.4, 0.3, -0.6], order: 3 },
  { test: /^exhaust/, part: "pc", offset: [0.3, 0.35, -0.9], order: 3 },
  { test: /^(radiator|coolant_pipe)/, part: "pc", offset: [0.7, 0.2, 0], order: 3 },
  { test: /^(hybrid_battery|high_voltage)/, part: "pc", offset: [-0.8, 0.1, 0.2], order: 3 },
  { test: /^fuel_cell/, part: "pc", offset: [0, 0.55, -0.15], order: 3 },
  { test: /_brake_(disc|caliper)$/, part: "pedals", offset: [0.8, 0.08, 0], order: 3 },
  { test: /_(tyre|rim)$/, part: "motion", offset: [1.35, 0.08, 0], order: 2 },
  { test: /_wheel_nut$/, part: "motion", offset: [1.7, 0.08, 0], order: 2 },
  { test: /_upright$/, part: "motion", offset: [0.35, 0.08, 0], order: 3 },
  { test: /_(wishbone|pushrod|rocker|damper|tie_rod|toe_link)$/, part: "motion", offset: [0.12, 0.08, 0], order: 4 },
];

/** Components that trail a dashed line back to where they came from. Drawing
 *  one for all 120 would be a net; these are the ones a reader follows. */
export const LEADER_NODES: ReadonlySet<string> = new Set([
  "nose_cone", "front_fender_left", "front_fender_right", "door_left", "door_right",
  "sidepod_left", "sidepod_right", "rear_fender_left", "rear_fender_right", "engine_cover",
  "cockpit_canopy", "windscreen", "rear_wing", "splitter", "diffuser", "seat", "steering_wheel",
  "steering_rack", "gearbox", "engine_block", "airbox", "monocoque", "mirror_left", "mirror_right",
  "front_left_tyre", "front_right_tyre", "rear_left_tyre", "rear_right_tyre",
  "front_left_brake_disc", "front_right_brake_disc", "rear_left_brake_disc", "rear_right_brake_disc",
]);

export interface Classified {
  group: AnatomyGroupId;
  /** Already mirrored for the component's side. */
  offset: [number, number, number];
  order: number;
  /** False when no rule claimed the component and it fell back to context. */
  matched: boolean;
}

/** Which group a component belongs to and where it goes. `tag` is the group
 *  the CAD model filed it under, which only decides between the two kinds of
 *  context. */
export function classify(name: string, tag?: string): Classified {
  const rule = EXPLODE_RULES.find((r) => r.test.test(name));
  const side = /_right/.test(name) ? -1 : 1;
  const off = rule ? rule.offset : ([0, 0, 0] as const);
  return {
    group: rule?.part ?? (tag === "bodywork" ? "body" : "aero"),
    // `|| 0`: a mirrored zero would otherwise be -0, which is no different to
    // the car and a surprise to anything that compares the two sides.
    offset: [off[0] * side || 0, off[1], off[2]],
    order: rule ? rule.order : 0,
    matched: !!rule,
  };
}

/* Each wave leaves a beat after the one before it, and the whole thing eases
   in and out. `g` is the master progress, 0 assembled to 1 apart. */
const STAGGER = 0.08;
const WAVES = 4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function explodeProgress(g: number, order: number): number {
  const t = g * (1 + STAGGER * WAVES) - order * STAGGER;
  return ease(Math.max(0, Math.min(1, t)));
}

/* ── Tags ──────────────────────────────────────────────────────────────────
   A tag hangs off its component on a short leader. With nine of them over a
   turning car they collide constantly, so each one tries a ladder of places —
   up and to the right first, then left, then further out, then below — and
   takes the first that is on the stage and clear of everything already placed.
   Finding nowhere is an answer too: the caller hides that tag for the frame. */

export type Rect = readonly [left: number, top: number, right: number, bottom: number];

export interface TagPlacement {
  /** Length of the leader, in pixels. */
  lead: number;
  /** The tag sits to the left of its point rather than the right. */
  left: boolean;
  /** The tag hangs below its point rather than standing above it. */
  down: boolean;
  rect: Rect;
}

export function tagRect(
  x: number,
  y: number,
  w: number,
  h: number,
  lead: number,
  left: boolean,
  down: boolean,
): Rect {
  const top = down ? y + lead - 3 : y - lead - h - 3;
  const bottom = down ? y + lead + h + 3 : y - lead + 3;
  return left ? [x - w - 6, top, x + 6, bottom] : [x - 6, top, x + w + 6, bottom];
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function placeTag(
  x: number,
  y: number,
  w: number,
  h: number,
  taken: readonly Rect[],
  stageW: number,
  stageH: number,
): TagPlacement | null {
  for (let k = 0; k < 12; k++) {
    const down = k >= 8;
    const lead = down ? 24 + Math.floor((k - 8) / 2) * (h + 6) : 30 + Math.floor(k / 2) * (h + 6);
    let left = k % 2 === 1;
    if (x + w + 16 > stageW) left = !left;
    const rect = tagRect(x, y, w, h, lead, left, down);
    if (rect[1] > 0 && rect[3] < stageH && !taken.some((t) => overlaps(rect, t))) {
      return { lead, left, down, rect };
    }
  }
  return null;
}
