"""Road grade under the car, tick by tick (shared helper, not a metric).

The slope of the road from altitude against distance travelled. It matters
wherever braking is read: the accelerometer cannot tell braking from gravity,
so on a downhill part of the deceleration it reports is the hill.

One calculation, used by contact_patch (the session's grade story) and
trail_braking (the grade under each corner's braking zone), so the two can
never disagree about how steep a piece of road is. No METRIC_KEY; this module
is imported, not registered.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap

# A grade beyond this is a GPS/altitude dropout, not a road.
MAX_PLAUSIBLE_GRADE = 0.30


def grade_per_tick(lap: ParsedLap, track_m: float) -> np.ndarray | None:
    """Rise over run for every tick of `lap`, NaN wherever it cannot be read.

    Computed over the lap's MOVING ticks only, then scattered back to full
    length, so stationary ticks and the 1 -> 0 wrap at the line are NaN rather
    than an invented cliff. Returns None when the lap carries no altitude or the
    track length is unknown (distance per tick cannot be scaled without it).
    """
    if "alt" not in lap.raw or track_m <= 0:
        return None

    n = len(lap.raw["speed"])
    out = np.full(n, np.nan)
    moving = moving_mask(lap.raw["speed"])
    if int(np.count_nonzero(moving)) < 3:
        return out

    alt = lap.raw["alt"].astype(np.float64)[moving]
    dist = lap.raw["dist"].astype(np.float64)[moving] * track_m
    d_alt = np.gradient(alt)
    d_dist = np.gradient(dist)
    # A lap wraps 1 -> 0 at the line, which makes one d_dist hugely negative.
    # Guarding on magnitude drops that sample rather than inventing a cliff.
    ok = np.isfinite(d_alt) & np.isfinite(d_dist) & (np.abs(d_dist) > 0.01)
    grade = np.full(d_alt.shape, np.nan)
    grade[ok] = d_alt[ok] / d_dist[ok]
    grade[np.abs(grade) > MAX_PLAUSIBLE_GRADE] = np.nan

    out[np.flatnonzero(moving)] = grade
    return out
