"""Where the racing surface actually ends (module 17).

`track_width` measures the band between the driver's own lines. Useful, but it
is not the track — it is the road they happened to use, and it says nothing
about what was available beside them.

This module measures the road itself, using the one channel that knows:
`PlayerTrackSurface` is the sim's own verdict on where the car is, tick by tick
(irsdk_TrkLoc: -1 NotInWorld, 0 OffTrack, 1 InPitStall, 2 AproachingPits,
3 OnTrack). So at every point of the lap, the OUTERMOST position at which the
sim still said OnTrack is a measured statement about where the surface reached.

    the edge is the last place the sim agreed you were on the track

Three things follow, and all three are on screen wherever this is drawn:

  * It is a LOWER BOUND, not the edge. The flag describes the car's reference
    point, so the true asphalt continues some way beyond the outermost sample —
    roughly half a car's width, plus however much road was never visited. Drive
    a lap down each side and the bound tightens onto the real thing; that is
    the calibration lap other analysers ask for, and here it is an accelerator
    rather than a requirement.
  * It only knows where the car went. A corner taken on one line every lap
    reports a narrow surface, because nothing measured the rest.
  * It grows. Every session at a track contributes, so the boundary is a
    per-TRACK asset that improves with use rather than a per-session snapshot.
    The merge across sessions happens at ingest; this module reports one
    session's contribution and emits it in a frame-free form (lat/lon) so the
    merge can put several sessions in one frame.

Pit ticks are excluded by construction: InPitStall and AproachingPits are not
OnTrack, so the pit lane never widens the circuit.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "track_edges"

_BASIS = "the sim's own on-track flag, at every tick of every lap in this session"
_CAVEAT = (
    "a LOWER BOUND on the surface, not its edge: the flag follows the car's "
    "reference point, so the real asphalt reaches further than the outermost "
    "sample, and any road you never drove on is not in here at all"
)

# irsdk_TrkLoc
SURFACE_OFF_TRACK = 0
SURFACE_ON_TRACK = 3

# irsdk_TrkSurf ranges worth naming. Anything outside these is reported by its
# raw code rather than given a label this module is not sure of.
_MATERIALS: tuple[tuple[str, int, int], ...] = (
    ("asphalt", 1, 4),
    ("concrete", 5, 6),
    ("racing dirt", 7, 8),
    ("paint", 9, 10),
    ("kerb", 11, 14),
    ("grass", 15, 18),
    ("dirt", 19, 22),
    ("sand", 23, 23),
    ("gravel", 24, 25),
    ("grasscrete", 26, 26),
    ("astroturf", 27, 27),
)

# Same projection constant and frame as track_map, corners and track_width.
_M_PER_DEG = 111320.0

_MIN_SPAN_DEG = 1e-6
_TANGENT_HALF_CHORD = 6

# Beyond this an "on track" sample is not the edge of the circuit — it is a GPS
# dropout, a tow, or a lap on a different layout that shares a track name.
_MAX_PLAUSIBLE_OFFSET_M = 60.0

# An excursion shorter than this is a single-tick flicker at a kerb, not a trip
# across the grass.
_MIN_EXCURSION_TICKS = 3
_EXCURSION_CAP = 40


def material_name(code: int) -> str:
    for name, lo, hi in _MATERIALS:
        if lo <= code <= hi:
            return name
    return f"material {code}"


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


def _reference_lap(laps: list[ParsedLap]) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, else fastest valid (contract rule 4)."""
    valid = [l for l in laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def compute(session: ParsedSession) -> dict:
    carries_surface = any("track_surface" in lap.raw for lap in session.laps)
    if not carries_surface:
        return _insufficient(
            "this file does not carry PlayerTrackSurface, so the sim never said "
            "where the track ended; nothing about the surface is inferred from "
            "the driven line in its place"
        )

    mappable = [lap for lap in session.laps if _has_gps(lap)]
    ref = _reference_lap(mappable)
    if ref is None:
        return _insufficient(
            "no valid lap with GPS to hang a centreline on"
        )

    lat_ref = ref.grid["lat_gps"].astype(np.float64)
    lon_ref = ref.grid["lon_gps"].astype(np.float64)
    lat_mean = float(np.mean(lat_ref))
    lon_mean = float(np.mean(lon_ref))
    scale_x = _M_PER_DEG * float(np.cos(np.radians(lat_mean)))
    n = len(lat_ref)

    x_ref = (lon_ref - lon_mean) * scale_x
    y_ref = (lat_ref - lat_mean) * _M_PER_DEG

    # Unit normal to the reference line, pointing left of travel.
    h = min(_TANGENT_HALF_CHORD, max(1, n // 8))
    tx = np.roll(x_ref, -h) - np.roll(x_ref, h)
    ty = np.roll(y_ref, -h) - np.roll(y_ref, h)
    length = np.hypot(tx, ty)
    usable = length > 1e-6
    safe = np.where(usable, length, 1.0)
    nx = -ty / safe
    ny = tx / safe

    # Per-bin extremes. NaN means "no on-track tick was ever seen in this bin",
    # which is not the same as an edge at zero and is never rounded into one.
    left = np.full(n, np.nan)
    right = np.full(n, np.nan)
    left_lat = np.full(n, np.nan)
    left_lon = np.full(n, np.nan)
    right_lat = np.full(n, np.nan)
    right_lon = np.full(n, np.nan)

    laps_used: list[int] = []
    on_ticks = off_ticks = total_ticks = 0
    material_counts: dict[int, int] = {}
    excursions: list[dict] = []
    tick_rate = session.meta.tick_rate or 60

    for lap in session.laps:
        surface = lap.raw.get("track_surface")
        if surface is None or len(surface) == 0:
            continue
        surface = surface.astype(np.int64)
        lat = lap.raw["lat_gps"].astype(np.float64)
        lon = lap.raw["lon_gps"].astype(np.float64)
        dist = lap.raw["dist"].astype(np.float64)
        if not (len(lat) == len(surface) == len(dist)):
            continue

        total_ticks += surface.size
        on_track = surface == SURFACE_ON_TRACK
        on_ticks += int(np.count_nonzero(on_track))
        off_ticks += int(np.count_nonzero(surface == SURFACE_OFF_TRACK))

        material = lap.raw.get("track_surface_material")
        if material is not None and len(material) == surface.size:
            codes, counts = np.unique(material.astype(np.int64), return_counts=True)
            for code, count in zip(codes, counts):
                material_counts[int(code)] = material_counts.get(int(code), 0) + int(count)

        excursions.extend(_excursions(lap, surface, dist, tick_rate))

        keep = on_track & np.isfinite(lat) & np.isfinite(lon) & np.isfinite(dist)
        if not keep.any():
            continue

        # Bin by track position. grid_pct holds bin CENTRES ((i+0.5)/n), so a
        # distance maps to its bin by flooring — the same inversion the rest of
        # the app uses.
        idx = np.clip(np.floor(dist[keep] * n).astype(np.int64), 0, n - 1)
        px = (lon[keep] - lon_mean) * scale_x
        py = (lat[keep] - lat_mean) * _M_PER_DEG
        offset = (px - x_ref[idx]) * nx[idx] + (py - y_ref[idx]) * ny[idx]

        sane = usable[idx] & (np.abs(offset) <= _MAX_PLAUSIBLE_OFFSET_M)
        if not sane.any():
            continue
        idx, offset = idx[sane], offset[sane]
        klat, klon = lat[keep][sane], lon[keep][sane]

        # np.maximum.at accumulates per bin without a Python loop over ticks.
        wider_left = np.full(n, -np.inf)
        wider_right = np.full(n, np.inf)
        np.maximum.at(wider_left, idx, offset)
        np.minimum.at(wider_right, idx, offset)

        for arr, cmp, off_store, lat_store, lon_store in (
            (wider_left, np.greater, left, left_lat, left_lon),
            (wider_right, np.less, right, right_lat, right_lon),
        ):
            touched = np.isfinite(arr)
            improves = touched & (~np.isfinite(off_store) | cmp(arr, off_store))
            if not improves.any():
                continue
            off_store[improves] = arr[improves]
            # Carry the LAT/LON of the winning tick, not its offset alone: the
            # merge across sessions has to re-measure these against a shared
            # centreline, and a number relative to this session's reference lap
            # cannot be re-measured against anything.
            for b in np.flatnonzero(improves):
                hits = np.flatnonzero(idx == b)
                if hits.size == 0:
                    continue
                pick = hits[np.argmax(offset[hits])] if cmp is np.greater else hits[np.argmin(offset[hits])]
                lat_store[b] = klat[pick]
                lon_store[b] = klon[pick]

        laps_used.append(int(lap.lap_number))

    observed = np.isfinite(left) | np.isfinite(right)
    if not observed.any():
        return _insufficient(
            "no tick in this session was recorded on the racing surface with a "
            "usable position"
        )

    width = np.where(
        np.isfinite(left) & np.isfinite(right), left - right, np.nan
    )

    return {
        "basis": _BASIS,
        "method": (
            "outermost position at which PlayerTrackSurface still read OnTrack, "
            "per distance bin, across every lap in this session"
        ),
        "source_lap": int(ref.lap_number),
        "laps_used": laps_used,
        "projection": "local_equirectangular_meters",
        "origin": {"lat": round(lat_mean, 7), "lon": round(lon_mean, 7)},
        "grid_pct": [round(float(v), 4) for v in ref.grid["grid_pct"]],
        "centre_x_m": _round(x_ref, 2),
        "centre_y_m": _round(y_ref, 2),
        "normal_x": _round(nx, 4),
        "normal_y": _round(ny, 4),
        "left_m": _round(left, 2),
        "right_m": _round(right, 2),
        "width_m": _round(width, 2),
        # Frame-free, for merging this session into the per-track boundary.
        "left_lat": _round(left_lat, 7),
        "left_lon": _round(left_lon, 7),
        "right_lat": _round(right_lat, 7),
        "right_lon": _round(right_lon, 7),
        "coverage_pct": round(100.0 * float(np.count_nonzero(observed)) / n, 1),
        "coverage_note": (
            "share of the lap where at least one on-track position was seen; "
            "the rest is unmeasured and is drawn as a gap, not as zero width"
        ),
        "surface": _surface_block(
            on_ticks, off_ticks, total_ticks, material_counts, excursions
        ),
        "caveat": _CAVEAT,
    }


def _round(arr: np.ndarray, dp: int) -> list[float | None]:
    """Round, mapping NaN to None. A gap must survive to JSON as null."""
    return [None if not np.isfinite(v) else round(float(v), dp) for v in arr]


def _excursions(
    lap: ParsedLap, surface: np.ndarray, dist: np.ndarray, tick_rate: int
) -> list[dict]:
    """Runs where the sim said the car had left the racing surface."""
    off = surface == SURFACE_OFF_TRACK
    idx = np.flatnonzero(off)
    if idx.size == 0:
        return []

    material = lap.raw.get("track_surface_material")
    out: list[dict] = []
    for group in np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1):
        if group.size < _MIN_EXCURSION_TICKS:
            continue
        event = {
            "lap": int(lap.lap_number),
            "start_pct": round(float(dist[group[0]]), 4),
            "duration_ms": round(group.size * 1000.0 / tick_rate),
        }
        if material is not None and len(material) == surface.size:
            codes, counts = np.unique(material[group].astype(np.int64), return_counts=True)
            event["surface"] = material_name(int(codes[np.argmax(counts)]))
        out.append(event)

    out.sort(key=lambda e: e["duration_ms"], reverse=True)
    return out[:_EXCURSION_CAP]


def _surface_block(
    on_ticks: int,
    off_ticks: int,
    total_ticks: int,
    material_counts: dict[int, int],
    excursions: list[dict],
) -> dict:
    if total_ticks == 0:
        return {"measured": False, "reason": "no ticks carried a surface reading"}

    block: dict = {
        "measured": True,
        "on_track_pct": round(100.0 * on_ticks / total_ticks, 2),
        "off_track_pct": round(100.0 * off_ticks / total_ticks, 2),
        "ticks": total_ticks,
        "excursions": excursions,
        "excursion_count": len(excursions),
    }
    if not excursions:
        block["finding"] = "the sim never recorded the car off the racing surface"

    if material_counts:
        named: dict[str, int] = {}
        for code, count in material_counts.items():
            named[material_name(code)] = named.get(material_name(code), 0) + count
        total = sum(named.values())
        block["materials_pct"] = {
            name: round(100.0 * count / total, 2)
            for name, count in sorted(named.items(), key=lambda kv: -kv[1])
        }
        kerb = named.get("kerb", 0)
        block["kerb_pct"] = round(100.0 * kerb / total, 2)
        block["kerb_note"] = (
            "share of ticks with a kerb under the car — riding kerbs is a "
            "choice, not a fault, so this is reported and not judged"
        )
    return block
