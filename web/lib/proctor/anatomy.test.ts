import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANATOMY_MODEL_URL,
  ANATOMY_PARTS,
  EXPLODE_RULES,
  LEADER_NODES,
  classify,
  explodeProgress,
  partNumber,
  placeTag,
  tagRect,
  type Rect,
} from "@/lib/proctor/anatomy";

/* The scene of a GLB is JSON in its first chunk, so the model is read here
   without a 3D library and without a GPU. */
function glbSceneNodes(path: string): { name: string; group?: string }[] {
  const buf = readFileSync(path);
  expect(buf.toString("latin1", 0, 4)).toBe("glTF");
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength)) as {
    scene?: number;
    scenes: { nodes: number[] }[];
    nodes: { name?: string; extras?: { group?: string } }[];
  };
  return gltf.scenes[gltf.scene ?? 0].nodes.map((i) => ({
    name: gltf.nodes[i].name ?? "",
    group: gltf.nodes[i].extras?.group,
  }));
}

const MODEL = fileURLToPath(new URL(`../../public${ANATOMY_MODEL_URL}`, import.meta.url));

describe("the car model and the explode rules agree", () => {
  const nodes = glbSceneNodes(MODEL);
  const names = new Set(nodes.map((n) => n.name));

  it("claims every component with a rule", () => {
    expect(nodes.filter((n) => !classify(n.name, n.group).matched).map((n) => n.name)).toEqual([]);
  });

  it("has no rule that matches nothing", () => {
    const idle = EXPLODE_RULES.filter(
      (r) => !nodes.some((n) => EXPLODE_RULES.find((x) => x.test.test(n.name)) === r),
    ).map((r) => String(r.test));
    expect(idle).toEqual([]);
  });

  it("gives every part of the story at least one component", () => {
    for (const part of ANATOMY_PARTS) {
      const mine = nodes.filter((n) => classify(n.name, n.group).group === part.id);
      expect(mine.length, part.name).toBeGreaterThan(0);
    }
  });

  it("points every tag at a component that exists and belongs to its part", () => {
    for (const part of ANATOMY_PARTS) {
      expect(names, part.name).toContain(part.anchor);
      expect(classify(part.anchor).group, part.name).toBe(part.id);
    }
  });

  it("draws leaders only from components that exist", () => {
    expect([...LEADER_NODES].filter((n) => !names.has(n))).toEqual([]);
  });

  it("sends a left and a right component opposite ways across the car, and nowhere else", () => {
    for (const { name, group } of nodes) {
      if (!name.includes("_left")) continue;
      const twin = name.replace("_left", "_right");
      expect(names, twin).toContain(twin);
      const l = classify(name, group);
      const r = classify(twin, group);
      expect(r.offset, twin).toEqual([-l.offset[0] || 0, l.offset[1], l.offset[2]]);
      expect(r.group).toBe(l.group);
    }
  });
});

describe("classify", () => {
  it("files an unclaimed component as context, by what the model calls it", () => {
    expect(classify("something_new", "bodywork")).toMatchObject({ group: "body", matched: false });
    expect(classify("something_new", "aero")).toMatchObject({ group: "aero", matched: false });
    expect(classify("something_new")).toMatchObject({ group: "aero", offset: [0, 0, 0] });
  });

  it("leaves the floor where it is", () => {
    expect(classify("floor", "aero").offset).toEqual([0, 0, 0]);
  });
});

describe("partNumber", () => {
  it("counts from one, two digits wide", () => {
    expect(partNumber(0)).toBe("01");
    expect(partNumber(ANATOMY_PARTS.length - 1)).toBe(String(ANATOMY_PARTS.length).padStart(2, "0"));
  });
});

describe("explodeProgress", () => {
  const orders = [...new Set(EXPLODE_RULES.map((r) => r.order))];

  it("is fully together at 0 and fully apart at 1, for every wave", () => {
    for (const o of orders) {
      expect(explodeProgress(0, o)).toBe(0);
      expect(explodeProgress(1, o)).toBe(1);
    }
  });

  it("lets an earlier wave lead a later one on the way out", () => {
    expect(explodeProgress(0.4, 0)).toBeGreaterThan(explodeProgress(0.4, 4));
  });

  it("never runs backwards", () => {
    for (const o of orders) {
      let last = 0;
      for (let g = 0; g <= 1.0001; g += 0.05) {
        const e = explodeProgress(g, o);
        expect(e).toBeGreaterThanOrEqual(last);
        last = e;
      }
    }
  });
});

describe("placeTag", () => {
  const W = 1000;
  const H = 600;

  it("stands a tag up and to the right when there is room", () => {
    const p = placeTag(400, 300, 90, 24, [], W, H);
    expect(p).toMatchObject({ left: false, down: false, lead: 30 });
  });

  it("flips to the left at the right-hand edge", () => {
    expect(placeTag(W - 20, 300, 90, 24, [], W, H)).toMatchObject({ left: true, down: false });
  });

  it("moves off a place that is taken", () => {
    const first = placeTag(400, 300, 90, 24, [], W, H);
    const second = placeTag(400, 300, 90, 24, [first!.rect], W, H);
    expect(second).not.toBeNull();
    expect(second!.rect).not.toEqual(first!.rect);
    const [a, b] = [first!.rect, second!.rect];
    expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]).toBe(false);
  });

  it("hangs below when everything above is off the stage", () => {
    expect(placeTag(400, 10, 90, 24, [], W, H)).toMatchObject({ down: true });
  });

  it("gives up rather than overlap", () => {
    const everything: Rect = [0, 0, W, H];
    expect(placeTag(400, 300, 90, 24, [everything], W, H)).toBeNull();
  });

  it("measures the same rectangle the placement reports", () => {
    const p = placeTag(400, 300, 90, 24, [], W, H)!;
    expect(tagRect(400, 300, 90, 24, p.lead, p.left, p.down)).toEqual(p.rect);
  });
});
