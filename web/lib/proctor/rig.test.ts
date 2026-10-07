import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMPACT_STAGE_PX,
  DEFAULT_RIG_LAYOUT,
  DESIGN_ASPECT,
  RIG_EYE_NODE,
  RIG_LAYOUTS,
  RIG_NONE,
  RIG_SLOTS,
  defaultRigPrefs,
  emptySlots,
  fitDistance,
  isSideNode,
  parseRigPrefs,
  placeCaptions,
  pullBack,
  rigLayout,
} from "@/lib/proctor/rig";

/* A GLB is a 12-byte header, then chunks. The first chunk is the scene as JSON,
   which is all this needs — node names and who is whose child — so the model is
   read here without a 3D library and without a GPU. */
interface GlbNode {
  name: string;
  children: string[];
}

function glbNodes(path: string): GlbNode[] {
  const buf = readFileSync(path);
  expect(buf.toString("latin1", 0, 4)).toBe("glTF");
  const jsonLength = buf.readUInt32LE(12);
  expect(buf.toString("latin1", 16, 20)).toBe("JSON");
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength)) as {
    nodes?: { name?: string; children?: number[] }[];
  };
  const nodes = gltf.nodes ?? [];
  return nodes.map((n) => ({
    name: n.name ?? "",
    children: (n.children ?? []).map((i) => nodes[i].name ?? ""),
  }));
}

const served = (url: string) => fileURLToPath(new URL(`../../public${url}`, import.meta.url));

describe.each(RIG_LAYOUTS.map((l) => [l.label, l] as const))("the %s model and the slot list agree", (_label, layout) => {
  const nodes = glbNodes(served(layout.model));
  const names = nodes.map((n) => n.name);

  it("has a node for every slot", () => {
    for (const slot of RIG_SLOTS) expect(names, slot.label).toContain(slot.node);
  });

  it("has no slot node the list does not know about", () => {
    const known = new Set(RIG_SLOTS.map((s) => s.node));
    expect(names.filter((n) => n.startsWith("slot_") && !known.has(n))).toEqual([]);
  });

  it("carries the driver's eye point", () => {
    expect(names).toContain(RIG_EYE_NODE);
  });

  it("keeps the side screens apart, inside the monitors slot, so one screen can be shown", () => {
    const monitors = nodes.find((n) => n.name === "slot_monitors");
    expect(monitors?.children.filter(isSideNode)).toHaveLength(1);
  });

  it("hangs every side node off a slot, never loose in the scene", () => {
    const owned = new Set(nodes.filter((n) => n.name.startsWith("slot_")).flatMap((n) => n.children));
    expect(names.filter((n) => isSideNode(n) && !owned.has(n))).toEqual([]);
  });

  it("ships the floor shadow and the poster it names", () => {
    expect(existsSync(served(layout.shadow)), layout.shadow).toBe(true);
    expect(existsSync(served(layout.poster)), layout.poster).toBe(true);
  });
});

describe("the layout list", () => {
  it("names each slot and each layout once", () => {
    expect(new Set(RIG_SLOTS.map((s) => s.key)).size).toBe(RIG_SLOTS.length);
    expect(new Set(RIG_SLOTS.map((s) => s.node)).size).toBe(RIG_SLOTS.length);
    expect(new Set(RIG_LAYOUTS.map((l) => l.key)).size).toBe(RIG_LAYOUTS.length);
  });

  it("opens on a layout that exists", () => {
    expect(RIG_LAYOUTS.map((l) => l.key)).toContain(DEFAULT_RIG_LAYOUT);
    expect(rigLayout(DEFAULT_RIG_LAYOUT).key).toBe(DEFAULT_RIG_LAYOUT);
  });

  it("only gives a vantage for slots that exist", () => {
    const keys = new Set<string>(RIG_SLOTS.map((s) => s.key));
    for (const l of RIG_LAYOUTS) {
      expect(Object.keys(l.vantage).filter((k) => !keys.has(k)), l.label).toEqual([]);
    }
  });
});

describe("parseRigPrefs", () => {
  const fresh = defaultRigPrefs();

  it("starts each layout on the screens it is usually set up with", () => {
    for (const l of RIG_LAYOUTS) expect(fresh.screens[l.key]).toBe(l.screens);
    expect(fresh.layout).toBe(DEFAULT_RIG_LAYOUT);
  });

  it("falls back to the defaults when nothing was saved, or what was saved is not JSON", () => {
    expect(parseRigPrefs(null)).toEqual(fresh);
    expect(parseRigPrefs("")).toEqual(fresh);
    expect(parseRigPrefs("{not json")).toEqual(fresh);
    expect(parseRigPrefs('"desk"')).toEqual(fresh);
    expect(parseRigPrefs("null")).toEqual(fresh);
  });

  it("reads back a saved layout and a saved screen count for it", () => {
    const got = parseRigPrefs(JSON.stringify({ layout: "desk", screens: { desk: "triple" } }));
    expect(got.layout).toBe("desk");
    expect(got.screens.desk).toBe("triple");
    expect(got.screens.cockpit).toBe(fresh.screens.cockpit);
  });

  it("ignores a layout or a screen count it does not know", () => {
    const got = parseRigPrefs(JSON.stringify({ layout: "motion-platform", screens: { desk: "five", stand: 3 } }));
    expect(got).toEqual(fresh);
  });

  it("round-trips what it produces", () => {
    const prefs = {
      ...fresh,
      layout: "stand" as const,
      screens: { ...fresh.screens, stand: "triple" as const },
      parts: { ...fresh.parts, pedals: "some-pedals", handbrake: RIG_NONE },
    };
    expect(parseRigPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it("starts with nothing said about any slot", () => {
    for (const slot of RIG_SLOTS) expect(fresh.parts[slot.key], slot.label).toBeNull();
  });

  it("still reads a choice saved before a rig had parts", () => {
    const got = parseRigPrefs(JSON.stringify({ layout: "desk", screens: { desk: "triple" } }));
    expect(got.layout).toBe("desk");
    expect(got.parts).toEqual(fresh.parts);
  });

  it("keeps a part id, and drops anything that is not one", () => {
    const got = parseRigPrefs(
      JSON.stringify({ parts: { wheelbase: "a-wheelbase", rim: 7, pedals: "", monitors: "x".repeat(200), elbow: "no" } }),
    );
    expect(got.parts.wheelbase).toBe("a-wheelbase");
    expect(got.parts.rim).toBeNull();
    expect(got.parts.pedals).toBeNull();
    expect(got.parts.monitors).toBeNull();
    expect(Object.keys(got.parts).sort()).toEqual(RIG_SLOTS.map((s) => s.key).sort());
  });

  it("lets only a slot a rig can do without be marked empty", () => {
    const all = Object.fromEntries(RIG_SLOTS.map((s) => [s.key, RIG_NONE]));
    const got = parseRigPrefs(JSON.stringify({ parts: all }));
    for (const slot of RIG_SLOTS) {
      expect(got.parts[slot.key], slot.label).toBe(slot.optional ? RIG_NONE : null);
    }
    expect(emptySlots(got.parts)).toEqual(RIG_SLOTS.filter((s) => s.optional).map((s) => s.key));
  });

  it("does not call a slot empty because nothing has been said about it", () => {
    expect(emptySlots(fresh.parts)).toEqual([]);
    expect(emptySlots({ ...fresh.parts, shifter: "a-shifter" })).toEqual([]);
  });
});

describe("placeCaptions", () => {
  const W = 800;
  const H = 500;

  it("shows captions that have room", () => {
    const shown = placeCaptions(
      [
        { key: "a", x: 100, y: 100, rank: 0 },
        { key: "b", x: 400, y: 300, rank: 0 },
      ],
      W,
      H,
    );
    expect([...shown].sort()).toEqual(["a", "b"]);
  });

  it("drops the later of two that collide", () => {
    const shown = placeCaptions(
      [
        { key: "first", x: 300, y: 200, rank: 0 },
        { key: "second", x: 320, y: 205, rank: 0 },
      ],
      W,
      H,
    );
    expect([...shown]).toEqual(["first"]);
  });

  it("never drops the selected slot for an ordinary one", () => {
    const shown = placeCaptions(
      [
        { key: "ordinary", x: 300, y: 200, rank: 0 },
        { key: "selected", x: 320, y: 205, rank: 1 },
      ],
      W,
      H,
    );
    expect([...shown]).toEqual(["selected"]);
  });

  it("hides a caption that would sit off the stage", () => {
    const shown = placeCaptions(
      [
        { key: "left", x: 2, y: 100, rank: 0 },
        { key: "below", x: 100, y: H + 40, rank: 1 },
        { key: "in", x: 200, y: 200, rank: 0 },
      ],
      W,
      H,
    );
    expect([...shown]).toEqual(["in"]);
  });

  it("keeps only the selected slot on a small stage", () => {
    const shown = placeCaptions(
      [
        { key: "ordinary", x: 100, y: 100, rank: 0 },
        { key: "selected", x: 250, y: 150, rank: 1 },
      ],
      COMPACT_STAGE_PX - 1,
      300,
    );
    expect([...shown]).toEqual(["selected"]);
  });
});

describe("framing", () => {
  it("holds the composed distance on a stage at least as wide as the design", () => {
    expect(pullBack(DESIGN_ASPECT)).toBe(1);
    expect(pullBack(DESIGN_ASPECT * 1.5)).toBe(1);
  });

  it("backs away on a narrower stage", () => {
    expect(pullBack(4 / 3)).toBeGreaterThan(1);
    expect(pullBack(1)).toBeGreaterThan(pullBack(4 / 3));
  });

  it("does not divide by a stage that has no size yet", () => {
    expect(pullBack(0)).toBe(1);
    expect(pullBack(Number.NaN)).toBe(1);
  });

  it("stands further back for a bigger part and for a narrower lens", () => {
    expect(fitDistance(0.6, 30, DESIGN_ASPECT)).toBeGreaterThan(fitDistance(0.3, 30, DESIGN_ASPECT));
    expect(fitDistance(0.3, 30, DESIGN_ASPECT)).toBeGreaterThan(fitDistance(0.3, 60, DESIGN_ASPECT));
  });
});
