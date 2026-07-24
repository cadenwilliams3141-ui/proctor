"""Delta-time vs the reference lap (the core loop).

Observes, for every lap, how much time it has gained or lost against this
session's reference lap at each point around the track. The curve is the
running integral of the inverse-speed difference over distance; the final value
is the lap's net time delta. Self-comparison only — the reference is the
driver's own fastest clean lap this session, never an external benchmark.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "delta_time"

BASIS = "self-comparison within this session"
DEFAULT_TRACK_LENGTH_KM = 4.0
MIN_SPEED_MS = 1.0  # clip before inverting; speeds can legitimately reach 0


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap; fall back to fastest valid; else None."""
    valid = [lap for lap in session.laps if lap.is_valid and lap.lap_time_s is not None]
    if not valid:
        return None
    clean = [lap for lap in valid if not lap.is_anomalous]
    pool = clean or valid
    return min(pool, key=lambda lap: lap.lap_time_s)


def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return {
            "basis": BASIS,
            "insufficient_data": True,
            "reason": "no valid laps in this session to serve as a reference",
        }

    track_km = session.meta.track_length_km
    assumed = track_km is None
    if assumed:
        track_km = DEFAULT_TRACK_LENGTH_KM
    ds = (track_km * 1000.0) / 1000.0  # metres per grid bin (track / 1000 bins)

    inv_ref = 1.0 / np.clip(ref.grid["speed"].astype(np.float64), MIN_SPEED_MS, None)

    laps: dict[str, dict] = {}
    for lap in session.laps:
        if lap.lap_number == ref.lap_number:
            continue  # a lap's delta against itself is trivially zero
        if "speed" not in lap.grid:
            continue
        inv_lap = 1.0 / np.clip(lap.grid["speed"].astype(np.float64), MIN_SPEED_MS, None)
        delta_curve = np.cumsum(ds * (inv_lap - inv_ref))
        laps[str(lap.lap_number)] = {
            "is_valid": bool(lap.is_valid),
            "delta_curve_s": [round(float(v), 4) for v in delta_curve],
            "final_delta_s": round(float(delta_curve[-1]), 4),
        }

    caveat = (
        "Delta-time integrates 1/speed over a fixed 1000-point distance grid; "
        "distances and the reference come from this session alone."
    )
    payload = {
        "basis": BASIS,
        "reference_lap": int(ref.lap_number),
        "reference_lap_time_s": round(float(ref.lap_time_s), 3),
        "laps": laps,
        "caveat": caveat,
    }
    if assumed:
        payload["track_length_assumed"] = True
        payload["caveat"] = (
            f"Track length unknown; assumed {DEFAULT_TRACK_LENGTH_KM:.1f} km, so "
            f"absolute delta magnitudes scale with that assumption. " + caveat
        )
    return payload
