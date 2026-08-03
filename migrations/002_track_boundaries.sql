-- Proctor schema v2: the racing surface, accumulated per TRACK.
--
-- Every other table in this schema hangs off a session, because everything else
-- Proctor knows is a fact about one outing. A track boundary is not: the road
-- at Road Atlanta is the same road next week, so what one session learns about
-- it should still be there for the next.
--
-- That makes this the first per-track asset in the product, and the reason it
-- needs its own table rather than another session_metrics row. It is written by
-- MERGE, not by insert: each ingest widens the stored edges wherever that
-- session found on-track ground further out than anything seen before, and
-- leaves them alone everywhere else.
--
-- The arrays are index-aligned to the same 1000-point distance grid as
-- lap_traces, so a bin means the same piece of tarmac here as it does there.
-- Elements are NULLABLE on purpose: a bin nothing has ever driven through has
-- no measured edge, and the UI draws that as a gap. A zero would draw as a
-- track that pinches to nothing.
CREATE TABLE IF NOT EXISTS track_boundaries (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT 'caden',
    track_name      TEXT NOT NULL,
    -- Frame of the FIRST session to reach this track. Every later session is
    -- re-projected into it before merging, so the arrays below stay comparable.
    origin_lat      DOUBLE PRECISION NOT NULL,
    origin_lon      DOUBLE PRECISION NOT NULL,
    track_length_km REAL,
    grid_pct        REAL[] NOT NULL,
    centre_x_m      REAL[] NOT NULL,   -- the canonical centreline, in metres
    centre_y_m      REAL[] NOT NULL,
    normal_x        REAL[] NOT NULL,   -- unit normal, pointing left of travel
    normal_y        REAL[] NOT NULL,
    left_m          REAL[] NOT NULL,   -- outermost on-track offset seen, left
    right_m         REAL[] NOT NULL,   -- ...and right. Elements may be NULL.
    sessions_contributed INT NOT NULL DEFAULT 0,
    laps_contributed     INT NOT NULL DEFAULT 0,
    -- Which ingest_files have already been folded in. Re-ingesting a file is a
    -- normal thing to do (new analysis modules land and every session gets
    -- replayed), and the edges are idempotent under it — max/min of the same
    -- data does not move. The COUNTS are not: without this the same laps get
    -- added again on every replay and the panel claims a boundary is built
    -- from more driving than it is. Keyed on ingest_file_id because that
    -- survives a re-ingest; session ids do not, they are deleted and reissued.
    contributing_files   BIGINT[] NOT NULL DEFAULT '{}',
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, track_name)
);
CREATE INDEX IF NOT EXISTS idx_track_boundaries_track
    ON track_boundaries(user_id, track_name);

-- Idempotent for a database created before the column existed.
ALTER TABLE track_boundaries
    ADD COLUMN IF NOT EXISTS contributing_files BIGINT[] NOT NULL DEFAULT '{}';
