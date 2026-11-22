"""Lap segmentation, validity flags, and fixed-grid resampling."""

from __future__ import annotations

import numpy as np

GRID_POINTS = 1000

# Channels whose values are states, not quantities: resampled by nearest tick.
DISCRETE_CHANNELS = frozenset({"gear", "abs_active"})

# The sim forces Brake=1.0 with BrakeRaw=0 whenever the car is stopped
# (stationary auto-brake). Any Brake-vs-BrakeRaw comparison must exclude
# ticks at or below this speed or it reports false hardware faults at
# every race start.
STATIONARY_SPEED_MPS = 5.0

# A valid lap whose resampled speed profile deviates from the session median
# profile by more than this fraction (RMS, relative to the median profile's
# mean speed) is flagged anomalous. Self-referential threshold — no physics.
ANOMALY_RMS_FRACTION = 0.15

# Fewer valid laps than this and a median profile is not meaningful, so
# profile-based anomaly detection is skipped (incidents still flag).
MIN_LAPS_FOR_PROFILE = 4


def moving_mask(speed: np.ndarray) -> np.ndarray:
    """Boolean mask of ticks where the car is genuinely moving."""
    return speed > STATIONARY_SPEED_MPS


def contiguous_runs(values: np.ndarray) -> list[tuple[int, int, int]]:
    """Split an int array into contiguous runs → [(value, start, end_exclusive)]."""
    if len(values) == 0:
        return []
    bounds = np.flatnonzero(np.diff(values)) + 1
    starts = np.concatenate(([0], bounds))
    ends = np.concatenate((bounds, [len(values)]))
    return [(int(values[s]), int(s), int(e)) for s, e in zip(starts, ends)]


def resample_to_grid(dist_pct: np.ndarray, channels: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Resample per-tick channels onto the fixed GRID_POINTS distance grid.

    dist_pct is forced monotonic (cumulative max) to survive tick jitter.
    Outside the driven range np.interp holds edge values; laps that only
    cover part of the track are marked invalid upstream, so edge-fill is
    display-safe.
    """
    grid = (np.arange(GRID_POINTS, dtype=np.float64) + 0.5) / GRID_POINTS
    d = np.maximum.accumulate(np.asarray(dist_pct, dtype=np.float64))
    out: dict[str, np.ndarray] = {
        "grid_pct": grid.astype(np.float32),
    }
    nearest = _nearest_index(d, grid)
    for name, values in channels.items():
        v = np.asarray(values, dtype=np.float64)
        if name in DISCRETE_CHANNELS:
            # A gear is 3 or 4, never 3.4; an ABS flag is on or off. Linear
            # interpolation invents values the car never had at every change.
            out[name] = v[nearest].astype(np.float32)
        else:
            out[name] = np.interp(grid, d, v).astype(np.float32)
    return out


def _nearest_index(d: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Index of the tick nearest each grid point along non-decreasing `d`."""
    n = len(d)
    if n == 0:
        return np.zeros(len(grid), dtype=np.int64)
    hi = np.clip(np.searchsorted(d, grid, side="left"), 0, n - 1)
    lo = np.clip(hi - 1, 0, n - 1)
    pick_lo = np.abs(grid - d[lo]) <= np.abs(d[hi] - grid)
    return np.where(pick_lo, lo, hi)


def anomalous_by_profile(grid_speeds: dict[int, np.ndarray]) -> set[int]:
    """Lap numbers whose grid speed deviates from the median profile.

    grid_speeds: lap_number -> resampled speed array (valid laps only).
    """
    if len(grid_speeds) < MIN_LAPS_FOR_PROFILE:
        return set()
    stack = np.stack(list(grid_speeds.values()))
    median_profile = np.median(stack, axis=0)
    scale = float(np.mean(median_profile))
    if scale <= 0:
        return set()
    flagged = set()
    for lap_number, speed in grid_speeds.items():
        rms = float(np.sqrt(np.mean((speed - median_profile) ** 2)))
        if rms / scale > ANOMALY_RMS_FRACTION:
            flagged.add(lap_number)
    return flagged
