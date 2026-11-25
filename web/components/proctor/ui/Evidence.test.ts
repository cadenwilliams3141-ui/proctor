/* The one rule <Evidence> has, checked against the source of every screen that
 * uses it.
 *
 * <Evidence> may hold charts and tables. It may NOT hold anything that states
 * something is MISSING — an <Absences> block, a <NotDrawable>, or a technique
 * label. The 2026-08-14 Decision forbids a disclosure that changes the meaning
 * of what is left in front of the reader, and a negative result the reader has
 * to already suspect in order to go looking for it has been deleted in every
 * way that matters.
 *
 * A <Caveat> is deliberately NOT on that list, and the distinction is the whole
 * point of the rule. A caveat is not a statement that something is missing; it
 * qualifies a specific panel, and it rides in that panel's `foot`. When the
 * panel folds away, the thing the caveat qualifies folds away with it and
 * nothing misleading is left behind. What would be wrong is a caveat qualifying
 * something still on screen — but that caveat lives in the visible panel, not
 * inside the fold, so the arrangement takes care of itself.
 *
 * (The first version of this test forbade <Caveat> outright and failed against
 * ForcesScreen's own grip panels. The rule was too broad, not the code.)
 *
 * This is a source-level check rather than a render test because vitest here
 * has no jsdom setup. It is coarser than mounting the tree, and it is enough:
 * it fails loudly the moment one of these elements is nested inside an
 * <Evidence> block, which is the mistake worth catching.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "components/proctor/screens",
  "components/proctor/views",
  "components/proctor/mobile",
  "components/proctor/panels",
];

/** Elements that must never be inside an <Evidence> block. See the header for
 *  why <Caveat> is not among them. */
const FORBIDDEN = ["<Absences", "<NotDrawable", "<TechniqueNotes"];

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const root of ROOTS) {
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".tsx")) continue;
      out.push({ path: join(root, name), text: readFileSync(join(root, name), "utf8") });
    }
  }
  return out;
}

/** Comments stripped, so a `<Evidence>` written in prose is not mistaken for a
 *  real one. Several files describe this very rule in their header comment,
 *  and without this an unclosed mention swallows the rest of the file into a
 *  phantom block — which is exactly the false positive this test first hit. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments, JSDoc included
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, sparing "https://"
}

/** The source inside each <Evidence>…</Evidence> pair. */
function evidenceBlocks(text: string): string[] {
  const src = code(text);
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const open = src.indexOf("<Evidence", from);
    if (open === -1) break;
    const close = src.indexOf("</Evidence>", open);
    if (close === -1) break;
    blocks.push(src.slice(open, close));
    from = close + 1;
  }
  return blocks;
}

describe("Evidence holds charts and tables and nothing else", () => {
  const files = sources();

  it("finds the screens to check", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => evidenceBlocks(f.text).length > 0)).toBe(true);
  });

  for (const file of files) {
    const blocks = evidenceBlocks(file.text);
    if (!blocks.length) continue;

    it(`${file.path} hides nothing that states what is missing`, () => {
      for (const block of blocks) {
        for (const forbidden of FORBIDDEN) {
          expect(
            block.includes(forbidden),
            `${forbidden} is inside an <Evidence> block in ${file.path}. A statement that something is missing, or a technique label, behind a disclosure is a negative result the reader has to already suspect in order to find. Move it outside the fold.`,
          ).toBe(false);
        }
      }
    });
  }

  it("every Evidence block says what is under it", () => {
    for (const file of files) {
      for (const block of evidenceBlocks(file.text)) {
        expect(
          block.includes("hint="),
          `an <Evidence> block in ${file.path} has no hint, so a reader cannot tell what is folded away`,
        ).toBe(true);
      }
    }
  });
});

describe("a screen that folds evidence still states its absences in the open", () => {
  /* The Session report and Physics screens these rules were written for were
     retired on 2026-11-25; their panels moved to components/proctor/panels and
     the rules moved with them, onto the screens that now carry the folds. */
  it.each([
    "components/proctor/screens/CoachScreen.tsx",
    "components/proctor/screens/AspectScreen.tsx",
  ])("%s keeps its Absences block outside every fold", (path) => {
    const text = readFileSync(path, "utf8");
    expect(text).toContain("<Absences");
    for (const block of evidenceBlocks(text)) {
      expect(block).not.toContain("<Absences");
    }
  });

  it("the coach skips only the absence its hero states, and only when it states it", () => {
    /* The hero voices driving_aspects' reason when there is no aspect timing.
       Skipping it at the foot any other time would report it nowhere; listing
       more keys as voiced here would hide absences no section on this screen
       states — the session context below is folded and tier-gated. */
    const text = readFileSync("components/proctor/screens/CoachScreen.tsx", "utf8");
    expect(text).toContain('const VOICED = new Set(["driving_aspects"]);');
    expect(text).toContain("exclude={r.available ? undefined : VOICED}");
  });

  it("an aspect screen lists its own absences at the foot whatever the tier", () => {
    /* Its evidence section is deep-only, so the foot cannot assume a panel up
       there already said it. The foot filters TO the aspect's keys rather than
       excluding them. */
    const text = readFileSync("components/proctor/screens/AspectScreen.tsx", "utf8");
    expect(text).toContain("VOICED[key].includes(x.key) || x.permanent");
    expect(text).not.toMatch(/<Absences[^>]*exclude=/);
  });
});
