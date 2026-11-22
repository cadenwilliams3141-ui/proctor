-- Full-rate lap storage (2026-11-22). Every tick of every lap, every channel
-- the analysis reads, as written by proctor_parser.samples.encode_lap:
-- quantised, delta-coded, byte-planed, zlib-compressed. `header` carries the
-- channel list and scales, so a reader needs nothing else to decode `data`.
--
-- One row per lap; deleted with its lap (re-ingest rewrites the session).
-- `data` is already compressed, so TOAST is told not to try again.
CREATE TABLE IF NOT EXISTS lap_samples (
    lap_id      BIGINT PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
    codec       SMALLINT NOT NULL,
    tick_rate   SMALLINT NOT NULL,
    n           INT NOT NULL,
    header      JSONB NOT NULL,
    data        BYTEA NOT NULL
);
ALTER TABLE lap_samples ALTER COLUMN data SET STORAGE EXTERNAL;
