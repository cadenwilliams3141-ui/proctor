"""Where one lap ran across the road relative to another (helper, no METRIC_KEY).

The reference lap's GPS path, projected to metres, gives a direction of travel
at every grid point; the perpendicular to it points LEFT. Any other lap's
position projected onto that perpendicular is how far left (+) or right (-) of
the reference line it ran there.

track_width stacks those offsets into the band of road a driver used;
driving_aspects reads them at a corner's turn-in, apex and exit to see whether
the quicker passes ran a different line. One copy of the geometry, so the two
can never disagree about where a lap was.
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np

# Same projection constant and frame as track_map / corners, so the centreline,
# the corner radii and the offsets are all the same geometry.
M_PER_DEG = 111320.0

# Half-chord, in samples, for the reference lap's direction of travel. A single
# adjacent sample is at the mercy of GPS jitter; a chord either side of the point
# gives a direction stable enough to measure a perpendicular against.
TANGENT_HALF_CHORD = 6

# An offset past this is not a line through a corner — it is a GPS dropout, a
# tow, or a lap that left the circuit. Reported as not measured.
MAX_PLAUSIBLE_OFFSET_M = 40.0


class Frame(NamedTuple):
    lat_mean: float
    lon_mean: float
    scale_x: float
    x_ref: np.ndarray
    y_ref: np.ndarray
    nx: np.ndarray
    ny: np.ndarray
    usable: np.ndarray


def frame(lat_ref: np.ndarray, lon_ref: np.ndarray) -> Frame:
    """The reference lap's path and its left-pointing unit normals, in metres."""
    lat_ref = np.asarray(lat_ref, dtype=np.float64)
    lon_ref = np.asarray(lon_ref, dtype=np.float64)
    lat_mean = float(np.mean(lat_ref))
    lon_mean = float(np.mean(lon_ref))
    scale_x = M_PER_DEG * float(np.cos(np.radians(lat_mean)))
    x_ref = (lon_ref - lon_mean) * scale_x
    y_ref = (lat_ref - lat_mean) * M_PER_DEG
    n = len(x_ref)

    h = min(TANGENT_HALF_CHORD, max(1, n // 8))
    tx = np.roll(x_ref, -h) - np.roll(x_ref, h)
    ty = np.roll(y_ref, -h) - np.roll(y_ref, h)
    length = np.hypot(tx, ty)
    # Where the car was stationary the chord collapses; a zero-length tangent has
    # no perpendicular, so those samples are marked and never measured against.
    usable = length > 1e-6
    safe = np.where(usable, length, 1.0)
    return Frame(lat_mean, lon_mean, scale_x, x_ref, y_ref, -ty / safe, tx / safe, usable)


def project(f: Frame, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    return (lon - f.lon_mean) * f.scale_x, (lat - f.lat_mean) * M_PER_DEG


def offsets(f: Frame, lat: np.ndarray, lon: np.ndarray) -> np.ndarray | None:
    """Metres left (+) / right (-) of the reference line at every grid point.

    NaN where the reference had no direction or the offset is implausible;
    None if the lap's grid does not line up with the reference's.
    """
    x, y = project(f, lat, lon)
    if len(x) != len(f.x_ref):
        return None
    off = (x - f.x_ref) * f.nx + (y - f.y_ref) * f.ny
    off = np.where(f.usable, off, np.nan)
    return np.where(np.abs(off) <= MAX_PLAUSIBLE_OFFSET_M, off, np.nan)
