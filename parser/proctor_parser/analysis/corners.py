"""Corner detection from a reference lap's grid speed (shared helper).

Observes where the fastest lap's speed dips into a prominent local minimum and
walks back out to the flanking straights. Purely geometric and self-referential:
these are the corners *this* driver's reference lap carved this session, derived
from resampled speed alone — not the track's surveyed corners. No METRIC_KEY;
this module is imported by the grid metrics, not registered as one.

Corners that straddle the 0/1 start-finish boundary are not detected in v1: the
grid is treated as an open interval, so a dip wrapping the line is missed rather
than guessed.
"""

from __future__ import annotations

import numpy as np

SMOOTH_WINDOW = 15         # bins (~1.5% of track) for the moving-average pass
MIN_PROMINENCE_MS = 3.0    # a dip shallower than this against its flanks is noise
MERGE_DISTANCE_BINS = 25   # minima nearer than this collapse to their deepest
RECOVERY_FRACTION = 0.90   # corner ends where speed climbs back to 90% of a flank


def _smooth(y: np.ndarray, window: int) -> np.ndarray:
    """Centered moving average, edge-padded so the ends are not pulled inward."""
    n = len(y)
    if window <= 1 or window >= n:
        return np.asarray(y, dtype=np.float64)
    pad_l = window // 2
    pad_r = window - 1 - pad_l
    padded = np.pad(np.asarray(y, dtype=np.float64), (pad_l, pad_r), mode="edge")
    cumsum = np.cumsum(np.insert(padded, 0, 0.0))
    return (cumsum[window:] - cumsum[:-window]) / window


def _local_minima(s: np.ndarray) -> np.ndarray:
    """Interior local-minimum indices, tolerant of flat valley floors.

    A minimum is a descent followed by an ascent with any run of equal values
    (a plateau) allowed between them; for a flat floor the run's centre bin is
    reported. A perfectly constant profile has no minima.
    """
    if len(s) < 3:
        return np.empty(0, dtype=np.int64)
    sign = np.sign(np.diff(s))
    nz_pos = np.flatnonzero(sign != 0)
    if nz_pos.size < 2:
        return np.empty(0, dtype=np.int64)
    nz_sign = sign[nz_pos]
    turns = np.flatnonzero((nz_sign[:-1] < 0) & (nz_sign[1:] > 0))
    # Floor bins span [last-descent+1 .. first-ascent]; take the run's centre.
    lo = nz_pos[turns] + 1
    hi = nz_pos[turns + 1]
    return ((lo + hi) // 2).astype(np.int64)


def detect_corners(grid_speed: np.ndarray, grid_pct: np.ndarray) -> list[dict]:
    """Detect corners as prominent local minima of the reference grid speed.

    Returns one dict per corner, ordered by track position:
        {"id": 1-based int, "start_pct", "apex_pct", "end_pct", "min_speed_ms"}.
    An empty list is a valid, honest answer (e.g. a constant-speed profile).
    """
    speed = np.asarray(grid_speed, dtype=np.float64)
    pct = np.asarray(grid_pct, dtype=np.float64)
    n = len(speed)
    if n < 3:
        return []

    smoothed = _smooth(speed, SMOOTH_WINDOW)
    minima = _local_minima(smoothed)
    if minima.size == 0:
        return []

    # Prominence of each minimum: how far it sits below the higher of the two
    # flanking peaks, where a "flank" is the tallest point between this minimum
    # and its neighbouring minima (or the profile ends).
    kept: list[int] = []
    for pos, m in enumerate(minima):
        left_bound = minima[pos - 1] if pos > 0 else 0
        right_bound = minima[pos + 1] if pos < minima.size - 1 else n - 1
        left_peak = float(np.max(smoothed[left_bound:m])) if m > left_bound else smoothed[m]
        right_peak = (
            float(np.max(smoothed[m + 1:right_bound + 1])) if right_bound > m else smoothed[m]
        )
        prominence = min(left_peak, right_peak) - smoothed[m]
        if prominence >= MIN_PROMINENCE_MS:
            kept.append(int(m))

    if not kept:
        return []

    # Merge apexes closer than MERGE_DISTANCE_BINS, keeping the deepest of each run.
    groups: list[list[int]] = []
    for m in kept:
        if groups and m - groups[-1][-1] < MERGE_DISTANCE_BINS:
            groups[-1].append(m)
        else:
            groups.append([m])
    apexes = [min(group, key=lambda i: smoothed[i]) for group in groups]

    corners: list[dict] = []
    for idx, apex in enumerate(apexes):
        left_bound = apexes[idx - 1] if idx > 0 else 0
        right_bound = apexes[idx + 1] if idx < len(apexes) - 1 else n - 1
        left_peak = float(np.max(smoothed[left_bound:apex])) if apex > left_bound else smoothed[apex]
        right_peak = (
            float(np.max(smoothed[apex + 1:right_bound + 1]))
            if right_bound > apex else smoothed[apex]
        )

        # Walk outward until speed recovers to 90% of the flank; clamp to the
        # neighbouring apex so adjacent corners never overlap.
        left_seg = smoothed[left_bound:apex]
        recovered_l = np.flatnonzero(left_seg >= RECOVERY_FRACTION * left_peak)
        start = int(left_bound + recovered_l[-1]) if recovered_l.size else int(left_bound)

        right_seg = smoothed[apex + 1:right_bound + 1]
        recovered_r = np.flatnonzero(right_seg >= RECOVERY_FRACTION * right_peak)
        end = int(apex + 1 + recovered_r[0]) if recovered_r.size else int(right_bound)

        corners.append({
            "id": idx + 1,
            "start_pct": round(float(pct[start]), 4),
            "apex_pct": round(float(pct[apex]), 4),
            "end_pct": round(float(pct[end]), 4),
            "min_speed_ms": round(float(speed[apex]), 3),
        })
    return corners
