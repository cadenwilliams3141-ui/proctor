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
  /** Fitted server-side to the reference lap's recorded GPS path, or taken
   *  from the parser once it emits them.
   *
   *  NULL when the fit did not land on a corner-shaped answer — an apex sitting
   *  on a near-straight section returns a radius in the tens of thousands of
   *  metres, which is not a corner radius and must not be printed as one. There
   *  is no sentinel for it: a radius of 0 would read as a measurement. */
  radius_m: number | null;
  dir: "left" | "right" | null;
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

/** Every input the file carried at the moment a wheel let go.
 *
 *  This is the "what was I doing" block, and it is readings only. Nothing here
 *  says what caused the slip or what to do instead — neither is a channel. */
export interface EventInputs {
  speed_kmh: number | null;
  gear: number | null;
  throttle_pct: number | null;
  brake_pedal_pct: number | null;
  brake_applied_pct: number | null;
  steer_deg: number | null;
  lateral_g: number | null;
  longitudinal_g: number | null;
  combined_g?: number;
  turning?: boolean;
  turn_direction?: "left" | "right";
  abs_active?: boolean;
  brake_bias_pct_front?: number;
  /** Which pedal the rate below describes. */
  pedal?: string;
  pedal_change_pct_per_100ms?: number;
  /** Present INSTEAD of the rate when the run-up fell outside the lap. */
  pedal_change_unavailable?: string;
}

export interface TrackEvent {
  kind: "lockup" | "wheelspin";
  pct: number;
  lap_number: number;
  /** Which corners of the car let go. */
  wheels?: string[];
  duration_ms?: number;
  peak_slip_ratio?: number;
  inputs?: EventInputs;
}

/** What a session's slip events had in common. A single lockup is an incident;
 *  twenty at the same speed in the same gear is a pattern worth naming. */
export interface EventPattern {
  measured: boolean;
  reason?: string;
  events?: number;
  median_speed_kmh?: number;
  most_common_gear?: number;
  most_common_gear_share_pct?: number;
  median_pedal_change_pct_per_100ms?: number;
  while_turning_pct?: number;
  median_combined_g?: number;
  with_abs_active_pct?: number;
  most_affected_wheel?: string;
  most_affected_wheel_events?: number;
  wheel_counts?: Record<string, number>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Grip, response, stint and track width — the insight modules
// ─────────────────────────────────────────────────────────────────────────────

/** A block that a module could not fill. Present on every optional shape here,
 *  so a panel always has a sentence to print instead of an empty space. */
export interface Unmeasured {
  measured: false;
  reason: string;
}

export type Measured<T> = ({ measured: true } & T) | Unmeasured;

export interface GripBand {
  band: string;
  ticks: number;
  measured: boolean;
  reason?: string;
  peak_mu?: number;
  peak_combined_g?: number;
  median_vertical_load_g?: number;
}

export interface GripState {
  state: string;
  ticks: number;
  measured: boolean;
  reason?: string;
  peak_mu?: number;
  median_mu?: number;
}

export interface GripLap {
  lap: number;
  clean: boolean;
  lap_time_s: number | null;
  peak_mu: number;
  median_mu: number;
  peak_combined_g: number;
  peak_lateral_g: number;
  peak_braking_g: number;
}

export interface GripCorner {
  id: number;
  measured: boolean;
  reason?: string;
  start_pct?: number;
  apex_pct?: number;
  end_pct?: number;
  peak_mu?: number;
  peak_lateral_g?: number;
  radius_m?: number;
  dir?: "left" | "right";
}

/** Demonstrated grip: horizontal force over vertical load, both measured.
 *  It is the grip that was USED, never the grip the tires had. */
export interface GripData {
  session: {
    peak_mu: number;
    median_mu: number;
    peak_combined_g: number;
    peak_lateral_g: number;
    peak_braking_g: number;
    peak_traction_g: number;
    median_vertical_load_g: number;
    peak_vertical_load_g: number;
    ticks: number;
    note: string;
  };
  bands: GripBand[];
  /** Grip rising with speed is what downforce looks like in these channels. */
  downforce: {
    slowest_band: string;
    fastest_band: string;
    peak_mu_change: number;
    note: string;
  } | null;
  states: GripState[];
  laps: GripLap[];
  corners: GripCorner[];
  stint: {
    measured: boolean;
    reason?: string;
    clean_laps?: number;
    first_third_peak_mu?: number;
    last_third_peak_mu?: number;
    change?: number;
    caveat?: string;
    wear_masked?: boolean;
    wear_note?: string;
  };
  finding: string;
  method: string;
  caveat: string;
}

export interface AbsBlock {
  engaged_pct_of_braking: number;
  activation_events: number;
  mean_pressure_cut_pct?: number;
  max_pressure_cut_pct?: number;
  mean_cut_while_engaged_pct?: number;
  cut_note?: string;
  finding?: string;
}

export interface SteerBand {
  band: string;
  ticks: number;
  measured: boolean;
  reason?: string;
  median_lateral_g?: number;
  peak_lateral_g?: number;
}

/** What you asked the car for against what it did. */
export interface InputResponseData {
  brake: Measured<{
    braking_ticks: number;
    pedal_ceiling_pct: number;
    applied_ceiling_pct: number;
    mean_held_back_pct: number;
    max_held_back_pct: number;
    peak_deceleration_g?: number;
    decel_per_pedal_g?: number;
    abs?: AbsBlock;
    ceiling_note: string;
  }>;
  throttle: Measured<{
    on_power_ticks: number;
    mean_throttle_pct: number;
    peak_traction_g?: number;
    slip?: {
      share_of_on_power_pct: number;
      mean_excess_pct_while_slipping: number;
      peak_excess_pct: number;
      threshold_note: string;
      finding?: string;
    };
  }>;
  steering: Measured<{
    bands: SteerBand[];
    peak_steer_deg: number;
    most_lateral_g_band?: string;
    falloff_past_peak_g?: number;
    falloff_note?: string;
    note: string;
  }>;
  wheel: Measured<{
    clipping_pct_of_moving: number;
    median_torque_pct?: number;
    note: string;
    finding?: string;
  }>;
  findings: string[];
  caveat: string;
}

export interface StintLap {
  lap: number;
  clean: boolean;
  out_lap: boolean;
  anomalous: boolean;
  lap_time_s: number | null;
  peak_lateral_g?: number;
  peak_braking_g?: number;
  peak_traction_g?: number;
  decel_per_pedal_g?: number;
  peak_pedal_pct?: number;
  abs_engaged_pct?: number;
  lf_temp_left_c?: number;
  lf_temp_middle_c?: number;
  lf_temp_right_c?: number;
  lf_temp_spread_c?: number;
  fuel_used_l?: number;
  fuel_start_l?: number;
  fuel_end_l?: number;
}

export interface StintSeries {
  measured: boolean;
  label: string;
  reason?: string;
  unit?: string;
  per_lap?: number;
  first_third?: number;
  last_third?: number;
  change?: number;
  laps_used?: number;
}

/** How the run changed from the first lap to the last. Drift only — the module
 *  deliberately names no cause, and neither may the screen. */
export interface StintData {
  laps: StintLap[];
  clean_lap_count: number;
  trends: {
    measured: boolean;
    reason?: string;
    clean_laps?: number;
    series?: Record<string, StintSeries>;
  };
  fuel: {
    measured: boolean;
    reason?: string;
    total_used_l?: number | null;
    mean_per_lap_l?: number;
    max_per_lap_l?: number;
    laps_counted?: number;
    refuelled?: boolean;
    refuel_note?: string;
    note?: string;
  };
  wear?: { measured: false; reason: string; note: string };
  findings: string[];
  caveat: string;
}

/** The band of road the driver actually used, lap over lap. NOT the track's
 *  width — the .ibt carries no kerbs, white lines or surveyed edges. */
export interface TrackWidthData {
  source_lap: number;
  laps_used: number[];
  /** Local metres frame, shared with `map`. */
  origin: { lat: number; lon: number };
  centre_x_m: number[];
  centre_y_m: number[];
  /** Unit normal to the reference line, pointing left of travel. */
  normal_x: number[];
  normal_y: number[];
  /** Signed lateral offsets in metres. Positive is left of travel. */
  left_m: number[];
  right_m: number[];
  median_m: number[];
  p90_m: number[];
  p10_m: number[];
  used_width_m: number[];
  summary: {
    measured: boolean;
    reason?: string;
    median_used_width_m?: number;
    widest_m?: number;
    narrowest_m?: number;
    median_typical_spread_m?: number;
    spread_note?: string;
  };
  caveat: string;
}

/** The racing surface, accumulated across every session ever driven here.
 *
 *  Unlike everything else in the bundle this is a fact about the TRACK, not
 *  about the session — it is read from `track_boundaries`, widened by each
 *  ingest, and shared by every session at the same circuit.
 *
 *  It is a LOWER BOUND on the road, not its edge: `PlayerTrackSurface` follows
 *  the car's reference point, so the asphalt reaches further than the outermost
 *  sample, and road nobody has driven on is not in here at all. */
export interface TrackBoundary {
  track_name: string;
  origin: { lat: number; lon: number };
  centre_x_m: number[];
  centre_y_m: number[];
  normal_x: number[];
  normal_y: number[];
  /** null where no on-track sample has ever landed. NEVER zero — a zero here
   *  would draw as a track that pinches shut on the centreline. */
  left_m: (number | null)[];
  right_m: (number | null)[];
  sessions_contributed: number;
  laps_contributed: number;
  updated_at: string | null;
}

/** What THIS session saw of the surface: where it left it, and what it rode. */
export interface TrackEdges {
  measured: boolean;
  reason?: string;
  coverage_pct?: number;
  surface?: {
    measured: boolean;
    reason?: string;
    on_track_pct?: number;
    off_track_pct?: number;
    kerb_pct?: number;
    kerb_note?: string;
    materials_pct?: Record<string, number>;
    excursion_count?: number;
    finding?: string;
    excursions?: { lap: number; start_pct: number; duration_ms: number; surface?: string }[];
  };
  caveat?: string;
}

/** Rig-level readings. Every number here is a measurement, never a target. */
export interface HardwareData {
  brake_ceiling_pct: number | null;
  max_abs_diff: number | null;
  stationary_ticks_excluded: number | null;
  abs: {
    engaged_pct_of_braking: number | null;
    activation_events: number | null;
    braking_ticks: number | null;
    finding?: string;
    reason?: string;
  };
  pedal_noise: {
    spike_ticks: number | null;
    max_spike: number | null;
    qualifying_ticks: number | null;
    reason?: string;
  };
  ffb: { clipping_pct: number | null; finding?: string; reason?: string };
  brake_bias: { available: boolean; values?: number[]; changed?: boolean; reason?: string };
  concerns: { area: string; observation: string; watch: string }[];
  concerns_finding: string | null;
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
  /** What the slip events had in common, by kind. */
  eventPatterns: { lockup: EventPattern; wheelspin: EventPattern };
  /** null when the module did not run — the panel prints its absence instead. */
  grip: GripData | null;
  inputResponse: InputResponseData | null;
  stint: StintData | null;
  trackWidth: TrackWidthData | null;
  /** The accumulated racing surface for this circuit. Null until a session
   *  whose .ibt carries PlayerTrackSurface has been ingested here. */
  trackBoundary: TrackBoundary | null;
  /** What this session alone saw of the surface. */
  trackEdges: TrackEdges | null;
  hardware: HardwareData | null;
  /** Sample count on the shared distance grid. */
  gridSize: number;
  /** Circuit centreline in metres, gridSize long. */
  map: { x_m: number[]; y_m: number[] };
  absences: ModuleAbsence[];
}
