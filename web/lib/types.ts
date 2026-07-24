export interface SessionSummary {
  id: number;
  track_name: string | null;
  car_name: string | null;
  session_type: string | null;
  session_num: number;
  track_length_km: number | null;
  wear_masked: boolean;
  recorded_at: string | null;
  filename: string | null;
  lap_count: number;
  valid_laps: number;
  best_lap_s: number | null;
}

export interface LapRow {
  lap_number: number;
  lap_time_s: number | null;
  is_valid: boolean;
  is_out_lap: boolean;
  incident_delta: number;
  is_anomalous: boolean;
}

export interface IngestRow {
  id: number;
  filename: string;
  status: string;
  error_detail: string | null;
  uploaded_at: string;
}

export interface TraceRow {
  lap_number: number;
  grid_pct: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  brake_raw: number[];
  steer: number[];
  gear: number[];
  rpm: number[];
  lat_accel: number[];
  long_accel: number[];
  lat_gps: number[];
  lon_gps: number[];
  abs_active: number[] | null;
}

// Metric payloads are JSONB blocks written by the Python analysis modules;
// the UI treats them as loosely-typed data and renders what is present.
export type MetricPayloads = Record<string, Record<string, unknown>>;
