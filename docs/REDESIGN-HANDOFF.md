# Proctor redesign — connector handoff

**For whoever has the Neon / Render / Vercel credentials.**

The redesigned desktop app and phone app are built and working. They were built
deliberately **away from the connectors**, so right now every number on screen
comes from a synthetic generator. Your job is to point them at the real data.

There is **one module to change**. Everything else is already done.

---

## TL;DR

1. Implement three methods in `web/lib/proctor/data-source.ts` → `neonSource`.
2. Add two API routes (`/api/sessions`, `/api/ingest`) and extend one
   (`/api/session/[id]/data`).
3. Set `NEXT_PUBLIC_PROCTOR_DATA_SOURCE=neon` in Vercel.
4. Delete `web/lib/proctor/fixture/`.

No component changes. No layout changes. If the payloads match the shapes below,
every screen lights up with real telemetry.

---

## 1. What was built

| Route | What it is |
|---|---|
| `/` | **Desktop app.** One shell replacing the four old routes: 56px icon rail, 248px lap rail, workspace. Six screens (Sessions, Session report, Analyse, Live trace, Rig health, Upload) and three analysis views over the same selection. |
| `/m` | **Phone app.** A separate build, not the desktop squeezed. Ranked corners as the home screen, corner detail as a bottom sheet, four tabs. |
| `/?screen=…&view=…` | Deep link into a particular reading of a lap. Skips the launch screen. |

The three analysis views — **Where it went** (ranked corners), **Ribbon** (all
channels on one shared distance axis), **Map & delta** — share one selection
state: lap A, lap B, cursor and selected corner all survive a view change.

### Files

```
web/lib/proctor/
  data-source.ts     ← THE ONLY FILE YOU NEED TO CHANGE
  types.ts             payload shapes (the contract)
  provenance.ts        which numbers are measured vs derived — drives UI copy
  ledger.ts            corner ledger: per-corner delta for any lap pair
  channels.ts          the ONLY place raw channel hexes live
  ramps.ts             speed + tire-temp colour ramps
  geometry.ts          shared SVG projection / path helpers
  format.ts            all number formatting
  store.tsx            client state for the analysis surface
  fixture/generate.ts  DELETE THIS once you are live
web/components/proctor/
  AppShell.tsx, shell/*, views/*, screens/*, mobile/*, ui/*
```

---

## 2. The swap

`web/lib/proctor/data-source.ts` exports one interface with three methods and
two implementations. `fixtureSource` is complete; `neonSource` is stubbed with
the fetch calls already written. Fill in the routes behind them.

```ts
export interface DataSource {
  loadSession(sessionId: string): Promise<SessionBundle>;
  loadTraces(sessionId: string, lapNumbers: number[]): Promise<Trace[]>;
  listSessions(): Promise<SessionRow[]>;
  listIngest(): Promise<IngestRow[]>;
}
```

Then in Vercel:

```bash
NEXT_PUBLIC_PROCTOR_DATA_SOURCE=neon
```

`NEXT_PUBLIC_` is required — the analysis surface is a client component tree
(shared cursor, ribbon pointer tracking, live sweep all need client state).

When that flag is not `neon`, the app renders a **"sample data"** chip in the
top bar on desktop and a banner on mobile. That is intentional: a screen full of
plausible telemetry that did not come from a `.ibt` is exactly what the honesty
rules exist to prevent, including when the audience is us. **The chip disappears
by itself** once the flag flips — do not remove it by hand.

---

## 3. What the backend must supply

`/api/session/[id]/data` already returns `{ session, laps, metrics }`. It now
needs to return a full `SessionBundle`. Fields marked **NEW** do not exist yet.

```ts
interface SessionBundle {
  session: SessionMeta;      // already returned
  laps: Lap[];               // already returned
  traces: Record<number, Trace>;  // lap_number -> trace (or load lazily)
  metrics: MetricPayloads;   // already returned
  corners: Corner[];         // NEW — see 3.1
  traction: TractionData;    // from traction_circle; envelope NEW — see 3.4
  tire: TireBands;           // left-front L/M/R arrays
  events: TrackEvent[];      // lockups + wheelspin, with lap_number
  gridSize: number;          // samples on the shared distance grid
  map: { x_m: number[]; y_m: number[] };  // circuit centreline, gridSize long
  absences: ModuleAbsence[]; // NEW — see 3.5
}
```

### 3.1 Corner geometry — `radius_m` and `dir` **(NEW)**

```ts
interface Corner {
  id: number;
  start_pct: number; apex_pct: number; end_pct: number;
  radius_m: number;          // NEW
  dir: "left" | "right";     // NEW
}
```

The parser already has curvature. It should emit radius and turn direction
directly rather than making the UI infer them. **Until it does**, the UI labels
these as inferred — see `provenance.ts` → `corner.radius_m`. Keep that label
truthful: remove it when the parser starts emitting the real values, and not
before.

### 3.2 Per-corner delta by sub-section, for **any** lap pair **(NEW)**

This is the most important one. `corner_sections.per_lap` already carries four
values per corner, but only against the stored reference lap. The ranked view
needs them for **whichever lap B the driver picked**.

Today `web/lib/proctor/ledger.ts` derives them client-side: it integrates
`ds/v` from the `speed` channel to get an elapsed-time curve per lap, differences
the two curves, and splits each corner's window into four equal sub-sections.
That works and is honest, but it is the UI doing the parser's job.

**Two details that are easy to get wrong**, both handled in `ledger.ts` and both
worth copying rather than re-deriving:

1. **Corner windows must not overlap.** Two corners sharing samples both bill the
   same tenth, per-corner deltas then sum to more than the lap gap, and the
   "straights" remainder goes negative — which shows the driver time appearing
   from nowhere. `ledger.ts` clamps each padded window at the midpoint of the gap
   to its neighbour, so every sample belongs to at most one corner.
2. **The elapsed-time curve is scaled to the recorded lap time.** Integrating
   `ds/v` over a resampled grid does not land exactly on `lap_time_s`. Rather
   than let the headline number disagree with the lap times beside it, the curve
   is scaled so its total *is* the recorded lap time.

### 3.3 `remainder` **(NEW, and load-bearing)**

```
remainder = lapDelta − Σ cornerDeltas
```

The corners genuinely do not add up to the lap. The difference is what happened
on the parts that are not corners, and it gets **its own block** in the
contribution bar labelled "straights".

**Do not distribute it into the corners.** That would be fabrication, and it is
the single most important honesty affordance on the most important screen.

The UI already handles a **negative** remainder (corners accounting for more than
the lap gap): no block is drawn, and a sentence states it explicitly instead.
Don't "fix" that by clamping — a negative remainder is a real result.

### 3.4 Envelope boundary policy

The g-g envelope is binned at 10°. A single empty bin cuts a false notch in the
polygon, which reads as a real hole in the driver's envelope. The UI currently
applies a **±10° rolling maximum** and labels the result a boundary *estimate*.

**Decide whether the parser or the UI owns that smoothing.** Either is fine. The
label has to stay honest either way — it lives in `provenance.ts` under
`traction.envelope` and is rendered under every g-g plot in both apps.

Also needed: **per-lap envelope utilisation** for every clean lap
(`traction_circle.laps` already has this). The Rig health bars scale **0–100%,
not normalised to the best lap** — a lap at 80% must read as 80%.

### 3.5 Absences **(NEW)**

```ts
interface ModuleAbsence {
  key: string; title: string; reason: string;
  permanent: boolean;  // true = no channel exists at all
}
```

A module that reported `insufficient_data` renders its `reason` as a finding. A
module never computed says so. **An empty panel must never be able to mean
"no data"** — that is the confusion these rules exist to prevent.

The four the fixture ships with, which should come from the real modules:
brake temperature (permanent — no channel), tire temp on the other three corners
(permanent), racecraft (permanent — no `CarIdx` on disk), and tire wear when
`wear_masked` is true (not permanent).

### 3.6 Two new routes

- **`GET /api/sessions`** → `SessionRow[]`, newest first. `SessionRow` is
  `SessionMeta` plus `pace: number[]` — the clean-lap times in lap order, which
  drive the per-session sparkline. Each sparkline is on **its own scale**; two
  different tracks are not comparable.
- **`GET /api/ingest`** → `IngestRow[]`. Files not yet a readable session, plus
  the most recent few that are. **A failed row must always carry its
  `error_detail`.** A failure with no reason is worse than no row at all.

---

## 4. Honesty rules the UI now depends on

These are not copy suggestions. Each one is load-bearing in code somewhere, and
breaking it is a bug:

| Rule | Where it lives |
|---|---|
| Observations, not verdicts | `ledger.ts` → `observation()`. No prescription anywhere in it, and none may be added. |
| Missing ≠ zero | `format.ts` returns `—` for null, never `0`. |
| Negative results are findings | `RigScreen` event tables say "None detected this session." |
| Limits come from the driver's own data, labelled | `provenance.ts`, rendered under every panel that shows a limit. |
| Hidden-by-preference ≠ missing | `tier.ts` → `hiddenNote()`. **The count must be accurate** — claiming a panel is hidden when none is teaches the reader to ignore the note. |
| Flagged laps stay visible, stay excluded | `LapRail` dims them; `isUsable()` excludes them. |
| "Wear masked" travels with the session | Chip in the lap rail, sessions table, report header, phone header. |
| The live sweep is not a replay | See §5. |

`provenance.ts` is the single place these labels are written. Change the text
there and it changes everywhere it is shown.

---

## 5. Decision needed before Live trace ships

The Live screen is a **constant-distance sweep, not a real-time replay** — even
at 1×. The traces are distance-resampled, so wall-clock elapsed time matches the
lap time but the car does not decelerate where the driver decelerated. The UI
says exactly that, in those words.

To make it a genuine replay the parser must keep the **original time base**
alongside the distance grid, and playback must advance by *time* index rather
than distance index.

**Until then, do not relabel it a replay.** The wording has to stay true either
way. `sweepSeconds = lap_time_s / multiplier`; default multiplier 4; the choice
persists to `localStorage`.

---

## 6. Deviations from the design spec, and why

Three, all deliberate — flagging them so they are decisions rather than drift:

1. **Icons are lucide, not Phosphor.** Phosphor is what the design specifies;
   lucide is what is already vendored in this app. Every glyph is mapped to its
   nearest lucide equivalent. The one that is not like-for-like is
   `steering-wheel` → `Gauge` (lucide has no steering wheel; Gauge reads as
   instrumentation, which is what Rig health is). Swap to
   `@phosphor-icons/react` if you want exact parity — only the icon imports
   change.
2. **`ResizablePanel` is gone.** Panels size to a deliberate layout instead of
   being user-resized. This was dropped on purpose, not overlooked. If per-panel
   resizing is a workflow anyone relies on, say so.
3. **The old routes are still there.** `web/app/session/[id]/{page,laps,live,hardware}`
   and the old components in `web/components/*.tsx` are superseded by the
   redesign but were **not deleted** — nothing was destroyed. Delete them once
   you are satisfied the new surface covers everything. The tier module was
   renamed casual/intermediate/advanced → glance/deep/everything, with the old
   cookie values mapped forward so returning users don't silently change tier.

---

## 7. The fixture

`web/lib/proctor/fixture/generate.ts` is synthetic telemetry. **Delete it once
you are live.** Nothing outside `data-source.ts` imports it.

It is not random numbers — it builds a closed 5.77 km circuit as a curvature
profile, integrates it to a centreline, then solves a grip-limited speed profile
forward and backward around the loop against a combined-grip friction ellipse
(exponent 2.9, which is what lets trail-braking fill the lower quadrants of the
g-g plot). Sixteen laps get per-corner deficits with a phase — entry, mid or
exit — so the ranked list varies the way real laps do.

The numbers it produces are internally consistent (reference lap 2:06.880, clean
laps spread ~1.2 s σ, peak 1.5 g lateral / 1.4 g braking) but they are **not a
real driver's laps** and must never be presented as measurements.

Two notes if you compare against the design prototypes:

- The prototypes' `telemetry.js` was not in the handoff bundle I received, so
  this generator was written from the stated parameters rather than ported. Lap
  times land around 2:07 rather than the prototypes' 2:17 — same circuit length
  and same grip ceilings, different corner layout. It is a fixture; it does not
  matter, but it is why the numbers differ from the mockups.
- Design tokens **were** ported verbatim from Nocturne's `styles.css` into
  `web/app/globals.css`, including the density-0.70× spacing scale, the three
  shadow steps and the fading-rule signature.

---

## 8. Verification

```bash
cd web && npx tsc --noEmit && npm run build
```

> **If you are building on a Windows exFAT volume, `next build` will fail** with
> `EISDIR: illegal operation on a directory, readlink '…'` pointing at some file
> inside `node_modules`. This is the filesystem, not the code: exFAT has no
> symlink support, and on it Node's `fs.readlink` throws `EISDIR` for *every*
> regular file — `package.json` included. Next's build-time module resolution
> calls `readlink`, so the build cannot complete there. `next dev`,
> `tsc --noEmit` and `next build --turbopack`'s compile+typecheck stage all work
> fine. On Vercel (Linux) it is a non-issue. If you hit it locally, build from
> an NTFS drive.

Also note `lib/db.ts` now creates its Neon client **lazily**, on first query.
Creating it at import time made `next build` fail whenever `DATABASE_URL` was
absent — a route that is never called should not be able to fail a build. The
query API is unchanged; every existing `sql\`…\`` call site still works.

Then, with the connectors wired, the things worth checking by eye:

- The **remainder** is small and positive on most lap pairs. Large or wildly
  negative means the corner windows are overlapping — see §3.2.
- The contribution bar's blocks plus the "straights" block fill the full width.
- A failed ingest row shows its `error_detail`.
- The **"sample data"** chip is gone.
