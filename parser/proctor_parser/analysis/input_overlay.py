"""Input-overlay compare summary vs the reference lap.

The full throttle/brake/steer traces already live in `lap_traces` (keyed by
grid_pct); this metric is the compact comparison layer on top. Per lap it
observes the mean absolute difference of each input against the reference lap,
plus how far each corner's brake onset moved relative to the reference. Onsets
that never appear are reported as null — missing is not zero.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "input_overlay"

BASIS = "self-comparison within this session"
BRAKE_ON_THRESHOLD = 0.1   # brake fraction that counts as "on the brakes"
ONSET_LOOKBACK_PCT = 0.15  # search this far in track-% before a corner's start


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    valid = [lap for lap in session.laps if lap.is_valid and lap.lap_time_s is not None]
    if not valid:
        return None
    clean = [lap for lap in valid if not lap.is_anomalous]
    pool = clean or valid
    return min(pool, key=lambda lap: lap.lap_time_s)


def _brake_onset(brake: np.ndarray, pct: np.ndarray, corner: dict) -> float | None:
    """Track-% where braking for this corner begins, or None if it never does.

    Search window: from ONSET_LOOKBACK_PCT before the corner start up to the
    apex. Walking back from the apex, take the last contiguous run of ticks with
    brake above threshold and report where that run began.
    """
    lower = corner["start_pct"] - ONSET_LOOKBACK_PCT
    window = np.flatnonzero((pct >= lower) & (pct <= corner["apex_pct"]))
    if window.size == 0:
        return None
    on = brake[window] > BRAKE_ON_THRESHOLD
    if not on.any():
        return None
    end_pos = int(np.flatnonzero(on)[-1])           # last braking tick before apex
    gap_before = np.flatnonzero(~on[:end_pos + 1])   # break in braking before it
    onset_pos = int(gap_before[-1] + 1) if gap_before.size else 0
    return float(pct[window[onset_pos]])


def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return {
            "basis": BASIS,
            "insufficient_data": True,
            "reason": "no valid laps in this session to serve as a reference",
        }

    corners = detect_corners(ref.grid["speed"], ref.grid["grid_pct"])
    ref_pct = ref.grid["grid_pct"].astype(np.float64)
    ref_throttle = ref.grid["throttle"].astype(np.float64)
    ref_brake = ref.grid["brake"].astype(np.float64)
    ref_steer = ref.grid["steer"].astype(np.float64)
    ref_onsets = {c["id"]: _brake_onset(ref_brake, ref_pct, c) for c in corners}

    laps: dict[str, dict] = {}
    for lap in session.laps:
        if lap.lap_number == ref.lap_number:
            continue
        throttle = lap.grid["throttle"].astype(np.float64)
        brake = lap.grid["brake"].astype(np.float64)
        steer = lap.grid["steer"].astype(np.float64)

        shifts: dict[str, float | None] = {}
        for c in corners:
            lap_onset = _brake_onset(brake, ref_pct, c)
            ref_onset = ref_onsets[c["id"]]
            if lap_onset is None or ref_onset is None:
                shifts[str(c["id"])] = None
            else:
                shifts[str(c["id"])] = round(lap_onset - ref_onset, 4)

        laps[str(lap.lap_number)] = {
            "mean_abs_throttle_diff": round(float(np.mean(np.abs(throttle - ref_throttle))), 4),
            "mean_abs_brake_diff": round(float(np.mean(np.abs(brake - ref_brake))), 4),
            "mean_abs_steer_diff_rad": round(float(np.mean(np.abs(steer - ref_steer))), 4),
            "brake_onset_shifts": shifts,
        }

    return {
        "basis": BASIS,
        "reference_lap": int(ref.lap_number),
        "corners_used": corners,
        "laps": laps,
        "note": "full traces in lap_traces, index-aligned by grid_pct",
    }
