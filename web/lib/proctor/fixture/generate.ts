/* ╔═══════════════════════════════════════════════════════════════════════╗
   ║  DEVELOPMENT FIXTURE — SYNTHETIC TELEMETRY. NOT FROM A REAL .ibt.     ║
   ║                                                                       ║
   ║  Nothing in this file may reach production. It exists so the redesign ║
   ║  renders while the app is built away from the database. Every screen  ║
   ║  reads through lib/proctor/data-source.ts; swapping that one module   ║
   ║  for the real API removes this file from the running app entirely.    ║
   ║                                                                       ║
   ║  The numbers are internally consistent — they come out of a physical  ║
   ║  model, not a random-number generator — but they are not a real       ║
   ║  driver's laps and must never be presented as measurements.           ║
   ╚═══════════════════════════════════════════════════════════════════════╝

   The model, in order:
     1. A closed ~5.77 km circuit built as a curvature profile: 14 raised-cosine
        bumps, one per corner, integrated to heading and then to position.
     2. A grip-limited speed profile solved forward and backward around the
        loop against a combined-grip friction ellipse. The exponent is 2.9 —
        above 2, which is what lets trail-braking fill the lower quadrants of
        the g-g plot instead of leaving them empty.
     3. Per-lap corner deficits, so 16 laps differ the way a driver's do.
     4. Channels derived from the solved profile, then resampled onto one
        shared distance grid — the same distance-resampled shape the parser
        writes, which is why the live sweep is a distance sweep and says so. */

import type {
  Corner,
  Lap,
  SessionBundle,
  Trace,
  TrackEvent,
} from "@/lib/proctor/types";

const N = 900; // samples on the shared distance grid
const TRACK_M = 5770;
const DS = TRACK_M / N;

const G = 9.81;
const A_LAT_MAX = 1.5 * G; // peak lateral the model will allow
const A_BRAKE_MAX = 1.4 * G;
const V_TOP = 63; // m/s, ~227 km/h — a twisty layout, not a power circuit
const ELLIPSE_P = 2.9;
const WHEELBASE = 2.45;
const STEER_RATIO = 13;

/** Upshift point for each gear, km/h. Index is the gear; index 1 is the top of
 *  first. One table drives both the gear readout and the rev fraction. */
const GEAR_TOP_KMH = [0, 62, 96, 138, 182, 224, 260, 290];

/** Deterministic PRNG so every reload shows the same session. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (i: number) => ((i % N) + N) % N;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The circuit
// ─────────────────────────────────────────────────────────────────────────────

interface CornerSpec {
  center: number; // 0..1 along the lap
  radius: number; // metres
  angle: number; // degrees of turn — this and the radius set the arc LENGTH
  dir: 1 | -1; // +1 right, -1 left
  /** half-width as a fraction of the lap, derived from radius x angle */
  half: number;
}

/** A corner occupies exactly as much of the lap as its own geometry says:
 *  arc length = radius x angle. Guessing widths independently of radius is how
 *  you end up with corners that tile the entire circuit and no straights left
 *  for the remainder to live on. */
function spec(
  center: number,
  radius: number,
  angle: number,
  dir: 1 | -1,
): CornerSpec {
  const arc = radius * (angle * (Math.PI / 180));
  return { center, radius, angle, dir, half: arc / (2 * TRACK_M) };
}

/* Fourteen corners: a fast opening sweep, a technical middle sector, a long
   right onto the back straight, and a tight complex before the line. Together
   they occupy roughly a third of the lap — the rest is straight, which is
   exactly what the "straights" remainder block on the analysis screen is
   accounting for. */
const SPEC: CornerSpec[] = [
  spec(0.075, 95, 105, 1),
  spec(0.135, 62, 95, -1),
  spec(0.196, 150, 70, 1),
  spec(0.258, 48, 150, -1),
  spec(0.318, 190, 55, 1),
  spec(0.384, 78, 110, 1),
  spec(0.441, 55, 125, -1),
  spec(0.507, 210, 60, 1),
  spec(0.573, 70, 100, -1),
  spec(0.632, 105, 90, 1),
  spec(0.697, 45, 170, 1),
  spec(0.764, 165, 65, -1),
  spec(0.848, 88, 100, 1),
  spec(0.922, 60, 120, 1),
];

/** Raised cosine — smooth to zero at both ends, so curvature never steps. */
function bump(x: number): number {
  if (Math.abs(x) >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * x));
}

function buildCircuit() {
  // Signed curvature, 1/m.
  const kappa = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    const p = i / N;
    for (const c of SPEC) {
      // Nearest wrap of the corner centre, so corner 14 can straddle the line.
      let d = p - c.center;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      kappa[i] += (c.dir / c.radius) * bump(d / c.half);
    }
  }

  // A closed circuit turns through exactly one full revolution. The corners
  // alone fall short of that, and SCALING them all up to make up the shortfall
  // would silently shrink every radius — the map would then disagree with the
  // radius printed beside it. Instead the shortfall goes onto the straights as
  // a constant offset, which is what a real circuit does anyway: its straights
  // are gentle curves. Corner radii survive intact.
  const cornerTurn = kappa.reduce((s, k) => s + k * DS, 0);
  const sweep = (2 * Math.PI - cornerTurn) / TRACK_M;
  for (let i = 0; i < N; i++) kappa[i] += sweep;

  // Integrate: curvature -> heading -> position.
  const heading = new Array<number>(N).fill(0);
  let h = 0;
  for (let i = 0; i < N; i++) {
    heading[i] = h;
    h += kappa[i] * DS;
  }
  const x = new Array<number>(N).fill(0);
  const y = new Array<number>(N).fill(0);
  let px = 0;
  let py = 0;
  for (let i = 0; i < N; i++) {
    x[i] = px;
    y[i] = py;
    px += Math.cos(heading[i]) * DS;
    py += Math.sin(heading[i]) * DS;
  }
  // Numerical drift leaves a small gap at the start/finish line. Distribute it
  // linearly so the loop closes exactly instead of showing a visible seam.
  const dx = px;
  const dy = py;
  for (let i = 0; i < N; i++) {
    x[i] -= (i / N) * dx;
    y[i] -= (i / N) * dy;
  }

  return { kappa, x, y };
}

const CIRCUIT = buildCircuit();

/** Corner windows and geometry, read back off the circuit's own curvature —
 *  the same thing the parser does, and the reason the UI can label these
 *  "from the reference lap's own curvature" honestly. */
function buildCorners(): Corner[] {
  const { kappa } = CIRCUIT;
  return SPEC.map((c, idx) => {
    const from = wrap(Math.round((c.center - c.half) * N));
    const to = wrap(Math.round((c.center + c.half) * N));
    // Apex = the tightest point in the window.
    let apex = from;
    let peak = 0;
    for (let i = 0; i <= Math.round(2 * c.half * N); i++) {
      const k = wrap(from + i);
      if (Math.abs(kappa[k]) > peak) {
        peak = Math.abs(kappa[k]);
        apex = k;
      }
    }
    return {
      id: idx + 1,
      start_pct: from / N,
      apex_pct: apex / N,
      end_pct: to / N,
      radius_m: Math.round(1 / Math.max(peak, 1e-6)),
      dir: c.dir === 1 ? "right" : "left",
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The speed profile
// ─────────────────────────────────────────────────────────────────────────────

/** Combined-grip friction ellipse. How much longitudinal grip is left once
 *  `latUsed` (0..1) of the lateral budget is spent. Exponent above 2 keeps
 *  meaningful longitudinal grip available at high lateral load, which is what
 *  trail-braking looks like in the data. */
function longitudinalAvailable(latUsed: number): number {
  const u = Math.min(1, Math.max(0, latUsed));
  return Math.pow(Math.max(0, 1 - Math.pow(u, ELLIPSE_P)), 1 / ELLIPSE_P);
}

/** Power-limited acceleration: strong out of a hairpin, tailing off toward
 *  Vmax as drag catches up. ~1.05 g in second, ~0.15 g at the top of sixth. */
function accelCeiling(v: number): number {
  return Math.max(1.1, 8.9 * (1 - v / (V_TOP * 1.08)));
}

/** Where in a corner a lap's deficit sits, in units of the corner's own half-
 *  width. -1 is turn-in, 0 the apex, +1 the track-out point.
 *
 *  This exists because a uniform speed deficit always produces the SAME answer:
 *  time lost is ds*(1/vB - 1/vA), and 1/v blows up at the slowest point, so
 *  every corner would report "most of it from the apex out" no matter what the
 *  driver did. That reads as a canned sentence rather than a finding. Real
 *  deficits have a phase, and the third one below is the interesting case —
 *  a late throttle pickup costs time PAST the corner exit, out on the straight,
 *  which is why its window reaches beyond the corner. */
const PHASE = {
  entry: { at: -1.0, width: 1.1 }, // braked early / turned in slow
  mid: { at: 0.0, width: 0.9 }, // missed the apex
  exit: { at: 0.85, width: 1.35 }, // hesitant on the power
} as const;

export type PhaseName = keyof typeof PHASE;

/** Raised cosine centred on the phase. */
function phaseWeight(u: number, name: PhaseName): number {
  const { at, width } = PHASE[name];
  const d = (u - at) / width;
  if (Math.abs(d) >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * d));
}

/** Solve the grip-limited profile for one lap.
 *
 *  `cornerScale[i]` is the fraction of the available speed the driver used
 *  through corner i — 1 is the model's own limit, which only the reference lap
 *  reaches. `cornerPhase[i]` says where that deficit lands. */
function solveLap(cornerScale: number[], cornerPhase: PhaseName[]): number[] {
  const { kappa } = CIRCUIT;

  const cap = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kappa[i]);
    // The cornering cap from curvature alone; V_TOP out on the straights.
    const raw = k < 1e-6 ? V_TOP : Math.min(V_TOP, Math.sqrt(A_LAT_MAX / k));

    // Attribute this sample to its nearest corner, and place it within that
    // corner in half-width units. Straights get a u well past +/-1, which is
    // exactly where the `exit` phase still bites.
    const p = i / N;
    let best = 0;
    let bestD = 9;
    SPEC.forEach((c, ci) => {
      let d = Math.abs(p - c.center);
      if (d > 0.5) d = 1 - d;
      if (d < bestD) {
        bestD = d;
        best = ci;
      }
    });
    let signed = p - SPEC[best].center;
    if (signed > 0.5) signed -= 1;
    if (signed < -0.5) signed += 1;
    const u = signed / SPEC[best].half;

    const deficit = 1 - cornerScale[best];
    cap[i] = raw * (1 - deficit * phaseWeight(u, cornerPhase[best]));
  }

  const v = cap.slice();

  // Two passes around the closed loop in each direction: one lap is not enough
  // for a braking zone that starts before the start/finish line to propagate.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const a = wrap(i);
      const b = wrap(i + 1);
      const latUsed = (v[a] * v[a] * Math.abs(kappa[a])) / A_LAT_MAX;
      const aLon = accelCeiling(v[a]) * longitudinalAvailable(latUsed);
      v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * aLon * DS));
    }
    for (let i = N; i > 0; i--) {
      const a = wrap(i);
      const b = wrap(i - 1);
      const latUsed = (v[a] * v[a] * Math.abs(kappa[a])) / A_LAT_MAX;
      const aLon = A_BRAKE_MAX * longitudinalAvailable(latUsed);
      v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * aLon * DS));
    }
  }
  return v;
}

/** Elapsed time at each grid point, and the total. */
function integrateTime(v: number[]): { t: number[]; total: number } {
  const t = new Array<number>(N).fill(0);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    t[i] = acc;
    acc += DS / Math.max(v[i], 1);
  }
  return { t, total: acc };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sixteen laps
// ─────────────────────────────────────────────────────────────────────────────

interface LapPlan {
  n: number;
  scale: number[];
  phase: PhaseName[];
  out: boolean;
  valid: boolean;
  anomalous: boolean;
  incidents: number;
}

const REFERENCE_LAP = 9;

function planLaps(): LapPlan[] {
  const rnd = mulberry32(0x9184d9);
  const plans: LapPlan[] = [];
  for (let n = 1; n <= 16; n++) {
    const out = n === 1;
    const inLap = n === 16;
    const anomalous = n === 4;
    const invalid = n === 12;

    // A driver finds the limit over a run: the deficit shrinks toward the
    // reference lap and then drifts back out as the tires go off.
    /* The deficit is applied through a phase window whose mean weight is well
       under 1, so these coefficients are larger than the speed deficit they
       actually produce. Tuned to put the clean laps across ~2.5 s. */
    const arc = Math.abs(n - REFERENCE_LAP) / 8;
    let base = n === REFERENCE_LAP ? 0 : 0.028 + arc * 0.15;
    if (out) base += 0.42;
    if (inLap) base += 0.3;
    if (anomalous) base += 0.24;
    if (invalid) base += 0.08;

    /* The reference lap is the fastest LAP, not the fastest corner — nobody
       strings together their best fourteen corners in one go. So a slower lap
       is genuinely quicker somewhere, and roughly one corner in seven is given
       back to it here. A comparison that only ever shows losses is describing
       the arithmetic rather than the driving, and the "time taken back" stat on
       the analysis screen would read "none" forever. */
    const scale = SPEC.map(() => {
      if (rnd() < 0.14) return 1 + rnd() * 0.03;
      const jitter = (rnd() - 0.5) * 0.06;
      return 1 - Math.max(0, base + jitter);
    });
    // Which part of each corner the deficit sits in, varying by lap and corner.
    const phase: PhaseName[] = SPEC.map(() => {
      const r = rnd();
      return r < 0.34 ? "entry" : r < 0.67 ? "mid" : "exit";
    });

    if (n === REFERENCE_LAP) {
      scale.fill(1);
      phase.fill("mid");
    }

    plans.push({
      n,
      scale,
      phase,
      out: out || inLap,
      valid: !invalid,
      anomalous,
      incidents: anomalous ? 2 : invalid ? 1 : 0,
    });
  }
  return plans;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Channels
// ─────────────────────────────────────────────────────────────────────────────

function buildTrace(plan: LapPlan): { trace: Trace; time: number[] } {
  const { kappa } = CIRCUIT;
  const v = solveLap(plan.scale, plan.phase);
  const { t, total } = integrateTime(v);
  const rnd = mulberry32(1000 + plan.n);

  const speed: number[] = [];
  const throttle: number[] = [];
  const brake: number[] = [];
  const brakeRaw: number[] = [];
  const steer: number[] = [];
  const gear: number[] = [];
  const rpm: number[] = [];
  const latAccel: number[] = [];
  const longAccel: number[] = [];
  const absActive: number[] = [];
  const gridPct: number[] = [];

  for (let i = 0; i < N; i++) {
    const a = wrap(i);
    const b = wrap(i + 1);
    // dv/dt from the space-domain solution.
    const aLon = ((v[b] * v[b] - v[a] * v[a]) / (2 * DS)) * 1;
    const aLat = v[a] * v[a] * kappa[a];

    const accCeil = accelCeiling(v[a]);
    let thr = aLon > 0 ? Math.min(1, aLon / accCeil) : 0;
    let brk = aLon < 0 ? Math.min(1, -aLon / A_BRAKE_MAX) : 0;

    // Pedal noise: a real potentiometer never reads a clean zero.
    thr = Math.max(0, Math.min(1, thr + (rnd() - 0.5) * 0.006));
    brk = Math.max(0, Math.min(1, brk + (rnd() - 0.5) * 0.005));

    // brake_raw is line pressure before ABS modulation: same shape, but it
    // keeps the spikes ABS shaves off. The pair is what makes ABS visible.
    const abs = brk > 0.82 ? 1 : 0;
    const raw = abs ? Math.min(1, brk + 0.06 + rnd() * 0.05) : brk;

    const steerRad = Math.atan(WHEELBASE * kappa[a]) * STEER_RATIO;

    /* Gear and engine speed come from ONE table of shift points. Deriving the
       gear from one set of thresholds and the rev fraction from another lets
       them disagree, and the readout then shows a car sitting at idle at
       196 km/h. */
    const kmh = v[a] * 3.6;
    let g = 2;
    while (g < GEAR_TOP_KMH.length - 1 && kmh >= GEAR_TOP_KMH[g]) g++;
    const top = GEAR_TOP_KMH[g];
    const bot = GEAR_TOP_KMH[g - 1];
    const frac = Math.min(1, Math.max(0, (kmh - bot) / Math.max(1, top - bot)));

    gridPct.push(i / N);
    speed.push(v[a]);
    throttle.push(thr);
    brake.push(brk);
    brakeRaw.push(raw);
    steer.push(steerRad);
    gear.push(g);
    // A sequential race gearbox drops ~1,900 rpm on an upshift, not ~4,400 —
    // the band per gear is narrow, so the engine never sits near idle on track.
    rpm.push(Math.round(5700 + frac * 1900));
    latAccel.push(aLat);
    longAccel.push(aLon);
    absActive.push(abs);
  }

  return {
    trace: {
      lap_number: plan.n,
      lap_time_s: total,
      grid_pct: gridPct,
      speed,
      throttle,
      brake,
      brake_raw: brakeRaw,
      steer,
      gear,
      rpm,
      lat_accel: latAccel,
      long_accel: longAccel,
      lat_gps: CIRCUIT.y.map((m) => 42.3369 + m / 111320),
      lon_gps: CIRCUIT.x.map((m) => -76.9272 + m / 82000),
      abs_active: absActive,
    },
    time: t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Session-level derivations
// ─────────────────────────────────────────────────────────────────────────────

function buildTireBands(ref: Trace) {
  // Surface temperature as accumulated lateral work with exponential decay.
  // The three bands differ because static camber loads the inner edge, so a
  // right-hander heats the left tire's inner (right-hand) band hardest.
  const left: number[] = [];
  const mid: number[] = [];
  const right: number[] = [];
  let l = 74;
  let m = 76;
  let r = 78;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const lat = ref.lat_accel[i] / G;
      const work = Math.abs(lat) * 0.62 + ref.brake[i] * 0.22;
      const cool = 0.028;
      // camber bias: positive lat (right turn) loads the left-front's outer edge
      l += work * (1 + (lat > 0 ? -0.18 : 0.26)) - (l - 70) * cool;
      m += work * 1.05 - (m - 70) * cool;
      r += work * (1 + (lat > 0 ? 0.3 : -0.14)) - (r - 70) * cool;
      if (pass === 1) {
        left.push(l);
        mid.push(m);
        right.push(r);
      }
    }
  }
  return { left_c: left, middle_c: mid, right_c: right };
}

function buildTraction(traces: Trace[], cleanLaps: number[]) {
  const scatter: [number, number][] = [];
  const perLapMax: Record<number, number> = {};

  for (const tr of traces) {
    if (!cleanLaps.includes(tr.lap_number)) continue;
    let peak = 0;
    for (let i = 0; i < N; i += 2) {
      const lat = tr.lat_accel[i] / G;
      const lon = tr.long_accel[i] / G;
      scatter.push([lat, lon]);
      peak = Math.max(peak, Math.hypot(lat, lon));
    }
    perLapMax[tr.lap_number] = peak;
  }

  // Bin the outer edge at 10°.
  const BINS = 36;
  const binMax = new Array<number>(BINS).fill(0);
  for (const [lat, lon] of scatter) {
    const g = Math.hypot(lat, lon);
    let deg = (Math.atan2(lon, lat) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const b = Math.floor(deg / 10) % BINS;
    binMax[b] = Math.max(binMax[b], g);
  }
  // A single empty bin cuts a false notch in the polygon, which would read as
  // a real hole in the driver's envelope. A +/-10 degree rolling maximum closes
  // it — and the result is labelled a boundary ESTIMATE, not a boundary.
  const envelope = binMax.map((_, b) => ({
    angle_deg: b * 10 + 5,
    g: Math.max(binMax[(b + BINS - 1) % BINS], binMax[b], binMax[(b + 1) % BINS]),
  }));

  const sessionPeak = Math.max(...envelope.map((e) => e.g), 1e-6);
  const laps: Record<number, number> = {};
  for (const [n, peak] of Object.entries(perLapMax)) {
    laps[Number(n)] = (peak / sessionPeak) * 100;
  }
  return { scatter, envelope, laps };
}

/* Lockups and wheelspin are DISCRETE incidents, not a state the car is in for
   half of every braking zone. A threshold applied per sample fires on hundreds
   of consecutive points in one braking event and turns the map into a smear,
   which reads as "you lock up constantly" — a claim the data would not support.
   So: find candidate zones, take the single worst sample in each, and let a
   seeded draw decide which of them actually let go. */
function buildEvents(
  traces: Trace[],
  cleanLaps: number[],
  corners: Corner[],
): TrackEvent[] {
  const events: TrackEvent[] = [];
  const rnd = mulberry32(0xe0685e);

  for (const tr of traces) {
    if (!cleanLaps.includes(tr.lap_number)) continue;

    for (const corner of corners) {
      const from = wrap(Math.round(corner.start_pct * N) - 22);
      const to = wrap(Math.round(corner.apex_pct * N));

      // The heaviest braking sample in this corner's entry.
      let peakI = from;
      let peak = 0;
      for (let s = 0; s < 30; s++) {
        const k = wrap(from + s);
        if (k === to) break;
        if (tr.brake_raw[k] > peak) {
          peak = tr.brake_raw[k];
          peakI = k;
        }
      }
      // Only the genuinely heavy zones can lock, and only sometimes.
      if (peak > 0.9 && rnd() < 0.06) {
        events.push({ kind: "lockup", pct: peakI / N, lap_number: tr.lap_number });
      }

      // Wheelspin lives on corner exit: throttle picked up in a low gear while
      // the car is still carrying lateral load.
      let spinI = -1;
      let spinScore = 0;
      for (let s = 0; s < 34; s++) {
        const k = wrap(Math.round(corner.apex_pct * N) + s);
        const score =
          tr.throttle[k] * (Math.abs(tr.lat_accel[k]) / G) * (tr.gear[k] <= 3 ? 1 : 0.25);
        if (score > spinScore) {
          spinScore = score;
          spinI = k;
        }
      }
      if (spinI >= 0 && spinScore > 0.72 && rnd() < 0.1) {
        events.push({ kind: "wheelspin", pct: spinI / N, lap_number: tr.lap_number });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assemble
// ─────────────────────────────────────────────────────────────────────────────

let CACHE: SessionBundle | null = null;

export function generateSession(): SessionBundle {
  if (CACHE) return CACHE;

  const plans = planLaps();
  const traces: Record<number, Trace> = {};
  const times: Record<number, number[]> = {};
  const laps: Lap[] = [];

  for (const plan of plans) {
    const { trace, time } = buildTrace(plan);
    traces[plan.n] = trace;
    times[plan.n] = time;
    laps.push({
      lap_number: plan.n,
      lap_time_s: trace.lap_time_s,
      is_valid: plan.valid,
      is_out_lap: plan.out,
      incident_delta: plan.incidents,
      is_anomalous: plan.anomalous,
    });
  }

  const cleanLaps = laps
    .filter((l) => l.is_valid && !l.is_out_lap && !l.is_anomalous)
    .map((l) => l.lap_number);
  const bestLap = cleanLaps.reduce(
    (best, n) => (traces[n].lap_time_s < traces[best].lap_time_s ? n : best),
    cleanLaps[0],
  );

  const corners = buildCorners();
  const traction = buildTraction(Object.values(traces), cleanLaps);
  const tire = buildTireBands(traces[bestLap]);
  const events = buildEvents(Object.values(traces), cleanLaps, corners);

  CACHE = {
    session: {
      id: "fixture",
      track_name: "Watkins Glen — Boot",
      car_name: "Porsche 992 Cup",
      session_type: "Practice",
      session_num: 0,
      track_length_km: TRACK_M / 1000,
      wear_masked: true,
      recorded_at: "2026-07-29T19:14:00.000Z",
      filename: "porsche992cup_watkinsglen boot 2026-07-29 19-14-02.ibt",
      lap_count: laps.length,
      valid_laps: cleanLaps.length,
      best_lap_s: traces[bestLap].lap_time_s,
    },
    laps,
    traces,
    metrics: {},
    corners,
    traction,
    tire,
    events,
    gridSize: N,
    map: { x_m: CIRCUIT.x, y_m: CIRCUIT.y },
    absences: [
      {
        key: "brake_temp",
        title: "Brake temperature",
        reason:
          "The .ibt carries no brake-temperature channel — only line pressure. Nothing is estimated in its place.",
        permanent: true,
      },
      {
        key: "tire_other_corners",
        title: "Tire temperature, other three corners",
        reason:
          "Left-front is the only tire-temperature channel in the file. The other three corners are absent, not zero.",
        permanent: true,
      },
      {
        key: "racecraft",
        title: "Racecraft and positioning",
        reason:
          "Other-car channels (CarIdx) are not written to disk .ibt files, so nothing can be said about traffic, position or intent.",
        permanent: true,
      },
      {
        key: "tire_wear",
        title: "Tire wear over the session",
        reason:
          "This session reports wear_masked — iRacing froze wear, so no wear trend is claimed from it.",
        permanent: false,
      },
    ],
  };

  // Elapsed-time curves are what the delta between any two laps is built from.
  TIME_CURVES = times;
  return CACHE;
}

/** Per-lap elapsed time at each grid point. The delta trace between any two
 *  laps is the difference of these, which is why a delta can be computed for
 *  ANY lap pair rather than only against the stored reference. */
export let TIME_CURVES: Record<number, number[]> = {};

export const FIXTURE_GRID = N;
export const FIXTURE_REFERENCE_LAP = REFERENCE_LAP;
