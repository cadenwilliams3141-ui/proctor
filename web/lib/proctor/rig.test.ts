import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMPACT_STAGE_PX,
  DESIGN_ASPECT,
  RIG_EYE_NODE,
  RIG_MODEL_URL,
  RIG_SLOTS,
  fitDistance,
  placeCaptions,
  pullBack,
} from "@/lib/proctor/rig";

/* A GLB is a 12-byte header, then chunks. The first chunk is the scene as JSON,
   which is all this needs — node names — so the model is read here without a 3D
   library and without a GPU. */
function glbNodeNames(path: string): string[] {
  const buf = readFileSync(path);
  expect(buf.toString("latin1", 0, 4)).toBe("glTF");
  const jsonLength = buf.readUInt32LE(12);
  expect(buf.toString("latin1", 16, 20)).toBe("JSON");
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength)) as {
    nodes?: { name?: string }[];
  };
  return (gltf.nodes ?? []).map((n) => n.name ?? "");
}

const MODEL = fileURLToPath(new URL(`../../public${RIG_MODEL_URL}`, import.meta.url));

describe("the rig model and the slot list agree", () => {
  const names = glbNodeNames(MODEL);

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

  it("names each slot once", () => {
    expect(new Set(RIG_SLOTS.map((s) => s.key)).size).toBe(RIG_SLOTS.length);
    expect(new Set(RIG_SLOTS.map((s) => s.node)).size).toBe(RIG_SLOTS.length);
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
