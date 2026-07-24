"""Left-front tire surface temperatures across the lap edges (module 10).

The v1 contract carries surface temps for the left-front corner only
(LFtempL/M/R). The other three corners are simply absent from the telemetry —
missing, not zero — so this module reports the LF story and says the rest is
unavailable rather than fabricating it.

Per clean lap it averages each edge over the lap's final quarter, where temps
have stabilized. iRacing's L/M/R are the tire's left, middle and right edges as
recorded; which edge is physically inner vs outer depends on the corner and
camber, so this module names the edges as-recorded and never asserts an inner/
outer identity or an ideal window.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "tire_temps"

_BASIS = "left-front surface temps from this session only"
_NOTE = (
    "L/M/R are the tire's left/middle/right edges as recorded by iRacing; which "
    "edge is physically inner vs outer is not asserted; spread describes the "
    "camber/pressure story"
)
_CAVEAT = (
    "display only -- no 'ideal window' is asserted; that needs calibration data "
    "across sessions"
)
_TAIL_FRACTION = 0.25  # temps read from the final quarter of each lap
_CURVE_POINTS = 100    # distance bins for the across-lap heat-map curve


def compute(session: ParsedSession) -> dict:
    clean = [lap for lap in session.laps if lap.is_valid and not lap.is_anomalous]

    per_lap: dict[str, dict] = {}
    lefts: list[float] = []
    middles: list[float] = []
    rights: list[float] = []
    spreads: list[float] = []
    curve_ref: ParsedLap | None = None
    for lap in clean:
        means = _tail_means(lap)
        if means is None:
            continue
        # Across-lap curve comes from the fastest clean lap that carries temps.
        if curve_ref is None or (
            lap.lap_time_s is not None
            and curve_ref.lap_time_s is not None
            and lap.lap_time_s < curve_ref.lap_time_s
        ):
            curve_ref = lap
        left, middle, right = means
        spread = max(left, middle, right) - min(left, middle, right)
        per_lap[str(lap.lap_number)] = {
            "left_c": round(left, 1),
            "middle_c": round(middle, 1),
            "right_c": round(right, 1),
            "spread_c": round(spread, 1),
        }
        lefts.append(left)
        middles.append(middle)
        rights.append(right)
        spreads.append(spread)

    if not per_lap:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no clean laps with left-front temps",
            "corner": "LF",
            "other_corners": {
                "available": False,
                "reason": "only LFtemp L/M/R carried in the v1 contract",
            },
            "caveat": _CAVEAT,
        }

    payload: dict = {
        "basis": _BASIS,
        "corner": "LF",
        "other_corners": {
            "available": False,
            "reason": "only LFtemp L/M/R carried in the v1 contract",
        },
        "laps": per_lap,
        "session_median": {
            "left_c": round(float(np.median(lefts)), 1),
            "middle_c": round(float(np.median(middles)), 1),
            "right_c": round(float(np.median(rights)), 1),
            "spread_c": round(float(np.median(spreads)), 1),
        },
        "note": _NOTE,
        "caveat": _CAVEAT,
    }
    if curve_ref is not None:
        payload["curve"] = _curve(curve_ref)
    # Masking freezes wear, not temperature: keep the temps, flag the wear gap.
    if session.meta.wear_masked:
        payload["wear"] = {
            "skipped": True,
            "reason": "tire wear frozen in this session",
        }
    return payload


def _tail_means(lap: ParsedLap) -> tuple[float, float, float] | None:
    """Mean L/M/R edge temp over the lap's final quarter, or None if absent."""
    if not all(f"lf_temp_{e}" in lap.raw for e in ("l", "m", "r")):
        return None
    n = len(lap.raw["lf_temp_m"])
    if n == 0:
        return None
    start = int(n * (1.0 - _TAIL_FRACTION))
    left = float(np.mean(lap.raw["lf_temp_l"][start:]))
    middle = float(np.mean(lap.raw["lf_temp_m"][start:]))
    right = float(np.mean(lap.raw["lf_temp_r"][start:]))
    return left, middle, right


def _curve(lap: ParsedLap) -> dict:
    """LF L/M/R edge temps resampled onto a fixed distance grid for a heat map.

    Distance is forced monotonic (cumulative max) to survive tick jitter, then
    np.interp maps each edge onto _CURVE_POINTS evenly-spaced distance bins so
    the UI can draw temperature against track position for one reference lap.
    """
    grid = (np.arange(_CURVE_POINTS, dtype=np.float64) + 0.5) / _CURVE_POINTS
    d = np.maximum.accumulate(lap.raw["dist"].astype(np.float64))

    def onto(edge: str) -> list[float]:
        vals = np.interp(grid, d, lap.raw[f"lf_temp_{edge}"].astype(np.float64))
        return [round(float(v), 1) for v in vals]

    return {
        "source_lap": int(lap.lap_number),
        "corner": "LF",
        "grid_pct": [round(float(v), 4) for v in grid],
        "left_c": onto("l"),
        "middle_c": onto("m"),
        "right_c": onto("r"),
    }
