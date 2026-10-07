// Assemble the 3D rig-builder page: the original mockup (source_mockup.html, kept verbatim) with its SVG
// schematic swapped for the 3D stage, plus the model, the floor shadow map and the poster inlined.
//
//   node page/build.mjs      ->  dist/proctor-rig-builder-3d.html  (artifact body, publish this)
//                                dist/preview.html                 (same thing in a full document, for local viewing)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const b64 = (p) => readFileSync(join(root, p)).toString('base64');

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.147.0/';
const LIBS = ['build/three.min.js', 'examples/js/loaders/GLTFLoader.js', 'examples/js/controls/OrbitControls.js',
              'examples/js/environments/RoomEnvironment.js', 'examples/js/lights/RectAreaLightUniformsLib.js'];

let s = read('page/source_mockup.html');

// the saved artifact carries the publish skeleton; the page proper starts at its <title>
const SKELETON = s.slice(0, s.indexOf('<title>'));
s = s.slice(SKELETON.length).replace(/\s*<\/body><\/html>\s*$/, '\n');

function swap(from, to, label) {
  const n = typeof from === 'string' ? s.split(from).length - 1 : (s.match(from) || []).length;
  if (n !== 1) throw new Error(`${label}: expected one match, found ${n}`);
  s = s.replace(from, () => to);
}
function between(startMark, endMark, to, label) {
  const a = s.indexOf(startMark), b = s.indexOf(endMark, a);
  if (a < 0 || b < 0 || s.indexOf(startMark, a + 1) >= 0) throw new Error(`${label}: markers not found once`);
  s = s.slice(0, a) + to + s.slice(b);
}

swap('<title>Proctor — Rig builder mockup</title>', '<title>Proctor Rig Builder 3D</title>', 'title');
swap('.app { height: 100vh; display: flex; overflow: hidden; }',
     'html, body { height: 100%; }\n.app { height: 100%; display: flex; overflow: hidden; }', 'app height');
swap('.hidden { display: none !important; }\n</style>',
     '.hidden { display: none !important; }\n' + read('page/viewer.css') + '</style>', 'viewer css');

// the scene
swap(/<svg class="scene"[\s\S]*?<\/svg>/,
     read('page/stage.html').trim().replace('{{POSTER}}', 'data:image/jpeg;base64,' + b64('out/poster.jpg')), 'scene');
swap(/<span>A schematic, not a scale drawing\.[\s\S]*?<\/span>/,
     `<span>A generic model drawn to real proportions, for the sample rig: three 34-inch 1500R screens, 620 mm
              from the eye point. Each part stands in for its category and is not the product you picked, and
              nothing here is derived from your telemetry. From the driver's seat the picture is projected from
              that eye point, which is why the horizon stays level across all three screens. The one number that
              <em>is</em> geometric is the field of view below, which comes from the screen sizes and the seating
              distance you enter.</span>`, 'scene caveat');

// the page script: it stays the source of truth and talks to the 3D view through two small hooks
between('function renderScene() {', '/* ── Picker ─', `/* The scene is a 3D view (rig3d, at the foot of the page). This script stays the
   source of truth: it tells the view what is selected and which slots are filled,
   and the view reports a clicked part through __rig.choose. */
function renderScene() {
  $("#hint").textContent = SLOTS.find((s) => s.key === selected)?.label ?? "click a part";
  if (window.rig3d) window.rig3d.sync(selected, rig);
}

function render() { renderSlots(); renderDetail(); renderScene(); }

window.__rig = {
  state: () => ({ selected, rig, slots: SLOTS }),
  choose(k) {
    if (!rig[k]) return openPicker(k);
    selected = k;
    render();
    if (window.rig3d) window.rig3d.focus(k);
  },
};

`, 'scene script');
swap('\n      selected = k;\n      render();\n',
     '\n      selected = k;\n      render();\n      if (window.rig3d) window.rig3d.focus(k);\n', 'list click');
swap(/      const g = document\.querySelector\(`\.slot\[data-slot="\$\{selected\}"\]`\);\n      if \(g\) \{[^\n]*\}\n/,
     '      if (window.rig3d) { window.rig3d.pop(selected); window.rig3d.focus(selected); }\n', 'pop');
if (s.split('document.querySelectorAll(".seg-opt")').length - 1 !== 2) throw new Error('tabs: expected two selectors');
s = s.replaceAll('document.querySelectorAll(".seg-opt")', 'document.querySelectorAll(".topbar .seg-opt")');

// libraries before the page script, model and viewer after it
swap('<script>\n"use strict";', LIBS.map((l) => `<script src="${CDN}${l}"></script>`).join('\n') + '\n\n<script>\n"use strict";', 'libs');
s = s.trimEnd() + `

<script id="rigGlb" type="application/octet-stream">${b64('out/proctor_rig.glb')}</script>
<script>window.RIG_FLOOR_AO = "data:image/png;base64,${b64('out/floor_ao.png')}";</script>
<script>
${read('page/viewer.js').trimEnd()}
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/proctor-rig-builder-3d.html'), s);
writeFileSync(join(root, 'dist/preview.html'), SKELETON + s + '</body></html>\n');
console.log(`dist/proctor-rig-builder-3d.html  ${(s.length / 1e6).toFixed(2)} MB`);
