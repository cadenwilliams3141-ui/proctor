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
 *   - no box is SHORTER THAN ITS OWN CONTENT with no way to scroll  (v-spill)
 *   - no two runs of body text are drawn on top of each other  (text-overlap)
 *   - the screen is not near-empty
 *   - the screen is not still saying "Reading" after the load settled
 *
 * The right-edge condition is the subtle one. A child of an `overflow-x: auto`
 * box legitimately extends past the viewport — that is a scrollable table, not
 * a bug. A child of an `overflow-x: hidden` box is simply gone. The first
 * version of this script did not distinguish them, reported 51 "problems" on
 * one screen that were all fine, and would have buried the three that were
 * real.
 *
 * THE TWO VERTICAL CHECKS WERE ADDED 2026-09-05, and the reason is worth
 * keeping: this script passed with "0 problems everywhere" on 2026-09-01 over
 * ~180 page loads, and a driver then photographed the Where-it-went detail
 * panel printing its honesty note straight across its own peak-lateral and
 * tyre-temperature readings. Every check in the list looked SIDEWAYS. Nothing
 * looked down, so a panel squeezed below its content height by a flex parent —
 * spilling its overflow over the note beneath it — was invisible to the one
 * tool built to catch exactly that. A sweep that cannot see the bug in the
 * screenshot is not evidence, however many page loads it makes.
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

/* The Analyze screen is FOUR layouts, not one. ?view= picks between them and
   they share nothing but the selection — a ranked list beside a detail column,
   a shared-axis lane stack, a map with a delta trace, and a drawn racing line.
   Sweeping only the default meant three of the four had never been looked at,
   and they are 2,100 lines between them. */
const DESKTOP_SCREENS = [
  'sessions', 'report',
  'analyze', 'analyze&view=ribbon', 'analyze&view=map', 'analyze&view=line',
  'live', 'rig', 'upload',
];
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

    // `screen` may carry its own &view=, so it goes into the query verbatim.
    const url = `${BASE}${vp.app}?screen=${screen}`;
    const slug = screen.replace(/[&=]/g, '-');
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      problems.push({ vp: vp.name, screen: slug, kind: 'navigation', detail: String(e).slice(0, 200) });
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
      /* A BOX SHORTER THAN WHAT IS IN IT, WITH NO WAY TO SCROLL.
       *
       * This is the check that was missing, and its absence is why the
       * 2026-09-01 sweep reported "0 problems everywhere" on a screen where
       * a panel's honesty note was printed straight through the middle of its
       * own readings. Everything above this looks sideways; nothing looked
       * down.
       *
       * The signal is exact rather than heuristic. On a normal auto-height
       * block scrollHeight equals clientHeight. They separate only when
       * something has CONSTRAINED the box below its content — a flex item that
       * was allowed to shrink, a fixed height, a grid row that ran out. With
       * overflow-y visible there is then no scrollbar to reach the remainder,
       * so it spills out of the box and paints over whatever follows it. That
       * is not a near-miss to be judged by area or by eye: the box is smaller
       * than its content and the reader has no way to get at the rest. */
      /* Overflowing a box is not by itself a fault — a scrub handle taller than
         its 4px rail overflows on purpose and nothing is lost. What matters is
         whether the overflow ends up somewhere the reader cannot get to. So
         follow the content to where it actually reaches and compare that
         against the first ancestor that decides its fate: one that SCROLLS
         makes it reachable, one that HIDES loses it, but only if the content
         really does pass that ancestor's edge. */
      const trappedVertically = (el) => {
        const contentBottom = el.getBoundingClientRect().top + el.scrollHeight;
        for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (/(auto|scroll)/.test(cs.overflowY)) return false;  // reachable by scrolling
          if (cs.overflowY === 'hidden') return contentBottom > n.getBoundingClientRect().bottom + 1;
        }
        return false;   // reached the document, which scrolls
      };

      const spill = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (el === de || el === document.body) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'visible' || cs.display === 'inline') continue;
        if (el.clientHeight === 0) continue;               // not laid out
        if (el.scrollHeight <= el.clientHeight + 2) continue;
        if (!trappedVertically(el)) continue;              // the page can still scroll to it
        spill.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
          over: el.scrollHeight - el.clientHeight,
          text: (el.textContent || '').trim().slice(0, 48),
        });
      }

      /* The symptom the same bug shows on screen: two runs of text, both in
       * normal flow, sitting on top of each other. Kept alongside the check
       * above rather than in place of it — a spill is the cause and is precise,
       * an overlap is what the reader actually sees, and either can occur
       * without the other. Static position only: an overlap between positioned
       * elements is usually a deliberate one. */
      /* What the reader can ACTUALLY see of an element.
       *
       * getBoundingClientRect reports where a box would be if nothing cut it
       * off, so a list row scrolled out of its pane still has a rect — and
       * that rect can sit squarely on the footer below the pane. Comparing raw
       * rects invents an overlap for every scrolling list on the page. So each
       * rect is intersected with the client box of every ancestor that clips,
       * and with the viewport. An element whose visible rect is empty is not
       * on screen and cannot collide with anything. */
      const visibleRect = (el) => {
        let r = el.getBoundingClientRect();
        let top = r.top, left = r.left, bottom = r.bottom, right = r.right;
        for (let n = el.parentElement; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
          const nr = n.getBoundingClientRect();
          top = Math.max(top, nr.top); left = Math.max(left, nr.left);
          bottom = Math.min(bottom, nr.bottom); right = Math.min(right, nr.right);
        }
        top = Math.max(top, 0); left = Math.max(left, 0);
        bottom = Math.min(bottom, window.innerHeight); right = Math.min(right, window.innerWidth);
        return { top, left, bottom, right, width: right - left, height: bottom - top };
      };

      const leaves = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, td, li'))
        .filter((el) => {
          if (getComputedStyle(el).position !== 'static') return false;
          const t = (el.textContent || '').trim();
          if (t.length < 4) return false;
          // Leaf-ish: no descendant carries text of its own.
          return !Array.from(el.children).some((c) => (c.textContent || '').trim().length > 3);
        })
        .map((el) => ({ el, r: visibleRect(el), t: (el.textContent || '').trim() }))
        .filter(({ r }) => r.width > 4 && r.height > 4);

      const collisions = [];
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i], b = leaves[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w <= 1 || h <= 1) continue;
          const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
          if ((w * h) / smaller < 0.35) continue;         // a graze, not a collision
          collisions.push({ a: a.t.slice(0, 34), b: b.t.slice(0, 34) });
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
        spill: spill.slice(0, 6),
        spillCount: spill.length,
        collisions: collisions.slice(0, 6),
        collisionCount: collisions.length,
        smallTargets: small,
        stuckLoading: /Reading\b/.test(document.body.innerText || ''),
      };
    });

    if (metrics.overflowCount > 0) {
      problems.push({ vp: vp.name, screen: slug, kind: 'clipped',
        detail: `${metrics.overflowCount} element(s) past the right edge with no way to reach them`,
        offenders: metrics.overflow });
    }
    if (metrics.scrollWidth > metrics.innerWidth + 1) {
      problems.push({ vp: vp.name, screen: slug, kind: 'h-overflow',
        detail: `scrollWidth ${metrics.scrollWidth} > innerWidth ${metrics.innerWidth}; ${metrics.overflowCount} elements past edge`,
        offenders: metrics.overflow });
    }
    if (metrics.spillCount > 0) {
      problems.push({ vp: vp.name, screen: slug, kind: 'v-spill',
        detail: `${metrics.spillCount} box(es) shorter than their content with no way to scroll`,
        offenders: metrics.spill.map((s) => ({ tag: s.tag, cls: s.cls, right: s.over, text: s.text })) });
    }
    if (metrics.collisionCount > 0) {
      problems.push({ vp: vp.name, screen: slug, kind: 'text-overlap',
        detail: `${metrics.collisionCount} pair(s) of text drawn on top of each other`,
        offenders: metrics.collisions.map((c) => ({ tag: 'pair', cls: '', right: 0, text: `"${c.a}" over "${c.b}"` })) });
    }
    if (errs.length) problems.push({ vp: vp.name, screen: slug, kind: 'page-error', detail: errs.slice(0, 3).join(' | ') });
    if (metrics.bodyText < 120) problems.push({ vp: vp.name, screen: slug, kind: 'near-empty', detail: `${metrics.bodyText} chars of text` });
    if (metrics.stuckLoading) problems.push({ vp: vp.name, screen: slug, kind: 'stuck-loading', detail: 'still says "Reading…" after load' });

    await page.screenshot({ path: path.join(SHOTS, `${vp.name}-${slug}.png`), fullPage: false });
    console.log(`${vp.name.padEnd(9)} ${slug.padEnd(19)} sw=${String(metrics.scrollWidth).padStart(5)} iw=${String(metrics.innerWidth).padStart(5)} text=${String(metrics.bodyText).padStart(6)} over=${metrics.overflowCount} spill=${metrics.spillCount} clash=${metrics.collisionCount} small=${metrics.smallTargets} ${errs.length ? "ERR" : ""}`);
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
