-- Proctor schema v1. Single user; user_id defaulted for later multi-user migration.
CREATE TABLE IF NOT EXISTS ingest_files (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'caden',
    filename        TEXT NOT NULL,
    sha256          TEXT NOT NULL UNIQUE,          -- dedupe key
    status          TEXT NOT NULL DEFAULT 'pending', -- pending|parsing|done|failed
    error_detail    TEXT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    parsed_at       TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'caden',
    ingest_file_id  BIGINT REFERENCES ingest_files(id) ON DELETE CASCADE,
    track_name      TEXT,
    car_name        TEXT,
    session_type    TEXT,                          -- Race/Practice/Qualify from YAML
    session_num     INT,                           -- SessionNum discriminator (files hold multiple)
    track_length_km REAL,
    car_redline_rpm REAL,
    wear_masked     BOOLEAN NOT NULL DEFAULT false, -- true if tire wear frozen (official races)
    tick_rate       INT,
    recorded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS laps (
    id              BIGSERIAL PRIMARY KEY,
    session_id      BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
    lap_number      INT NOT NULL,
    lap_time_s      REAL,
    is_valid        BOOLEAN NOT NULL DEFAULT true,  -- false for out/in/partial laps
    is_out_lap      BOOLEAN NOT NULL DEFAULT false,
    incident_delta  INT NOT NULL DEFAULT 0,         -- incident count gained during lap
    is_anomalous    BOOLEAN NOT NULL DEFAULT false, -- flagged by incident or speed-profile outlier
    traffic_flag    BOOLEAN NOT NULL DEFAULT false, -- reserved: set when live gap data exists (future)
    UNIQUE(session_id, lap_number)
);
-- Per-lap resampled telemetry on a common distance grid (for fast overlay/compare).
-- Store as arrays keyed by lap; grid is fixed length (e.g. 1000 points) for O(1) alignment.
CREATE TABLE IF NOT EXISTS lap_traces (
    id              BIGSERIAL PRIMARY KEY,
    lap_id          BIGINT REFERENCES laps(id) ON DELETE CASCADE UNIQUE,
    grid_pct        REAL[] NOT NULL,   -- distance % grid, fixed length
    speed           REAL[] NOT NULL,
    throttle        REAL[] NOT NULL,
    brake           REAL[] NOT NULL,
    brake_raw       REAL[] NOT NULL,
    steer           REAL[] NOT NULL,
    gear            REAL[] NOT NULL,
    rpm             REAL[] NOT NULL,
    lat_accel       REAL[] NOT NULL,
    long_accel      REAL[] NOT NULL,
    lat_gps         REAL[] NOT NULL,   -- for track map
    lon_gps         REAL[] NOT NULL,
    abs_active      REAL[]             -- ABS intervention trace
);
-- Computed metric blocks per session (the "session report"). JSONB for flexibility.
CREATE TABLE IF NOT EXISTS session_metrics (
    id              BIGSERIAL PRIMARY KEY,
    session_id      BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
    metric_key      TEXT NOT NULL,     -- 'brake_signature','ffb_saturation','fade', etc.
    payload         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(session_id, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_session ON session_metrics(session_id);
