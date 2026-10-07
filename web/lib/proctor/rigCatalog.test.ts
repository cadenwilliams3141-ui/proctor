import { describe, expect, it } from "vitest";

import { RIG_LAYOUTS, RIG_NONE, RIG_SLOTS, parseRigPrefs } from "@/lib/proctor/rig";
import { RIG_CATALOG, productName, productsFor, rigChoice } from "@/lib/proctor/rigCatalog";

const optional = RIG_SLOTS.filter((s) => s.optional).map((s) => s.key);
const required = RIG_SLOTS.filter((s) => !s.optional).map((s) => s.key);

describe("the demo catalogue", () => {
  it("gives every product an id of its own", () => {
    const ids = RIG_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never uses the word that means an empty slot as an id", () => {
    expect(RIG_CATALOG.map((p) => p.id)).not.toContain(RIG_NONE);
  });

  it("puts every product in a slot that exists, with a name and a line about it", () => {
    const slots = new Set<string>(RIG_SLOTS.map((s) => s.key));
    for (const p of RIG_CATALOG) {
      expect(slots.has(p.slot), p.id).toBe(true);
      expect(p.model.trim(), p.id).not.toBe("");
      expect(p.kind.trim(), p.id).not.toBe("");
    }
  });

  it("has something to pick for every slot in every layout", () => {
    for (const l of RIG_LAYOUTS) {
      for (const s of RIG_SLOTS) {
        expect(productsFor(s.key, l.key).length, `${s.label} on ${l.label}`).toBeGreaterThan(0);
      }
    }
  });

  it("ties every frame to a layout, and nothing else", () => {
    const layouts = new Set<string>(RIG_LAYOUTS.map((l) => l.key));
    for (const p of RIG_CATALOG) {
      if (p.slot === "frame") {
        expect(p.layouts?.length, p.id).toBeGreaterThan(0);
        for (const l of p.layouts ?? []) expect(layouts.has(l), p.id).toBe(true);
      } else {
        expect(p.layouts, p.id).toBeUndefined();
      }
    }
  });

  it("uses ids a saved rig will keep", () => {
    // parseRigPrefs drops an id that is too long, so one of those could be
    // picked and then be gone after a reload.
    for (const p of RIG_CATALOG) {
      const saved = parseRigPrefs(JSON.stringify({ parts: { [p.slot]: p.id } }));
      expect(saved.parts[p.slot], p.id).toBe(p.id);
    }
  });

  it("names a product with its make when it has one", () => {
    expect(productName({ id: "a", slot: "rim", make: "Maker", model: "Model", kind: "k" })).toBe("Maker Model");
    expect(productName({ id: "b", slot: "rim", make: "", model: "Just this", kind: "k" })).toBe("Just this");
  });
});

describe("rigChoice", () => {
  const wheelbase = productsFor("wheelbase", "desk")[0];
  const cockpitFrame = productsFor("frame", "cockpit")[0];

  it("is unset while nothing has been said", () => {
    for (const s of RIG_SLOTS) expect(rigChoice(s.key, "cockpit", null).state, s.label).toBe("unset");
  });

  it("finds a product that was picked for the slot", () => {
    expect(rigChoice("wheelbase", "desk", wheelbase.id)).toEqual({ state: "product", product: wheelbase });
  });

  it("takes an empty slot at its word only where a rig can do without the part", () => {
    for (const key of optional) expect(rigChoice(key, "desk", RIG_NONE).state, key).toBe("none");
    for (const key of required) expect(rigChoice(key, "desk", RIG_NONE).state, key).toBe("unset");
  });

  it("reads an id it does not know as nothing said, not as a product", () => {
    expect(rigChoice("pedals", "stand", "left-over-from-another-catalogue").state).toBe("unset");
  });

  it("does not put one slot's product in another", () => {
    expect(rigChoice("pedals", "desk", wheelbase.id).state).toBe("unset");
  });

  it("does not show a cockpit as the frame of a desk rig", () => {
    expect(rigChoice("frame", "cockpit", cockpitFrame.id).state).toBe("product");
    expect(rigChoice("frame", "desk", cockpitFrame.id).state).toBe("unset");
  });
});
