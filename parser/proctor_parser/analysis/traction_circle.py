"""Traction circle (module 6): the driver's demonstrated g-g envelope.

Observes the lateral/longitudinal acceleration the car actually reached this
session and, per angle, how far out the driver went. The "envelope" is the
outer boundary of the driver's own g-g cloud — not a tyre model, not a physics
limit — so every derived number is self-comparison against that cloud.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedSession

METRIC_KEY = "traction_circle"

_G = 9.81                 # m/s² per g (per module spec)
_BINS = 36                # 10° angular bins around the g-g circle
_BIN_WIDTH = 360.0 / _BINS
_MIN_TICKS_PER_BIN = 10   # below this a bin's radius is null, not zero
_ENVELOPE_PCT = 98.0      # robust outer boundary, ignores single-tick spikes
_MAX_SCATTER = 3000       # UI plotting budget across the whole session
_EPS = 1e-9

_CENTERS = np.arange(_BINS) * _BIN_WIDTH + _BIN_WIDTH / 2.0  # 5,15,...,355


def _moving_g(lap) -> tuple[np.ndarray, np.ndarray]:
    """Return (lat_g, long_g) for a lap's moving, finite ticks only."""
    lat = lap.raw["lat_accel"].astype(np.float64) / _G
    lon = lap.raw["long_accel"].astype(np.float64) / _G
    keep = moving_mask(lap.raw["speed"]) & np.isfinite(lat) & np.isfinite(lon)
    return lat[keep], lon[keep]


def _bins(lat_g: np.ndarray, long_g: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Magnitude, angle (deg 0..360), and bin index for each g-g point."""
    mag = np.hypot(lat_g, long_g)
    angle = np.degrees(np.arctan2(long_g, lat_g)) % 360.0
    idx = np.floor(angle / _BIN_WIDTH).astype(int) % _BINS
    return mag, angle, idx


def _insufficient(reason: str) -> dict:
    return {
        "insufficient_data": True,
        "reason": reason,
        "basis": "self-comparison within this session",
    }


def compute(session: ParsedSession) -> dict:
    # Envelope is built from every lap's moving ticks (out/in laps included).
    lat_all, long_all = [], []
    for lap in session.laps:
        lg, og = _moving_g(lap)
        lat_all.append(lg)
        long_all.append(og)
    lat_all = np.concatenate(lat_all) if lat_all else np.empty(0)
    long_all = np.concatenate(long_all) if long_all else np.empty(0)

    if lat_all.size == 0:
        return _insufficient("no moving ticks in this session (car never left the pits)")

    mag_all, _angle_all, idx_all = _bins(lat_all, long_all)
    if not np.any(mag_all > _EPS):
        return _insufficient("acceleration channels are flat (zero g throughout)")

    # Per-bin outer boundary: 98th percentile magnitude; too-sparse bins → null.
    radii: list[float | None] = []
    for b in range(_BINS):
        in_bin = mag_all[idx_all == b]
        if in_bin.size >= _MIN_TICKS_PER_BIN:
            radii.append(float(np.percentile(in_bin, _ENVELOPE_PCT)))
        else:
            radii.append(None)

    populated = np.array([r is not None for r in radii])
    if not populated.any():
        return _insufficient("too few g-g points per direction to define an envelope")

    pop_centers = _CENTERS[populated]
    pop_radii = np.array([r for r in radii if r is not None], dtype=np.float64)

    envelope = [
        {"angle_deg": round(float(c), 1), "g": (round(r, 3) if r is not None else None)}
        for c, r in zip(_CENTERS, radii)
    ]

    # Per-lap utilisation = mean(|g| / envelope-radius-at-that-angle) over the
    # lap's moving ticks, as a % of the driver's own demonstrated envelope.
    laps_out: dict[str, dict] = {}
    for lap in session.laps:
        if not lap.is_valid:
            continue
        lg, og = _moving_g(lap)
        if lg.size == 0:
            laps_out[str(lap.lap_number)] = {"utilization_pct": None}
            continue
        mag, angle, idx = _bins(lg, og)
        keep = populated[idx]  # skip ticks whose own bin has no envelope
        if not keep.any():
            laps_out[str(lap.lap_number)] = {"utilization_pct": None}
            continue
        radius_at = np.interp(angle[keep], pop_centers, pop_radii, period=360.0)
        radius_at = np.maximum(radius_at, _EPS)
        util = float(np.mean(mag[keep] / radius_at) * 100.0)
        util = max(0.0, min(100.0, util))
        laps_out[str(lap.lap_number)] = {"utilization_pct": round(util, 1)}

    # Scatter: every Nth moving tick so the session sends ≤ _MAX_SCATTER points.
    step = int(np.ceil(lat_all.size / _MAX_SCATTER))
    scatter = [
        [round(float(la), 3), round(float(lo), 3)]
        for la, lo in zip(lat_all[::step], long_all[::step])
    ]

    return {
        "basis": "envelope is the outer boundary of your own g-g data in this session, not a physics model",
        "envelope": envelope,
        "laps": laps_out,
        "scatter": scatter,
        "caveat": "one session's envelope; grows with more data",
    }
