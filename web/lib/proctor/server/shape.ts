/* Metric payloads → the shapes the analysis surface reads.
 *
 * The Python modules write honest, module-shaped JSON into session_metrics:
 * corner_sections carries corner windows, traction_circle carries a g-g cloud
 * with NULLs for bins it could not fill, tire_temps carries a 100-bin curve,
 * lockup_wheelspin carries event lists. The UI reads one SessionBundle. This
 * module is the join between the two, and it runs on the server so the desktop
 * and the phone get the same numbers from the same code.
 *
 * Two rules it exists to keep:
 *   - It never invents a value a module did not produce. A module that reported
 *     `insufficient_data` becomes a ModuleAbsence carrying its own `reason`;
 *     the corresponding array comes back EMPTY, and format.ts renders empty as
 *     "—". An empty panel must never be able to mean "no data".
 *   - Where it does derive something (corner radius, the envelope boundary),
 *     provenance.ts carries the sentence that says so, and that sentence is
 *     rendered under the panel.
 */

import type {
  Corner,
  EnvelopePoint,
  MetricPayloads,
  ModuleAbsence,
  TireBands,
  TrackEvent,
  TractionData,
} from "@/lib/proctor/types";

type Payload = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function block(metrics: MetricPayloads, key: string): Payload | null {
  const p = metrics[key];
  return p && typeof p === "object" ? (p as Payload) : null;
}

/** A module block is usable only if it ran and produced results. */
function ran(p: Payload | null): p is Payload {
  return p != null && p.insufficient_data !== true && p.error == null;
}

function nums(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [];
}

/** Rounded to `dp`, with non-finite values passed through as 0-length gaps
 *  removed by the caller rather than silently becoming zero. */
export function round(values: number[], dp: number): number[] {
  const f = 10 ** dp;
  return values.map((v) => (Number.isFinite(v) ? Math.round(v * f) / f : v));
}

/** Linear resample of a lap-periodic series onto `n` evenly spaced bins.
 *
 *  The lap is a closed loop, so the gap between the last source sample and the
 *  first is interpolated across the start/finish line rather than clamped —
 *  clamping would flat-spot the map and the tire curve at the line. */
function resampleCircular(srcPct: number[], srcVals: number[], n: number): number[] {
  const m = Math.min(srcPct.length, srcVals.length);
  if (m === 0 || n <= 0) return [];
  if (m === 1) return new Array<number>(n).fill(srcVals[0]);

  const out = new Array<number>(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    while (j < m - 1 && srcPct[j + 1] <= t) j++;
    const p0 = srcPct[j];
    // Past the last sample, wrap to the first one a full lap ahead.
    const wrapped = t < srcPct[0] || j === m - 1;
    const p1 = wrapped ? srcPct[0] + 1 : srcPct[j + 1];
    const v0 = wrapped ? srcVals[m - 1] : srcVals[j];
    const v1 = wrapped ? srcVals[0] : srcVals[j + 1];
    const base = t < srcPct[0] ? t + 1 : t;
    const span = (wrapped ? p1 - srcPct[m - 1] : p1 - p0) || 1;
    const from = wrapped ? srcPct[m - 1] : p0;
    const f = Math.min(1, Math.max(0, (base - from) / span));
    out[i] = v0 + (v1 - v0) * f;
  }
  return out;
}

const wrapIdx = (i: number, n: number) => ((i % n) + n) % n;

// ─────────────────────────────────────────────────────────────────────────────
// Corners
// ─────────────────────────────────────────────────────────────────────────────

/** Signed curvature at `i` from three points on the centreline, `h` apart.
 *  Positive is a left-hand turn (counter-clockwise in the x-east/y-north
 *  projection the parser writes). Returns null where the three points are
 *  collinear or coincident. */
function curvatureAt(
  x: number[],
  y: number[],
  i: number,
  h: number,
): number | null {
  const n = x.length;
  const a = wrapIdx(i - h, n);
  const b = wrapIdx(i, n);
  const c = wrapIdx(i + h, n);

  const abx = x[b] - x[a];
  const aby = y[b] - y[a];
  const bcx = x[c] - x[b];
  const bcy = y[c] - y[b];
  const cax = x[a] - x[c];
  const cay = y[a] - y[c];

  const lab = Math.hypot(abx, aby);
  const lbc = Math.hypot(bcx, bcy);
  const lca = Math.hypot(cax, cay);
  if (lab < 1e-6 || lbc < 1e-6 || lca < 1e-6) return null;

  // Twice the signed area of the triangle; its sign is the turn direction.
  const cross2 = abx * bcy - aby * bcx;
  const kappa = (2 * cross2) / (lab * lbc * lca);
  return Number.isFinite(kappa) ? kappa : null;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean distance between consecutive centreline samples, in metres. */
function meanSpacing(x: number[], y: number[], n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += Math.hypot(x[j] - x[i], y[j] - y[i]);
  }
  return sum / n;
}

/** Chord lengths the radius is fitted over, in metres.
 *
 *  Fixed in METRES rather than as a fraction of the corner, and deliberately
 *  short. A corner window from the parser starts at the braking point and ends
 *  where speed has recovered on the exit, so it is far longer than the curved
 *  part — measuring across the whole of it fits a circle through two straights
 *  and the bend between them, which is not the corner's radius. These stay
 *  inside the bend at any radius a circuit actually has. */
const FIT_CHORDS_M = [12, 20, 30, 45];

/** Beyond this the fit has not found a corner.
 *
 *  detect_corners works from speed, so an apex is the slowest point of a dip —
 *  which on a long sweeping section can sit on a piece of road that is very
 *  nearly straight. The circle through three points there has a radius in the
 *  tens of thousands of metres. That is not a corner radius, and printing it as
 *  one would be worse than saying nothing: the caller gets null and the screen
 *  says the geometry was not fitted. */
const MAX_PLAUSIBLE_RADIUS_M = 1500;

/** Radius and turn direction for one corner, fitted to the recorded GPS path.
 *
 *  Three points at several spacings, the median of their signed curvatures. A
 *  single triple is at the mercy of GPS jitter — one noisy metre across a short
 *  chord swings the fitted radius by hundreds of metres — so the spread of
 *  chord lengths and the median are what make the number stable. */
function fitCornerGeometry(
  x: number[],
  y: number[],
  apexIdx: number,
  spacing: number,
): { radius_m: number; dir: "left" | "right" } | null {
  const n = Math.min(x.length, y.length);
  if (n < 8 || !(spacing > 0)) return null;

  const maxH = Math.max(2, Math.floor(n / 8));
  const offsets = [
    ...new Set(
      FIT_CHORDS_M.map((m) => Math.min(maxH, Math.max(2, Math.round(m / spacing)))),
    ),
  ];

  const kappas = offsets
    .map((h) => curvatureAt(x, y, apexIdx, h))
    .filter((k): k is number => k != null);
  if (kappas.length === 0) return null;

  const k = median(kappas);
  if (!Number.isFinite(k) || k === 0) return null;

  const radius_m = Math.round(1 / Math.abs(k));
  if (radius_m > MAX_PLAUSIBLE_RADIUS_M) return null;

  return { radius_m, dir: k > 0 ? "left" : "right" };
}

/** Corner windows from corner_sections, with radius and direction.
 *
 *  If the parser has started emitting `radius_m`/`dir` itself, those win — this
 *  fit is the stand-in until it does, and it is labelled as derived geometry in
 *  provenance.ts either way. */
export function cornersFrom(
  metrics: MetricPayloads,
  map: { x_m: number[]; y_m: number[] },
): Corner[] {
  const cs = block(metrics, "corner_sections");
  if (!ran(cs) || !Array.isArray(cs.corners)) return [];

  const n = Math.min(map.x_m.length, map.y_m.length);
  const spacing = n > 0 ? meanSpacing(map.x_m, map.y_m, n) : 0;

  return (cs.corners as Payload[]).flatMap((c, i): Corner[] => {
    const start_pct = Number(c.start_pct);
    const apex_pct = Number(c.apex_pct);
    const end_pct = Number(c.end_pct);
    if (![start_pct, apex_pct, end_pct].every(Number.isFinite)) return [];

    const id = Number.isFinite(Number(c.id)) ? Number(c.id) : i + 1;

    // Parser-emitted geometry wins over the fit below.
    const emitted =
      Number.isFinite(Number(c.radius_m)) && (c.dir === "left" || c.dir === "right")
        ? { radius_m: Math.round(Number(c.radius_m)), dir: c.dir as "left" | "right" }
        : null;

    // The apex is the slowest point of the corner, which is where the line is
    // tightest — so it is the right place to measure the radius.
    const geom =
      emitted ??
      (n > 0
        ? fitCornerGeometry(map.x_m, map.y_m, wrapIdx(Math.round(apex_pct * n), n), spacing)
        : null);

    return [
      {
        id,
        start_pct,
        apex_pct,
        end_pct,
        // Null, not a sentinel: a corner whose geometry did not fit says so.
        radius_m: geom?.radius_m ?? null,
        dir: geom?.dir ?? null,
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Traction
// ─────────────────────────────────────────────────────────────────────────────

/** The g-g boundary, closed and smoothed.
 *
 *  traction_circle bins at 10° and writes NULL for a bin with too few ticks to
 *  speak for — the honest raw answer. Drawn as-is that cuts a notch in the
 *  polygon which reads as a real hole in the driver's envelope, so the boundary
 *  is closed here, on the server:
 *
 *    1. a ±10° rolling maximum over the populated bins, then
 *    2. circular interpolation across whatever gaps are still open.
 *
 *  This is a decision the handoff left open (§3.4) and it is taken on the UI
 *  side of the line on purpose: the parser's NULL is the truthful measurement
 *  and is left alone in the database, while the smoothing is a drawing concern
 *  that belongs with the drawing. The label under every g-g plot says the
 *  boundary is an estimate — see provenance.ts → traction.envelope. */
function smoothEnvelope(raw: (number | null)[]): EnvelopePoint[] {
  const bins = raw.length;
  if (bins === 0) return [];

  const rolled: (number | null)[] = raw.map((_, b) => {
    const window = [raw[wrapIdx(b - 1, bins)], raw[b], raw[wrapIdx(b + 1, bins)]].filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    return window.length ? Math.max(...window) : null;
  });

  const populated = rolled
    .map((v, b) => (v != null ? b : -1))
    .filter((b) => b >= 0);
  if (populated.length === 0) return [];

  const width = 360 / bins;
  return rolled.map((v, b) => {
    let g = v;
    if (g == null) {
      // Still open: interpolate circularly between the nearest populated bins.
      let before = populated[populated.length - 1] - bins;
      let after = populated[0] + bins;
      for (const p of populated) {
        if (p < b && p > before) before = p;
        if (p > b && p < after) after = p;
      }
      const span = after - before;
      const f = span === 0 ? 0 : (b - before) / span;
      const v0 = rolled[wrapIdx(before, bins)] as number;
      const v1 = rolled[wrapIdx(after, bins)] as number;
      g = v0 + (v1 - v0) * f;
    }
    return { angle_deg: b * width + width / 2, g: Math.round(g * 1000) / 1000 };
  });
}

export function tractionFrom(metrics: MetricPayloads): TractionData {
  const tc = block(metrics, "traction_circle");
  if (!ran(tc)) return { scatter: [], envelope: [], laps: {} };

  const scatter: [number, number][] = Array.isArray(tc.scatter)
    ? (tc.scatter as unknown[]).flatMap((p) => {
        const pair = Array.isArray(p) ? p : [];
        const lat = Number(pair[0]);
        const lon = Number(pair[1]);
        return Number.isFinite(lat) && Number.isFinite(lon)
          ? ([[lat, lon]] as [number, number][])
          : [];
      })
    : [];

  const rawBins: (number | null)[] = Array.isArray(tc.envelope)
    ? (tc.envelope as Payload[]).map((e) => {
        const g = Number(e?.g);
        return Number.isFinite(g) ? g : null;
      })
    : [];

  /* Per-lap utilisation, straight from the module — a percentage of the
     driver's own envelope. Laps the module could not score are OMITTED rather
     than recorded as 0%: the bars scale 0-100, so a zero would draw as "used
     none of your grip" when the truth is "not measurable on this lap". */
  const laps: Record<number, number> = {};
  const lapBlock = tc.laps;
  if (lapBlock && typeof lapBlock === "object") {
    for (const [lapNo, v] of Object.entries(lapBlock as Record<string, Payload>)) {
      // The module writes NULL for a lap it could not score. Number(null) is 0,
      // so this has to reject null BEFORE the coercion — a bar at 0% would read
      // as "used none of your grip" when the truth is "not measurable here".
      const raw = v?.utilization_pct;
      if (raw == null) continue;
      const pct = Number(raw);
      const n = Number(lapNo);
      if (Number.isFinite(pct) && Number.isFinite(n)) laps[n] = pct;
    }
  }

  return { scatter, envelope: smoothEnvelope(rawBins), laps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tire, events, map
// ─────────────────────────────────────────────────────────────────────────────

/** Left-front surface temps on the shared distance grid.
 *
 *  tire_temps writes a 100-bin curve; the ribbon and the corner cards index it
 *  by grid sample, so it is resampled here. No curve means empty arrays, which
 *  format.ts renders as "—" — never as a temperature of zero. */
export function tireFrom(metrics: MetricPayloads, gridSize: number): TireBands {
  const tt = block(metrics, "tire_temps");
  const curve = ran(tt) ? (tt.curve as Payload | undefined) : undefined;
  if (!curve || gridSize <= 0) return { left_c: [], middle_c: [], right_c: [] };

  const pct = nums(curve.grid_pct);
  const at = (key: string) => {
    const v = nums(curve[key]);
    return v.length ? round(resampleCircular(pct, v, gridSize), 1) : [];
  };
  return { left_c: at("left_c"), middle_c: at("middle_c"), right_c: at("right_c") };
}

/** Lockups and wheelspin, positioned on the lap for the track map. */
export function eventsFrom(metrics: MetricPayloads): TrackEvent[] {
  const lw = block(metrics, "lockup_wheelspin");
  if (!ran(lw)) return [];

  const take = (key: string, kind: TrackEvent["kind"]): TrackEvent[] =>
    Array.isArray(lw[key])
      ? (lw[key] as Payload[]).flatMap((e) => {
          const pct = Number(e?.start_pct);
          const lap = Number(e?.lap);
          return Number.isFinite(pct) && Number.isFinite(lap)
            ? [{ kind, pct, lap_number: lap }]
            : [];
        })
      : [];

  return [...take("lockups", "lockup"), ...take("wheelspin", "wheelspin")];
}

/** The circuit centreline on the shared grid.
 *
 *  track_map projects the reference lap's own GPS to local metres. It is
 *  already on the parser's grid, so this normally passes straight through;
 *  the resample is there for the case where the two grids ever diverge. */
export function mapFrom(
  metrics: MetricPayloads,
  gridSize: number,
): { x_m: number[]; y_m: number[] } {
  const tm = block(metrics, "track_map");
  if (!ran(tm)) return { x_m: [], y_m: [] };

  const x = nums(tm.x_m);
  const y = nums(tm.y_m);
  if (x.length === 0 || y.length === 0) return { x_m: [], y_m: [] };
  if (gridSize <= 0 || x.length === gridSize) return { x_m: x, y_m: y };

  const pct = nums(tm.grid_pct);
  const src = pct.length === x.length ? pct : x.map((_, i) => i / x.length);
  return {
    x_m: round(resampleCircular(src, x, gridSize), 2),
    y_m: round(resampleCircular(src, y, gridSize), 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Absences
// ─────────────────────────────────────────────────────────────────────────────

/** What this session cannot say, and why.
 *
 *  Three of these are permanent walls in the file format itself. The rest are
 *  read back off the modules: a module that reported `insufficient_data`
 *  contributes its OWN `reason` verbatim, so the screen shows the parser's
 *  words rather than a guess at what went wrong. */
export function absencesFrom(
  metrics: MetricPayloads,
  session: { wear_masked: boolean },
): ModuleAbsence[] {
  const out: ModuleAbsence[] = [
    {
      key: "brake_temp",
      title: "Brake temperature",
      reason:
        "The .ibt carries no brake-temperature channel — only line pressure. Nothing is estimated in its place.",
      permanent: true,
    },
    {
      key: "racecraft",
      title: "Racecraft and positioning",
      reason:
        "Other-car channels (CarIdx) are not written to disk .ibt files, so nothing can be said about traffic, position or intent.",
      permanent: true,
    },
  ];

  // The other three tire corners: the module states this itself, so use its
  // reason rather than asserting the shape of the v1 channel contract here.
  const tt = block(metrics, "tire_temps");
  const other = tt?.other_corners as Payload | undefined;
  if (other?.available === false) {
    out.push({
      key: "tire_other_corners",
      title: "Tire temperature, other three corners",
      reason: `Left-front is the only tire-temperature channel in the file (${String(
        other.reason ?? "other corners not carried",
      )}). The other three corners are absent, not zero.`,
      permanent: true,
    });
  }

  if (session.wear_masked) {
    out.push({
      key: "tire_wear",
      title: "Tire wear over the session",
      reason:
        "This session reports wear_masked — iRacing froze wear, so no wear trend is claimed from it.",
      permanent: false,
    });
  }

  /* Modules that could not run on THIS session. Not permanent: the channel
     exists, this file just did not carry enough of it. The module's own reason
     is what gets rendered. */
  const TITLES: Record<string, string> = {
    corner_sections: "Per-corner section deltas",
    corner_context: "Corner context",
    delta_time: "Delta time",
    input_overlay: "Input overlay",
    track_map: "Track map",
    traction_circle: "Traction circle",
    tire_temps: "Tire temperature",
    lockup_wheelspin: "Lockups and wheelspin",
    shift_analysis: "Shift analysis",
    hardware: "Rig and hardware",
    balance: "Balance",
    report_card: "Session report",
  };

  for (const [key, title] of Object.entries(TITLES)) {
    const p = block(metrics, key);
    if (p == null) {
      out.push({
        key,
        title,
        reason:
          "This module was not computed for this session — it produced no block at ingest, so nothing is shown for it.",
        permanent: false,
      });
      continue;
    }
    if (p.insufficient_data === true) {
      out.push({
        key,
        title,
        reason: String(p.reason ?? "the module reported insufficient data and gave no reason"),
        permanent: false,
      });
    } else if (p.error != null) {
      out.push({
        key,
        title,
        reason: `The module failed on this session: ${String(p.error)}. Nothing was fabricated in its place.`,
        permanent: false,
      });
    }
  }

  return out;
}
