// Copy what the app serves from out/ into web/public/rig/, under the names the app asks for.
//
//   node docs/rig-3d/sync.mjs
//
// The app names files by layout key (web/lib/proctor/rig.ts): <key>.glb, <key>-floor.png, <key>.jpg.
// The cockpit keeps its plain names in out/ because the mockup page (page/build.mjs) reads them.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const served = join(here, '..', '..', 'web', 'public', 'rig');

const LAYOUTS = { cockpit: '', stand: '_stand', desk: '_desk' };

mkdirSync(served, { recursive: true });
for (const [key, tag] of Object.entries(LAYOUTS)) {
  for (const [from, to] of [
    [`proctor_rig${tag}.glb`, `${key}.glb`],
    [`floor_ao${tag}.png`, `${key}-floor.png`],
    [`poster${tag}.jpg`, `${key}.jpg`],
  ]) {
    copyFileSync(join(out, from), join(served, to));
    console.log(`${from.padEnd(24)} -> web/public/rig/${to.padEnd(18)} ${(statSync(join(served, to)).size / 1024).toFixed(0)} kB`);
  }
}
