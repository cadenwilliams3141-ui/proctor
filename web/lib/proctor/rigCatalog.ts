/* A DEMO catalogue, so the rig builder can be tried before there is a real one.
 *
 * WHAT IT IS. A short, hand-picked list of sim hardware, a few per slot, so a
 * driver can walk the builder and put names against their rig. It was seeded
 * from the rig-builder mockup (docs/rig-3d/page/source_mockup.html) and widened
 * with the wheel-and-pedal sets people clamp to a desk.
 *
 * WHAT IT IS NOT.
 *
 *   - It is not complete. A product missing from here has not been added; that
 *     says nothing about whether it exists.
 *   - It is not verified. The makes and models are real products. The one-line
 *     `kind` beside each was written from general knowledge and has not been
 *     checked against the maker's own sheet. Anything that decides something
 *     must not read it.
 *   - It is not measured. Nothing here comes from a .ibt or from hardware, and
 *     picking a product does not change a single reading anywhere in the app.
 *
 * WHEN THE REAL ONE ARRIVES. Replace RIG_CATALOG, keep the ids stable or map
 * the old ones forward, and drop the "demo catalogue" tag from the screen. The
 * ids are what a driver's saved rig points at (see RigPrefs in rig.ts).
 *
 * Every screen that shows a row from here says it is a demo list. That is the
 * condition this file is allowed to exist on. */

import { RIG_NONE, RIG_SLOTS, type RigLayoutKey, type RigSlotKey } from "@/lib/proctor/rig";

export interface RigProduct {
  /** What a saved rig stores. Unique across the whole catalogue. */
  id: string;
  slot: RigSlotKey;
  /** Empty for an entry that is not a product, such as a driver's own desk. */
  make: string;
  model: string;
  /** One line on what kind of thing it is. Unverified: see the note above. */
  kind: string;
  /** The layouts this belongs to. Absent means it suits any of them. Only the
   *  frame differs by layout: a cockpit is not a wheel stand. */
  layouts?: readonly RigLayoutKey[];
}

export const RIG_CATALOG: readonly RigProduct[] = [
  // monitors
  { id: "lg-27gp850", slot: "monitors", make: "LG", model: "27GP850-B", kind: "27 inch · 16:9 · flat" },
  { id: "aoc-cu34g2x", slot: "monitors", make: "AOC", model: "CU34G2X", kind: "34 inch · 21:9 · curved" },
  { id: "dell-aw3423dw", slot: "monitors", make: "Dell", model: "AW3423DW", kind: "34 inch · 21:9 · curved" },
  { id: "samsung-g9", slot: "monitors", make: "Samsung", model: "Odyssey G9", kind: "49 inch · 32:9 · curved" },

  // wheelbase
  { id: "logitech-g923", slot: "wheelbase", make: "Logitech", model: "G923", kind: "gear drive · clamps to a desk" },
  { id: "thrustmaster-t300", slot: "wheelbase", make: "Thrustmaster", model: "T300 RS", kind: "belt drive · clamps to a desk" },
  { id: "fanatec-csl-dd", slot: "wheelbase", make: "Fanatec", model: "CSL DD", kind: "direct drive" },
  { id: "moza-r5", slot: "wheelbase", make: "Moza", model: "R5", kind: "direct drive" },
  { id: "simagic-alpha-mini", slot: "wheelbase", make: "Simagic", model: "Alpha Mini", kind: "direct drive" },
  { id: "moza-r12", slot: "wheelbase", make: "Moza", model: "R12", kind: "direct drive" },
  { id: "fanatec-cs-dd-plus", slot: "wheelbase", make: "Fanatec", model: "ClubSport DD+", kind: "direct drive" },
  { id: "simucube-2-pro", slot: "wheelbase", make: "Simucube", model: "2 Pro", kind: "direct drive" },
  { id: "asetek-invicta", slot: "wheelbase", make: "Asetek", model: "Invicta", kind: "direct drive" },

  // rim
  { id: "rim-with-wheelbase", slot: "rim", make: "", model: "The one that came with the wheelbase", kind: "for a wheel sold as one piece" },
  { id: "moza-es", slot: "rim", make: "Moza", model: "ES", kind: "round" },
  { id: "simagic-gt-neo", slot: "rim", make: "Simagic", model: "GT Neo", kind: "GT" },
  { id: "fanatec-bmw-m4-gt3", slot: "rim", make: "Fanatec", model: "Podium BMW M4 GT3", kind: "GT" },
  { id: "cube-formula-pro", slot: "rim", make: "Cube Controls", model: "Formula Pro", kind: "formula" },
  { id: "ascher-f28-sc", slot: "rim", make: "Ascher Racing", model: "F28-SC", kind: "formula" },

  // pedals
  { id: "logitech-g923-pedals", slot: "pedals", make: "Logitech", model: "G923 pedals", kind: "came with the wheel" },
  { id: "thrustmaster-t-lcm", slot: "pedals", make: "Thrustmaster", model: "T-LCM", kind: "load cell brake" },
  { id: "fanatec-cs-v3", slot: "pedals", make: "Fanatec", model: "ClubSport V3", kind: "load cell brake" },
  { id: "moza-crp", slot: "pedals", make: "Moza", model: "CRP", kind: "load cell brake" },
  { id: "heusinkveld-sprint", slot: "pedals", make: "Heusinkveld", model: "Sprint", kind: "load cell brake" },
  { id: "asetek-forte", slot: "pedals", make: "Asetek", model: "Forte", kind: "load cell brake" },
  { id: "simucube-activepedal", slot: "pedals", make: "Simucube", model: "ActivePedal", kind: "active force feedback" },

  // shifter
  { id: "logitech-df-shifter", slot: "shifter", make: "Logitech", model: "Driving Force Shifter", kind: "H-pattern" },
  { id: "thrustmaster-th8a", slot: "shifter", make: "Thrustmaster", model: "TH8A", kind: "H-pattern and sequential" },
  { id: "fanatec-sq-v15", slot: "shifter", make: "Fanatec", model: "ClubSport SQ V1.5", kind: "H-pattern and sequential" },
  { id: "simagic-ds-8x", slot: "shifter", make: "Simagic", model: "DS-8X", kind: "H-pattern and sequential" },
  { id: "heusinkveld-sequential", slot: "shifter", make: "Heusinkveld", model: "Sequential", kind: "sequential" },

  // handbrake
  { id: "thrustmaster-tss", slot: "handbrake", make: "Thrustmaster", model: "TSS Handbrake Sparco Mod+", kind: "handbrake and sequential shifter" },
  { id: "fanatec-cs-handbrake", slot: "handbrake", make: "Fanatec", model: "ClubSport Handbrake V1.5", kind: "handbrake" },
  { id: "moza-hbp", slot: "handbrake", make: "Moza", model: "HBP", kind: "handbrake" },
  { id: "heusinkveld-handbrake", slot: "handbrake", make: "Heusinkveld", model: "Handbrake", kind: "handbrake" },

  // frame and seat, by layout
  { id: "own-desk", slot: "frame", make: "", model: "My own desk and chair", kind: "nothing to pick: the desk is the frame", layouts: ["desk"] },
  { id: "nlr-wheel-stand-2", slot: "frame", make: "Next Level Racing", model: "Wheel Stand 2.0", kind: "folding stand", layouts: ["stand"] },
  { id: "gt-omega-apex", slot: "frame", make: "GT Omega", model: "APEX", kind: "folding stand", layouts: ["stand"] },
  { id: "trak-racer-fs3", slot: "frame", make: "Trak Racer", model: "FS3", kind: "folding stand", layouts: ["stand"] },
  { id: "playseat-trophy", slot: "frame", make: "Playseat", model: "Trophy", kind: "tubular frame with a fabric seat", layouts: ["cockpit"] },
  { id: "nlr-gttrack", slot: "frame", make: "Next Level Racing", model: "GTTrack", kind: "tubular steel", layouts: ["cockpit"] },
  { id: "trak-racer-tr160", slot: "frame", make: "Trak Racer", model: "TR160", kind: "aluminium profile", layouts: ["cockpit"] },
  { id: "sim-lab-p1x", slot: "frame", make: "Sim-Lab", model: "P1X", kind: "aluminium profile", layouts: ["cockpit"] },
];

/** What can go in a slot on a rig of this layout, in catalogue order. */
export function productsFor(slot: RigSlotKey, layout: RigLayoutKey): RigProduct[] {
  return RIG_CATALOG.filter((p) => p.slot === slot && (!p.layouts || p.layouts.includes(layout)));
}

/** A product's name as one line. */
export function productName(p: RigProduct): string {
  return p.make ? `${p.make} ${p.model}` : p.model;
}

/** What the driver has said about a slot, once the saved id has been checked
 *  against the catalogue. */
export type RigChoice =
  | { state: "unset" }
  | { state: "none" }
  | { state: "product"; product: RigProduct };

/* An id is only as good as the catalogue it was saved against. One that is
   unknown here, belongs to a different slot, or is a frame for a different
   layout reads as "has not said" rather than as a product the driver did not
   pick. The saved id is left alone, so switching the layout back brings a
   frame choice back with it. */
export function rigChoice(slot: RigSlotKey, layout: RigLayoutKey, id: string | null): RigChoice {
  if (id == null) return { state: "unset" };
  if (id === RIG_NONE) {
    return RIG_SLOTS.some((s) => s.key === slot && s.optional) ? { state: "none" } : { state: "unset" };
  }
  const product = productsFor(slot, layout).find((p) => p.id === id);
  return product ? { state: "product", product } : { state: "unset" };
}
