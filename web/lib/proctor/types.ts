/* The shapes the analysis surface reads.
 *
 * Everything above the line mirrors what Neon already returns today (see
 * lib/types.ts and app/api/session/[id]/*). Everything below the line is
 * derived by the UI from those, or is a field the parser does not emit yet.
 * FIELD_PROVENANCE in ./provenance.ts records which is which, and the screens
 * render that record rather than asserting a number is measured when it is
 * not. */

// ─────────────────────────────────────────────────────────────────────────────
// Read from the database as-is
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: number | string;
  track_name: string | null;
  car_name: string | null;
  session_type: string | null;
  session_num: number;
  track_length_km: number | null;
  /** iRacing freezes tire wear in official sessions. Travels onto every view. */
  wear_masked: boolean;
  recorded_at: string | null;
  filename: string | null;
  lap_count: number;
  valid_laps: number;
  best_lap_s: number | null;
}

export interface Lap {
  lap_number: number;
  lap_time_s: number | null;
  is_valid: boolean;
  is_out_lap: boolean;
  incident_delta: number;
  is_anomalous: boolean;
}

/** A lap is usable for comparison only if it is a complete, clean, timed lap.
 *  Unusable laps stay VISIBLE and stay excluded — dimmed, never dropped. */
export function isUsable(l: Lap): boolean {
  return l.is_valid && !l.is_out_lap && !l.is_anomalous && l.lap_time_s != null;
}

/** Distance-resampled channels. Every array is grid_pct.length long. */
export interface Trace {
  lap_number: number;
  lap_time_s: number;
  /** 0..1 along the lap. The grid is distance, not time. */
  grid_pct: number[];
  speed: number[]; // m/s
  throttle: number[]; // 0..1
  brake: number[]; // 0..1
  brake_raw: number[]; // 0..1, pre-ABS line pressure
  steer: number[]; // radians
  gear: number[];
  rpm: number[];
  lat_accel: number[]; // m/s^2
  long_accel: number[]; // m/s^2
  lat_gps: number[];
  lon_gps: number[];
  /** null when the car does not expose the channel. null !== all-zero. */
  abs_active: number[] | null;
}

export type MetricPayloads = Record<string, Record<string, unknown>>;

// ─────────────────────────────────────────────────────────────────────────────
// Derived by the UI, or awaited from the parser
// ─────────────────────────────────────────────────────────────────────────────

export interface Corner {
  id: number;
  start_pct: number;
  apex_pct: number;
  end_pct: number;
  /** Parser has curvature and should emit these; today the UI infers them. */
  radius_m: number;
  dir: "left" | "right";
}

/** The four sub-sections a corner's delta is split across, in order. */
export const SECTION_LABEL = [
  "on entry",
  "in the run to the apex",
  "from the apex out",
  "on the exit",
] as const;

export interface CornerDelta {
  corner: Corner;
  /** Seconds gained (negative) or lost (positive) in each sub-section. */
  sections: [number, number, number, number];
  /** Sum of `sections`. */
  delta: number;
  /** Index into SECTION_LABEL of the sub-section carrying most of the delta. */
  dominant: number;
  /** Slowest point in this corner on each lap, m/s. */
  minSpeedA: number;
  minSpeedB: number;
  /** Sample-index window on the shared grid, for sparklines and traces. */
  from: number;
  to: number;
}

/** The whole comparison of one lap against the reference. */
export interface CornerLedger {
  lapA: number;
  lapB: number;
  corners: CornerDelta[];
  /** Total lap gap, from the delta trace's final value. */
  lapDelta: number;
  /**
   * lapDelta - Σ corner deltas. The corners genuinely do not sum to the lap;
   * this is what went to the parts that are not corners. It keeps its own
   * block rather than being folded into the corners, because distributing it
   * silently would be fabrication.
   */
  remainder: number;
  /** Largest |delta| across corners, for bar scaling. */
  maxAbs: number;
}

export interface TrackEvent {
  kind: "lockup" | "wheelspin";
  pct: number;
  lap_number: number;
}

/** One bin of the g-g boundary. See provenance — this is an ESTIMATE. */
export interface EnvelopePoint {
  angle_deg: number;
  g: number;
}

export interface TractionData {
  /** Every sampled (lateral g, longitudinal g) pair this session. */
  scatter: [number, number][];
  /** Binned outer edge of the above. Not a physics limit. */
  envelope: EnvelopePoint[];
  /** Percentage of the session envelope each clean lap reached. */
  laps: Record<number, number>;
}

export interface TireBands {
  /** Left-front only — the sole tire-temp channel the .ibt carries. */
  left_c: number[];
  middle_c: number[];
  right_c: number[];
}

/** A module that could not run says why. An empty panel must never be able to
 *  mean "no data" — that is the confusion the honesty rules exist to prevent. */
export interface ModuleAbsence {
  key: string;
  title: string;
  reason: string;
  /** true when the channel does not exist at all, vs. merely not computed. */
  permanent: boolean;
}

/** A row on the Sessions list: the session plus its clean-lap times, which
 *  drive the pace sparkline. Each sparkline is on ITS OWN scale — sessions at
 *  different tracks are not comparable and must not be drawn as if they were. */
export interface SessionRow extends SessionMeta {
  pace: number[];
}

export interface IngestRow {
  id: number;
  filename: string;
  status: "queued" | "parsing" | "done" | "failed";
  /** A failure ALWAYS shows this. A failed file with no reason is worse than
   *  no file at all — the user cannot tell whether to retry or to give up. */
  error_detail: string | null;
  uploaded_at: string;
}

export interface SessionBundle {
  session: SessionMeta;
  laps: Lap[];
  traces: Record<number, Trace>;
  metrics: MetricPayloads;
  corners: Corner[];
  traction: TractionData;
  tire: TireBands;
  events: TrackEvent[];
  /** Sample count on the shared distance grid. */
  gridSize: number;
  /** Circuit centreline in metres, gridSize long. */
  map: { x_m: number[]; y_m: number[] };
  absences: ModuleAbsence[];
}
