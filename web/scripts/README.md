# Dev scripts

Not part of the build. Nothing in `app/` or `components/` imports these.

## `responsive-sweep.mjs` — look at the pixels

Renders every screen at 390 / 430 / 768 / 1280 / 1920 and fails on anything a
reader cannot reach: a page error, an element pushed past the right edge with no
scroll container behind it, a near-empty screen, or a screen still saying
"Reading" after the load settled.

It exists because five consecutive Build Log entries record screens "verified by
tsc and build, NOT by looking at pixels" — which is exactly how the
hardcoded-literal bugs survived on the phone for months. On its first run it
found four real defects, including a detail-tier switcher sitting at x=995 on a
768px tablet and a Live-trace spinner that could never resolve.

### The loop

```bash
# 1. a local database with the real schema
createdb proctordb
export DATABASE_URL=postgresql://localhost/proctordb
psql "$DATABASE_URL" -f ../migrations/001_init.sql
psql "$DATABASE_URL" -f ../migrations/002_track_boundaries.sql

# 2. three session shapes, through the REAL ingest path
python ../render-service/tools/make_fixture_session.py

# 3. capture the bundles the app would serve  (see the caveat below)
mkdir -p .sweep/bundles
npm run build && npx next start -p 3210 &
curl -s localhost:3210/api/sessions             > .sweep/bundles/sessions.json
for s in 1 2 3; do
  curl -s "localhost:3210/api/session/$s/data"  > .sweep/bundles/s$s.json
  curl -s "localhost:3210/api/session/$s/traces?laps=0,1,2,3" > .sweep/bundles/s${s}t.json
done

# 4. sweep. Non-zero exit on any finding; screenshots land in .sweep/shots
SWEEP_SESSION=1 SWEEP_TIER=deep node scripts/responsive-sweep.mjs
```

Worth running at least `SWEEP_SESSION=1` (nine clean laps) and
`SWEEP_SESSION=3` (**none** clean). The second is the one that catches spinners
that never resolve, because a session with no reference lap never seats a lap A.
Also sweep `SWEEP_TIER=everything`, which is the most content the layout ever
holds — every fold open at once.

### What it looks at, and what it once did not

Sideways: page errors, and anything past the right edge with no scroll container
behind it. Downwards, since 2026-09-05: `v-spill` (a box shorter than its own
content that no ancestor can scroll to) and `text-overlap` (two runs of body
text drawn on top of each other).

**The vertical pair exists because this script once passed a screen that was
visibly broken.** On 2026-09-01 it reported "0 problems everywhere" over ~180
page loads. A driver then photographed the Where-it-went detail panel printing
its honesty note straight across its own peak-lateral and tyre-temperature
readings — a panel squeezed below its content height by a flex parent, spilling
over the note beneath it. Every check in the list looked sideways; nothing
looked down. A sweep that cannot see the bug in the screenshot is not evidence,
however many page loads it makes.

Two lessons are baked into how those checks are written, both learned by getting
them wrong first:

* **Overflowing a box is not by itself a fault.** A scrub handle taller than its
  4px rail overflows on purpose and nothing is lost. `v-spill` therefore follows
  the content to where it actually reaches and asks whether the first ancestor
  that decides its fate scrolls (fine) or hides it *and* the content really does
  pass that edge (a bug).
* **`getBoundingClientRect` reports where a box WOULD be, not what the reader
  sees.** A row scrolled out of a pane still has a rect, and that rect can sit
  squarely on the footer below the pane. Every rect used by `text-overlap` is
  intersected with the client box of every clipping ancestor first, or every
  scrolling list on the page invents overlaps — the same mistake the right-edge
  check made in its first version, when it kept 51 findings that were all fine.

### Sweep every VIEW, not just every screen

Analyze is four layouts behind `?view=`, sharing nothing but the selection. For
its first year the sweep opened only the default, so `ribbon`, `map` and `line`
— 2,100 lines between them — had never been looked at. The run that first
included them found all three running off the right edge of a 768px tablet, the
map view with 104 elements past the edge and its whole right half unreachable.
`DESKTOP_SCREENS` carries the views explicitly for that reason; a new view
belongs in that list on the day it ships.

### Two traps in the run itself

* **A stale server is worse than no server.** `next start` keeps serving HTML
  that references the CSS hash of the build it started with. Rebuild underneath
  it and every page renders unstyled, the stylesheet 400s, and the sweep dutifully
  reports findings about a layout that does not exist. Kill the old process
  before each run — and if `npx next start` prints `EADDRINUSE`, the sweep you
  are about to run is measuring the OLD build.
* **Playwright may not own the browser.** Where the machine already has Chromium
  (a `PLAYWRIGHT_BROWSERS_PATH` install), a freshly installed `playwright` looks
  for a build number it does not have. Point `SWEEP_CHROME` at the binary that is
  actually there rather than downloading another.

### Caveat on step 3

`lib/db.ts` speaks Neon's HTTP driver, which will not talk to a plain local
Postgres — it derives an endpoint from the hostname and tries to reach
`https://api.<host>/sql`. Capturing bundles therefore needs either a Neon-backed
dev branch in `DATABASE_URL`, or a temporary local swap of `lib/db.ts` for a
`pg`-backed tagged-template shim with the same signature. **That swap must not
be committed**; the sweep itself never touches the database, so once the bundles
are captured the real driver goes straight back.

Making the app speak both drivers natively would remove this step, but it is a
change to the production data layer for a dev convenience, so it is written down
here rather than done quietly.

### Why bundles rather than a live database

Interception makes a sweep deterministic and re-runnable against any stored
session shape without re-ingesting. The bundles are still real: they come out of
the actual API routes and `lib/proctor/server/shape.ts`, which is where the
honesty rules about absent modules are enforced. Hand-written JSON would step
over exactly the seam worth testing.
