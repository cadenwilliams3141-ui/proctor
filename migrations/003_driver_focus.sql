-- Proctor schema v3: the one thing the driver chose to work on.
--
-- Every other table holds telemetry or something measured from it. This one
-- holds a CHOICE: the suggestion the driver pinned as their focus, and what
-- their driving looked like when they pinned it, so the next session at the
-- same car and track can say whether it moved.
--
-- It is the first table the web app writes to (app/api/focus). The rule that
-- comes with that: the web may write user state here, never telemetry. The
-- site has no login, so anyone with its address could change the pinned focus;
-- that was accepted on 2026-11-25 for a low-stakes row (Decisions log).
--
-- One active focus per driver, car and track: pinning a new one clears the old
-- (cleared_at), so the history stays and the partial index enforces the rule.
-- The baseline is JSON because its shape follows the suggestion rules in
-- web/lib/proctor/focus.ts, which change with a deploy rather than a migration.
CREATE TABLE IF NOT EXISTS driver_focus (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             TEXT NOT NULL DEFAULT 'caden',
    car_name            TEXT NOT NULL,
    track_name          TEXT NOT NULL,
    aspect              TEXT NOT NULL,             -- braking | turn_in | throttle | line | grip
    rule_key            TEXT NOT NULL,             -- web/lib/proctor/gearCheck.ts RuleKey
    title               TEXT NOT NULL,             -- the suggestion as the driver read it
    baseline_session_id BIGINT REFERENCES sessions(id) ON DELETE SET NULL,
    baseline            JSONB NOT NULL,            -- per corner: apex %, zone time, the habit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    cleared_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_focus_one_active
    ON driver_focus (user_id, car_name, track_name)
    WHERE cleared_at IS NULL;
