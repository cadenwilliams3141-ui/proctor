"""Corner detection from a reference lap's grid speed (shared helper).

Observes where the fastest lap's speed dips into a prominent local minimum and
walks back out to the flanking straights. Purely geometric and self-referential:
these are the corners *this* driver's reference lap carved this session, derived
from resampled speed alone — not the track's surveyed corners. No METRIC_KEY;
this module is imported by the grid metrics, not registered as one.

Corners that straddle the 0/1 start-finish boundary are not detected in v1: the
grid is treated as an open interval, so a dip wrapping the line is missed rather
than guessed.

Given the lap's GPS as well, each corner also reports the RADIUS and TURN
DIRECTION of the line the driver actually drove through it — again their own
line, not the track's surveyed radius.
"""

from __future__ import annotations

import numpy as np

SMOOTH_WINDOW = 15         # bins (~1.5% of track) for the moving-average pass
MIN_PROMINENCE_MS = 3.0    # a dip shallower than this against its flanks is noise
MERGE_DISTANCE_BINS = 25   # minima nearer than this collapse to their deepest
RECOVERY_FRACTION = 0.90   # corner ends where speed climbs back to 90% of a flank

# Degrees of latitude per metre is ~constant; longitude shrinks by cos(lat).
# Same local equirectangular projection track_map writes as x_m/y_m — the two
# must agree, because a corner's radius and the map it is drawn on have to be
# the same geometry.
_M_PER_DEG = 111320.0

# Chord lengths the radius is fitted over, in METRES.
#
# Fixed in metres rather than as a fraction of the corner, and deliberately
# short. A corner window here runs from the braking point to where speed
# recovers on the exit, so it is far longer than the curved part — fitting a
# circle across the whole of it fits one through two straights and the bend
# between them, which is not the corner's radius. These stay inside the bend at
# any radius a real circuit has.
FIT_CHORDS_M = (12.0, 20.0, 30.0, 45.0)

# Beyond this the fit has not found a corner. An apex is the slowest point of a
# speed dip, which on a long sweeper can sit on road that is very nearly
# straight; the circle through three points there has a radius in the tens of
# thousands of metres. That is not a corner radius, so it is reported as None
# rather than printed as a measurement.
MAX_PLAUSIBLE_RADIUS_M = 1500.0


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


def _project(lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Lat/lon in degrees -> local metres about the lap centroid (x east, y north).

    Rounded to the centimetre, which is exactly what track_map stores as x_m/y_m
    and therefore exactly the line the app draws. The radius reported for a
    corner should be the radius of the line the driver is looking at, so the fit
    runs on the same numbers the map does — and the web app's own fallback fit,
    which only ever sees the stored centreline, lands on the same answer instead
    of one a metre or two away.
    """
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    lat_mean = float(np.mean(lat))
    x = (lon - float(np.mean(lon))) * _M_PER_DEG * np.cos(np.radians(lat_mean))
    y = (lat - lat_mean) * _M_PER_DEG
    return np.round(x, 2), np.round(y, 2)


def _signed_curvature(x: np.ndarray, y: np.ndarray, i: int, h: int) -> float | None:
    """Curvature at bin `i` from three points `h` apart, positive for a left turn.

    Positive is counter-clockwise in the x-east/y-north projection, which is a
    left-hand corner. None where the three points are collinear or coincident.
    """
    n = len(x)
    a, b, c = (i - h) % n, i % n, (i + h) % n

    abx, aby = x[b] - x[a], y[b] - y[a]
    bcx, bcy = x[c] - x[b], y[c] - y[b]
    cax, cay = x[a] - x[c], y[a] - y[c]

    lab = float(np.hypot(abx, aby))
    lbc = float(np.hypot(bcx, bcy))
    lca = float(np.hypot(cax, cay))
    if min(lab, lbc, lca) < 1e-6:
        return None

    # Twice the signed area of the triangle; its sign is the turn direction.
    kappa = 2.0 * (abx * bcy - aby * bcx) / (lab * lbc * lca)
    return float(kappa) if np.isfinite(kappa) else None


def _fit_geometry(x: np.ndarray, y: np.ndarray, apex: int, spacing: float) -> dict:
    """Radius and turn direction at an apex, fitted to the driven line.

    Three points at several chord lengths, then the MEDIAN of their signed
    curvatures. A single triple is at the mercy of GPS jitter — one noisy metre
    across a short chord swings the fitted radius by hundreds of metres — so the
    spread of chords and the median are what make the number stable.

    Both keys are None together: they come from one fit, so if it does not land,
    neither half is claimed.
    """
    unfitted = {"radius_m": None, "dir": None}
    n = len(x)
    if n < 8 or not spacing > 0:
        return unfitted

    max_h = max(2, n // 8)
    offsets = sorted({min(max_h, max(2, round(m / spacing))) for m in FIT_CHORDS_M})

    kappas = [k for k in (_signed_curvature(x, y, apex, h) for h in offsets) if k is not None]
    if not kappas:
        return unfitted

    kappa = float(np.median(kappas))
    if not np.isfinite(kappa) or kappa == 0.0:
        return unfitted

    radius = 1.0 / abs(kappa)
    if radius > MAX_PLAUSIBLE_RADIUS_M:
        return unfitted

    return {"radius_m": round(radius), "dir": "left" if kappa > 0 else "right"}


def detect_corners(
    grid_speed: np.ndarray,
    grid_pct: np.ndarray,
    lat_gps: np.ndarray | None = None,
    lon_gps: np.ndarray | None = None,
) -> list[dict]:
    """Detect corners as prominent local minima of the reference grid speed.

    Returns one dict per corner, ordered by track position:
        {"id": 1-based int, "start_pct", "apex_pct", "end_pct", "min_speed_ms"}.
    An empty list is a valid, honest answer (e.g. a constant-speed profile).

    Pass the same lap's `lat_gps`/`lon_gps` grids to also get "radius_m" and
    "dir" per corner, fitted to the line the driver drove. Those two keys appear
    ONLY when GPS was supplied — a caller that did not ask for geometry gets no
    geometry, rather than a pair of nulls it has to interpret.
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

    # Geometry is fitted only if this call was given GPS that actually moves —
    # a constant or absent Lat/Lon collapses to a point, which is not a line.
    geo_x = geo_y = None
    spacing = 0.0
    if lat_gps is not None and lon_gps is not None:
        lat = np.asarray(lat_gps, dtype=np.float64)
        lon = np.asarray(lon_gps, dtype=np.float64)
        if len(lat) == n and len(lon) == n and np.isfinite(lat).all() and np.isfinite(lon).all():
            geo_x, geo_y = _project(lat, lon)
            # Mean distance between consecutive samples, around the closed loop.
            steps = np.hypot(np.diff(geo_x, append=geo_x[0]), np.diff(geo_y, append=geo_y[0]))
            spacing = float(np.mean(steps))

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

        corner = {
            "id": idx + 1,
            "start_pct": round(float(pct[start]), 4),
            "apex_pct": round(float(pct[apex]), 4),
            "end_pct": round(float(pct[end]), 4),
            "min_speed_ms": round(float(speed[apex]), 3),
        }
        if geo_x is not None:
            # The apex is the slowest point, which is where the line is
            # tightest — the right place to measure the radius.
            corner.update(_fit_geometry(geo_x, geo_y, apex, spacing))
        corners.append(corner)
    return corners
