/* Render every screen at five widths and fail on anything a reader cannot reach.
 *
 * DEV TOOL. Not part of the build, not imported by the app.
 *
 * WHY THIS EXISTS. Five consecutive Build Log entries record screens "verified
 * by tsc and build, NOT by looking at pixels", and that is exactly how the
 * hardcoded-literal bugs survived on the phone for months. A type checker
 * cannot see a control that has been pushed off the right edge of a tablet, and
 * a passing test cannot see a spinner that never resolves. This can.
 *
 * WHAT IT ASSERTS, per viewport x screen:
 *   - no uncaught page errors and no console errors
 *   - nothing sits past the right edge WITHOUT a scroll container to reach it
 *   - the screen is not near-empty
 *   - the screen is not still saying "Reading" after the load settled
 *
 * That third condition is the subtle one. A child of an `overflow-x: auto` box
 * legitimately extends past the viewport — that is a scrollable table, not a
 * bug. A child of an `overflow-x: hidden` box is simply gone. The first version
 * of this script did not distinguish them, reported 51 "problems" on one screen
 * that were all fine, and would have buried the three that were real.
 *
 * USAGE
 *   1. Build fixtures:  DATABASE_URL=... python render-service/tools/make_fixture_session.py
 *   2. Capture bundles from the running app into --bundles (see that dir's README)
 *   3. npm run build && npx next start -p 3210
 *   4. SWEEP_SESSION=1 SWEEP_TIER=deep node scripts/responsive-sweep.mjs
 *
 * Bundles are replayed through route interception rather than hitting the
 * database, so a sweep is deterministic and can be re-run against any stored
 * session shape without re-ingesting.
 *
 * Env: SWEEP_SESSION (default 1), SWEEP_TIER (glance|deep|everything),
 *      SWEEP_BASE, SWEEP_BUNDLES, SWEEP_OUT, SWEEP_CHROME.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/* Playwright is deliberately NOT a dependency of this app — it is only ever
   needed by this script. Resolve it from wherever it is installed (local, or a
   global install) rather than adding it to package.json for one dev tool. */
const require_ = createRequire(import.meta.url);
let chromium;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require_(spec)); break; } catch { /* try the next */ }
}
if (!chromium) {
  console.error('playwright not found. `npm i -D playwright`, or install it globally.');
  process.exit(2);
}

const BASE = process.env.SWEEP_BASE || 'http://127.0.0.1:3210';
const BUNDLES = process.env.SWEEP_BUNDLES || path.join(process.cwd(), '.sweep', 'bundles');
const SHOTS = process.env.SWEEP_OUT || path.join(process.cwd(), '.sweep', 'shots');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const B = (n) => JSON.parse(fs.readFileSync(path.join(BUNDLES, n + '.json'), 'utf8'));
const bundles = { sessions: B('sessions'), 1: B('s1'), 2: B('s2'), 3: B('s3') };
const traces  = { 1: B('s1t'), 2: B('s2t'), 3: B('s3t') };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const VIEWPORTS = [
  { name: 'iphone14',  w: 390,  h: 844,  ua: IPHONE,  app: '/m' },
  { name: 'promax',    w: 430,  h: 932,  ua: IPHONE,  app: '/m' },
  { name: 'ipad',      w: 768,  h: 1024, ua: DESKTOP, app: '/'  },
  { name: 'laptop',    w: 1280, h: 800,  ua: DESKTOP, app: '/'  },
  { name: 'desktop',   w: 1920, h: 1080, ua: DESKTOP, app: '/'  },
];

const DESKTOP_SCREENS = ['sessions', 'report', 'analyze', 'live', 'rig', 'upload'];
const PHONE_SCREENS   = ['sessions', 'analyze', 'live', 'rig'];

const SESSION = process.env.SWEEP_SESSION || '1';
const TIER = process.env.SWEEP_TIER || 'deep';

const problems = [];

/* SWEEP_CHROME overrides the binary. Left unset, Playwright finds its own —
   which on a machine with PLAYWRIGHT_BROWSERS_PATH set is already correct. */
const browser = await chromium.launch({
  ...(process.env.SWEEP_CHROME ? { executablePath: process.env.SWEEP_CHROME } : {}),
  args: ['--no-sandbox'],
});

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    userAgent: vp.ua,
    deviceScaleFactor: 1,
    isMobile: vp.app === '/m',
    hasTouch: vp.app === '/m',
  });
  await ctx.addCookies([
    { name: 'proctor-tier', value: TIER, url: BASE },
    // Pin the desktop app when we are deliberately testing it, so the
    // middleware does not bounce a phone-UA run to /m mid-sweep.
    ...(vp.app === '/' ? [{ name: 'proctor-view', value: 'desktop', url: BASE }] : []),
  ]);

  // Every API call is answered from the captured bundles: real JSON, produced
  // by the real route code against a real Postgres, replayed offline.
  await ctx.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/sessions') return json(bundles.sessions);
    let m = u.pathname.match(/^\/api\/session\/([^/]+)\/data$/);
    if (m) return json(bundles[m[1] === 'latest' ? SESSION : m[1]] ?? bundles[SESSION]);
    m = u.pathname.match(/^\/api\/session\/([^/]+)\/traces$/);
    if (m) return json(traces[m[1] === 'latest' ? SESSION : m[1]] ?? traces[SESSION]);
    if (u.pathname === '/api/ingest') return json([]);
    if (u.pathname === '/api/ingest-url') return json({ url: 'https://example.invalid/ingest' });
    return json({});
  });

  const screens = vp.app === '/m' ? PHONE_SCREENS : DESKTOP_SCREENS;
  for (const screen of screens) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

    const url = `${BASE}${vp.app}?screen=${screen}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      problems.push({ vp: vp.name, screen, kind: 'navigation', detail: String(e).slice(0, 200) });
      await page.close();
      continue;
    }
    await page.waitForTimeout(900);

    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      // Which elements, if any, stick out past the right edge of the viewport.
      const scrollableAncestor = (el) => {
        let n = el.parentElement;
        while (n && n !== document.body) {
          const cs = getComputedStyle(n);
          if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return 'SCROLLS';
          if (cs.overflowX === 'hidden') return 'CLIPPED';
          n = n.parentElement;
        }
        return null;
      };
      const over = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1.5) {
          if (scrollableAncestor(el) === 'SCROLLS') continue;   // reachable, fine
          over.push({
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
            right: Math.round(r.right),
            text: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
      // Tap targets that are too small to hit on a touch screen.
      const small = Array.from(document.querySelectorAll('button, a, [role=button]'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 24)).length;
      return {
        scrollWidth: de.scrollWidth,
        innerWidth: window.innerWidth,
        bodyText: (document.body.innerText || '').length,
        overflow: over.slice(0, 6),
        overflowCount: over.length,
        smallTargets: small,
        stuckLoading: /Reading\b/.test(document.body.innerText || ''),
      };
    });

    if (metrics.overflowCount > 0) {
      problems.push({ vp: vp.name, screen, kind: 'clipped',
        detail: `${metrics.overflowCount} element(s) past the right edge with no way to reach them`,
        offenders: metrics.overflow });
    }
    if (metrics.scrollWidth > metrics.innerWidth + 1) {
      problems.push({ vp: vp.name, screen, kind: 'h-overflow',
        detail: `scrollWidth ${metrics.scrollWidth} > innerWidth ${metrics.innerWidth}; ${metrics.overflowCount} elements past edge`,
        offenders: metrics.overflow });
    }
    if (errs.length) problems.push({ vp: vp.name, screen, kind: 'page-error', detail: errs.slice(0, 3).join(' | ') });
    if (metrics.bodyText < 120) problems.push({ vp: vp.name, screen, kind: 'near-empty', detail: `${metrics.bodyText} chars of text` });
    if (metrics.stuckLoading) problems.push({ vp: vp.name, screen, kind: 'stuck-loading', detail: 'still says "Reading…" after load' });

    await page.screenshot({ path: path.join(SHOTS, `${vp.name}-${screen}.png`), fullPage: false });
    console.log(`${vp.name.padEnd(9)} ${screen.padEnd(9)} sw=${String(metrics.scrollWidth).padStart(5)} iw=${String(metrics.innerWidth).padStart(5)} text=${String(metrics.bodyText).padStart(6)} over=${metrics.overflowCount} small=${metrics.smallTargets} ${errs.length ? 'ERR' : ''}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();

fs.writeFileSync(path.join(SHOTS, 'problems.json'), JSON.stringify(problems, null, 2));
console.log('\n=== PROBLEMS: ' + problems.length + ' ===');
for (const p of problems) {
  console.log(`- [${p.vp}/${p.screen}] ${p.kind}: ${p.detail}`);
  if (p.offenders) for (const o of p.offenders) console.log(`    <${o.tag} class="${o.cls}"> right=${o.right} "${o.text}"`);
}

/* Non-zero on any finding, so this can gate a push rather than only inform one.
   Screenshots stay in SHOTS either way — a problem you can see beats a problem
   you can only read about. */
process.exit(problems.length > 0 ? 1 : 0);
