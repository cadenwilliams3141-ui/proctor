"""The width of road you actually used, lap over lap (module 16).

A disk .ibt carries one GPS trace per lap and nothing about the circuit itself —
no kerbs, no white lines, no surveyed edges. So this module does not claim to
draw the track. What it CAN do is stack every clean lap's recorded path against
the reference lap and measure how far apart they ran, metre by metre, all the
way round:

    at each point of the lap, take the reference lap's direction of travel,
    then measure each other lap's position along the perpendicular to it.

The band between the leftmost and rightmost of those is the road this driver
used. It is a real measurement of a real thing — and it is emphatically NOT the
track's width. A corner taken identically on every lap comes out as a thin line
because the driver was repeatable, not because the road was narrow. The payload
says this in its own caveat so the UI cannot present the band as track edges.

Positive offsets are to the LEFT of the reference lap's direction of travel,
negative to the right. Every coordinate is in metres in the same local frame
`track_map` writes, so a UI can draw them on the same canvas without rescaling.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "track_width"

_BASIS = "every clean lap's own GPS path measured against the reference lap's"
_CAVEAT = (
    "this is the road YOU used across these laps, not the track's width — the "
    ".ibt carries no kerbs, white lines or surveyed edges, and a band that "
    "narrows means you were repeatable there, not that the road did"
)

# Same projection constant and frame as track_map / corners, so the centreline,
# the corner radii and this band are all the same geometry.
_M_PER_DEG = 111320.0

_MIN_SPAN_DEG = 1e-6   # below this the GPS never moved: not a lap, a point
_MIN_LAPS = 2          # one lap has nothing to be wide against

# Half-chord, in samples, for the reference lap's direction of travel. A single
# adjacent sample is at the mercy of GPS jitter; a chord either side of the point
# gives a direction stable enough to measure a perpendicular against.
_TANGENT_HALF_CHORD = 6

# An offset past this is not a line through a corner — it is a GPS dropout, a
# tow, or a lap that left the circuit. Excluded from the band and counted.
_MAX_PLAUSIBLE_OFFSET_M = 40.0


def _has_gps(lap: ParsedLap) -> bool:
    lat = lap.grid.get("lat_gps")
    lon = lap.grid.get("lon_gps")
    if lat is None or lon is None or len(lat) == 0:
        return False
    if not (np.isfinite(lat).all() and np.isfinite(lon).all()):
        return False
    span = max(float(lat.max() - lat.min()), float(lon.max() - lon.min()))
    return span > _MIN_SPAN_DEG


def _insufficient(reason: str) -> dict:
    return {
        "basis": _BASIS,
        "insufficient_data": True,
        "reason": reason,
        "caveat": _CAVEAT,
    }


def compute(session: ParsedSession) -> dict:
    mappable = [lap for lap in session.laps if _has_gps(lap)]
    if not mappable:
        return _insufficient("no lap in this session carries usable GPS position data")

    ref = _reference_lap(mappable)
    if ref is None:
        return _insufficient("no lap with GPS could serve as a reference")

    # Clean laps are what the band is built from: an out lap driving down the
    # pit lane is a genuine GPS path and would blow the band open by 30 metres
    # while describing nothing about the road.
    clean = [
        lap for lap in mappable
        if lap.is_valid and not lap.is_out_lap and not lap.is_anomalous
    ]
    if len(clean) < _MIN_LAPS:
        return _insufficient(
            f"only {len(clean)} clean lap(s) with GPS — a band needs at least "
            f"{_MIN_LAPS} laps to have a width at all"
        )

    lat_ref = ref.grid["lat_gps"].astype(np.float64)
    lon_ref = ref.grid["lon_gps"].astype(np.float64)
    lat_mean = float(np.mean(lat_ref))
    lon_mean = float(np.mean(lon_ref))
    scale_x = _M_PER_DEG * float(np.cos(np.radians(lat_mean)))

    def project(lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return (lon - lon_mean) * scale_x, (lat - lat_mean) * _M_PER_DEG

    x_ref, y_ref = project(lat_ref, lon_ref)
    n = len(x_ref)

    # Unit normal to the reference lap's direction of travel, pointing left.
    h = min(_TANGENT_HALF_CHORD, max(1, n // 8))
    tx = np.roll(x_ref, -h) - np.roll(x_ref, h)
    ty = np.roll(y_ref, -h) - np.roll(y_ref, h)
    length = np.hypot(tx, ty)
    # Where the car was stationary the chord collapses; a zero-length tangent has
    # no perpendicular, so those samples are marked and never measured against.
    usable_normal = length > 1e-6
    safe = np.where(usable_normal, length, 1.0)
    nx = -ty / safe
    ny = tx / safe

    offsets: list[np.ndarray] = []
    lap_numbers: list[int] = []
    excluded = 0
    for lap in clean:
        x, y = project(
            lap.grid["lat_gps"].astype(np.float64),
            lap.grid["lon_gps"].astype(np.float64),
        )
        if len(x) != n:
            excluded += 1
            continue
        off = (x - x_ref) * nx + (y - y_ref) * ny
        off = np.where(usable_normal, off, np.nan)
        off = np.where(np.abs(off) <= _MAX_PLAUSIBLE_OFFSET_M, off, np.nan)
        if not np.isfinite(off).any():
            excluded += 1
            continue
        offsets.append(off)
        lap_numbers.append(int(lap.lap_number))

    if len(offsets) < _MIN_LAPS:
        return _insufficient(
            "the clean laps' GPS paths could not be measured against each other "
            f"(only {len(offsets)} usable after removing implausible offsets)"
        )

    stack = np.vstack(offsets)
    counts = np.count_nonzero(np.isfinite(stack), axis=0)
    measured = counts >= _MIN_LAPS

    # Where fewer than two laps have a finite offset there is no band; those
    # samples collapse to the centreline rather than reporting a made-up width.
    def across(fn) -> np.ndarray:
        with np.errstate(all="ignore"):
            values = fn(stack, axis=0)
        return np.where(measured, np.nan_to_num(values, nan=0.0), 0.0)

    left = across(np.nanmax)
    right = across(np.nanmin)
    median = across(np.nanmedian)
    p90 = across(lambda a, axis: np.nanpercentile(a, 90, axis=axis))
    p10 = across(lambda a, axis: np.nanpercentile(a, 10, axis=axis))
    width = left - right

    payload: dict = {
        "basis": _BASIS,
        "source_lap": int(ref.lap_number),
        "laps_used": lap_numbers,
        "projection": "local_equirectangular_meters",
        "origin": {"lat": round(lat_mean, 7), "lon": round(lon_mean, 7)},
        "origin_note": (
            "add these back to convert any lap's Lat/Lon into the same metres "
            "frame: x = (lon - origin.lon) * 111320 * cos(origin.lat), "
            "y = (lat - origin.lat) * 111320"
        ),
        "grid_pct": [round(float(v), 4) for v in ref.grid["grid_pct"]],
        "centre_x_m": [round(float(v), 2) for v in x_ref],
        "centre_y_m": [round(float(v), 2) for v in y_ref],
        "normal_x": [round(float(v), 4) for v in nx],
        "normal_y": [round(float(v), 4) for v in ny],
        "left_m": [round(float(v), 2) for v in left],
        "right_m": [round(float(v), 2) for v in right],
        "median_m": [round(float(v), 2) for v in median],
        "p90_m": [round(float(v), 2) for v in p90],
        "p10_m": [round(float(v), 2) for v in p10],
        "used_width_m": [round(float(v), 2) for v in width],
        "sign_note": (
            "positive is to the LEFT of the reference lap's direction of travel, "
            "negative to the right"
        ),
        "summary": _summary(width[measured], p90[measured] - p10[measured]),
        "caveat": _CAVEAT,
    }
    if excluded:
        payload["laps_excluded"] = excluded
        payload["exclusion_reason"] = (
            "laps whose GPS never came within "
            f"{_MAX_PLAUSIBLE_OFFSET_M:.0f} m of the reference line — a dropout, "
            "a tow, or a lap that left the circuit"
        )
    if not measured.all():
        payload["unmeasured_samples"] = int(np.count_nonzero(~measured))
        payload["unmeasured_note"] = (
            "samples where fewer than two laps had a usable position; the band "
            "collapses to the centreline there rather than showing a made-up width"
        )
    return payload


def _summary(width: np.ndarray, spread: np.ndarray) -> dict:
    if width.size == 0:
        return {"measured": False, "reason": "no sample had two laps to compare"}
    return {
        "measured": True,
        "median_used_width_m": round(float(np.median(width)), 2),
        "widest_m": round(float(np.max(width)), 2),
        "narrowest_m": round(float(np.min(width)), 2),
        "median_typical_spread_m": round(float(np.median(spread)), 2),
        "spread_note": (
            "the typical spread ignores the single widest and narrowest laps "
            "(10th to 90th percentile) — it is where your line usually sat"
        ),
    }


def _reference_lap(laps: list[ParsedLap]) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, else fastest valid (contract rule 4)."""
    valid = [l for l in laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)
