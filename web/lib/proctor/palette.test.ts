/* One palette, and only one.
 *
 * The colours live twice: as CSS tokens in app/globals.css (what every
 * `var(--…)` style reads) and as literals in lib/proctor/channels.ts (SVG
 * presentation attributes and canvas code cannot read a custom property). A
 * comment said the two "must agree" for months and nothing checked it — one
 * entry had drifted by the time the Carbon theme replaced Nocturne. This holds
 * them equal.
 *
 * The second half is why a re-theme could be done at the sources: no component
 * may spell a colour of its own. A hex or rgb() literal in a screen is a colour
 * the next theme cannot reach, and Nocturne left ~60 of them for Carbon to find
 * one file at a time. Colours come from CH / INK / alpha() / inkA() / dim() or a
 * `var(--…)` token. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { CH, INK, alpha, inkA } from "./channels";

const CSS = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

/** The :root block's custom properties, `var()` references resolved. */
function tokens(): Map<string, string> {
  const root = CSS.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!root) throw new Error("no :root block in globals.css");
  const raw = new Map<string, string>();
  const body = root[1].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw.set(m[1], m[2].trim());
  const resolve = (v: string, depth = 0): string =>
    depth > 8 ? v : v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(raw.get(name) ?? `var(${name})`, depth + 1));
  return new Map([...raw].map(([k, v]) => [k, resolve(v).toLowerCase()]));
}

const T = tokens();

describe("palette: channels.ts agrees with globals.css", () => {
  const pairs: [string, string][] = [
    ["--ch-a", CH.a],
    ["--ch-b", CH.b],
    ["--ch-loss", CH.loss],
    ["--ch-gain", CH.gain],
    ["--ch-warn", CH.warn],
    ["--color-bg", INK.bg],
    ["--color-surface", INK.surface],
    ["--color-rail", INK.rail],
    ["--color-text", INK.text],
    ["--color-accent", INK.accent],
    ["--color-on-accent", INK.onAccent],
    ["--color-neutral-800", INK.neutral800],
    ["--color-neutral-700", INK.neutral700],
    ["--color-neutral-500", INK.neutral500],
    ["--color-accent-2-700", INK.accent2_700],
    ["--color-accent-2-600", INK.accent2_600],
    ["--color-accent-800", INK.accent800],
    ["--color-accent-900", INK.accent900],
  ];
  for (const [token, value] of pairs) {
    it(`${token} == ${value}`, () => {
      expect(T.get(token)).toBe(value.toLowerCase());
    });
  }

  it("every INK entry is checked above", () => {
    const checked = new Set(pairs.map(([, v]) => v));
    for (const [k, v] of Object.entries(INK)) expect(checked.has(v), `INK.${k}`).toBe(true);
  });

  it("inkA(1) is the text colour", () => {
    const hex = T.get("--color-text")!;
    const n = parseInt(hex.slice(1), 16);
    expect(inkA(1)).toBe(`rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1)`);
  });

  it("alpha() turns a palette hex into an rgba an SVG attribute accepts", () => {
    expect(alpha("#ff6b57", 0.08)).toBe("rgba(255, 107, 87, 0.08)");
    expect(alpha(CH.a, 1)).toBe("rgba(53, 208, 229, 1)");
  });
});

/* ── No colour literal outside the palette ──────────────────────────────── */

const ROOTS = ["app", "components", "lib"];

/** The palette itself, and files whose literals are not colours of the theme. */
const OWNERS = new Set(["lib/proctor/channels.ts"]);

/** Literals that are not theme colours. File + exact fragment + why. */
const ALLOWED: { file: string; text: string; why: string }[] = [
  {
    file: "components/proctor/views/RigScene.tsx",
    text: `radialTexture([[0, "#fff"], [0.55, "#666"], [1, "#000"]], 0.25)`,
    why: "an alpha mask: three.js reads its luminance as opacity, it is never seen as colour",
  },
];

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/g;

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("palette: no colour literal outside it", () => {
  const web = join(__dirname, "../..");
  const files = ROOTS.flatMap((r) => walk(join(web, r))).map((p) => relative(web, p));

  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no component, screen or route spells a colour of its own", () => {
    const found: string[] = [];
    for (const file of files) {
      if (OWNERS.has(file)) continue;
      let text = code(readFileSync(join(web, file), "utf8"));
      for (const a of ALLOWED) if (a.file === file) text = text.split(a.text).join("");
      for (const line of text.split("\n")) {
        // A `#` followed by hex is a colour only inside a string; skip ids like
        // `#${n}` built at runtime and hash links, which never match 3+ hex digits.
        if (line.match(LITERAL)) found.push(`${file}: ${line.trim().slice(0, 120)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("every allowed literal is still there (a stale entry hides nothing)", () => {
    for (const a of ALLOWED) {
      expect(readFileSync(join(web, a.file), "utf8").includes(a.text), `${a.file}: ${a.why}`).toBe(true);
    }
  });
});
