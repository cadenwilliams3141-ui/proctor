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
