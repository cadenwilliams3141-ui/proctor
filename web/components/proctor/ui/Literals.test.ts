/* No screen may carry a measurement as a literal in its own source.
 *
 * CLAUDE.md has said so since the rule was broken the first time, and it was
 * broken three times — twice on desktop, once on the phone — each found only by
 * looking at the pixels. A number a screen invents survives a change of session
 * and describes the wrong run without ever looking wrong. Until now nothing but
 * review enforced it.
 *
 * What this catches: a number with a unit written into the text a reader sees —
 * a JSX text node, or a string literal standing as a JSX child. "89.8%" typed
 * into a screen fails here. A number computed from the bundle and interpolated
 * does not, because it is not in the source.
 *
 * What it does not try to catch: thresholds in code (they are not rendered as
 * text), CSS (px is not a unit here, and style strings are not JSX text), and
 * numbers built inside template literals from variables. Scale labels — an
 * axis that runs 0 to 100%, a 10 m scale bar — are measurements of nothing and
 * are listed below by name, each with the reason it is allowed.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "components/proctor/screens",
  "components/proctor/views",
  "components/proctor/mobile",
  "components/proctor/panels",
];

/** Text that names a scale, not a reading. File + exact fragment. */
const SCALE_LABELS: { file: string; text: string; why: string }[] = [
  { file: "Ribbon.tsx", text: "0%", why: "start of the lap-distance axis" },
  { file: "Ribbon.tsx", text: "100% of the lap, by distance", why: "end of the lap-distance axis" },
  { file: "RacingLine.tsx", text: "10 m", why: "a scale bar's length" },
  { file: "ForcesPanels.tsx", text: "Bars are scaled 0–100%", why: "how the bar axis runs, with a worked example" },
];

const UNIT = String.raw`(?:%|ms|s|km/h|m|g|Nm|N·m|°C|fps|L|mm|°)`;
const NUMBER_WITH_UNIT = new RegExp(String.raw`(?<![\w.$])\d+(?:\.\d+)?\s?${UNIT}(?![\w])`);

function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sources(): { file: string; path: string; text: string }[] {
  const out: { file: string; path: string; text: string }[] = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".tsx")) continue;
      out.push({ file: name, path: join(root, name), text: code(readFileSync(join(root, name), "utf8")) });
    }
  }
  return out;
}

function rendered(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/>([^<>{}]+)</g)) out.push(m[1].trim());
  for (const m of text.matchAll(/\{\s*(["'])([^"'\n]*)\1\s*\}/g)) out.push(m[2].trim());
  return out;
}

describe("no measurement is typed into a screen", () => {
  it("finds the screens it is meant to read", () => {
    expect(sources().length).toBeGreaterThan(10);
  });

  it.each(sources().map((s) => [s.path, s] as const))("%s", (_path, src) => {
    const allowed = SCALE_LABELS.filter((a) => a.file === src.file).map((a) => a.text);
    const offenders = rendered(src.text).filter(
      (t) => NUMBER_WITH_UNIT.test(t) && !allowed.some((a) => t.startsWith(a)),
    );
    expect(offenders, `${src.path} renders a literal reading`).toEqual([]);
  });

  it("catches the shape of the bug it exists for", () => {
    const bad = code(`<div className="num">93.4%</div><span>{"89.8%"}</span><p>{x}%</p>`);
    expect(rendered(bad).filter((t) => NUMBER_WITH_UNIT.test(t))).toEqual(["93.4%", "89.8%"]);
  });
});
