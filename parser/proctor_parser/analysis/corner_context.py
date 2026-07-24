"""Per-corner context: what the car was doing through each corner (module 12).

For every corner the reference lap carved, this observes the reference lap's own
channels across that corner's distance window — minimum speed, entry/exit speed,
peak steering, and peak lateral / braking / power g — plus the left-front tire
surface temperature there. Purely descriptive self-comparison: the corners come
from this driver's reference line (via detect_corners), and every number is read
straight from that lap's recorded channels, never a physics or track model.

Only the left-front tire carries surface temps in the v1 contract (LFtempL/M/R);
the other three corners are absent, not zero. Brake temperature has no channel at
all, so it is simply not reported here rather than fabricated.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "corner_context"

_BASIS = "reference lap's own channels, self-comparison within this session"
_G = 9.81  # m/s² per g
_CAVEAT = (
    "tire temp is left-front only (the sole tire-temp channel carried); brake "
    "temperature has no channel and is not reported"
)


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, falling back to fastest valid (rule 4)."""
    valid = [l for l in session.laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def _has_lf_temp(lap: ParsedLap) -> bool:
    return all(f"lf_temp_{e}" in lap.raw for e in ("l", "m", "r"))


def _window_mask(dist: np.ndarray, start_pct: float, end_pct: float) -> np.ndarray:
    """Ticks whose distance falls inside the corner's [start, end] span."""
    return (dist >= start_pct) & (dist <= end_pct)


def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no valid laps in this session to serve as a reference",
            "caveat": _CAVEAT,
        }

    corners = detect_corners(ref.grid["speed"], ref.grid["grid_pct"])
    dist = ref.raw["dist"].astype(np.float64)
    speed = ref.raw["speed"].astype(np.float64)
    steer = ref.raw["steer"].astype(np.float64)
    lat_g = ref.raw["lat_accel"].astype(np.float64) / _G
    long_g = ref.raw["long_accel"].astype(np.float64) / _G
    has_temp = _has_lf_temp(ref)

    payload_corners: list[dict] = []
    for c in corners:
        mask = _window_mask(dist, c["start_pct"], c["end_pct"])
        if not mask.any():
            # A corner window with no reference ticks is a degenerate span; skip
            # it rather than emit zeros that would read as "flat through here".
            continue
        idx = np.flatnonzero(mask)
        sp = speed[mask]
        block: dict = {
            "id": c["id"],
            "start_pct": c["start_pct"],
            "apex_pct": c["apex_pct"],
            "end_pct": c["end_pct"],
            "min_speed_ms": round(float(sp.min()), 2),
            "entry_speed_ms": round(float(speed[idx[0]]), 2),
            "exit_speed_ms": round(float(speed[idx[-1]]), 2),
            "peak_abs_steer_rad": round(float(np.abs(steer[mask]).max()), 3),
            "peak_lat_g": round(float(np.abs(lat_g[mask]).max()), 2),
            "peak_brake_g": round(float(np.maximum(-long_g[mask], 0.0).max()), 2),
            "peak_accel_g": round(float(np.maximum(long_g[mask], 0.0).max()), 2),
        }
        block["lf_tire_temp"] = _lf_temp(ref, mask) if has_temp else {
            "available": False,
            "reason": "left-front temp channels absent from this session",
        }
        payload_corners.append(block)

    payload: dict = {
        "basis": _BASIS,
        "reference_lap": int(ref.lap_number),
        "corners": payload_corners,
        "caveat": _CAVEAT,
    }
    if not corners:
        payload["finding"] = (
            "no corners detected on the reference lap's speed profile"
        )
    return payload


def _lf_temp(lap: ParsedLap, mask: np.ndarray) -> dict:
    """Mean left-front L/M/R edge temp across the corner window."""
    left = float(np.mean(lap.raw["lf_temp_l"][mask]))
    middle = float(np.mean(lap.raw["lf_temp_m"][mask]))
    right = float(np.mean(lap.raw["lf_temp_r"][mask]))
    return {
        "available": True,
        "corner": "LF",
        "left_c": round(left, 1),
        "middle_c": round(middle, 1),
        "right_c": round(right, 1),
        "spread_c": round(max(left, middle, right) - min(left, middle, right), 1),
    }
