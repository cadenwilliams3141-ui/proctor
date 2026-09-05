"""Track map (module 2): draw the circuit from the reference lap's native GPS.

Observes the geographic path the car actually traced — no reconstruction from
speed/heading, just the recorded Lat/Lon projected to local meters so a UI can
plot it and colour it by any grid-aligned channel. Purely descriptive geometry.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedSession

METRIC_KEY = "track_map"

# Degrees of latitude per metre is ~constant; longitude shrinks by cos(lat).
_M_PER_DEG = 111320.0

# A lap is mappable only if its GPS actually moves — a constant/absent Lat/Lon
# would collapse to a single point, which is not a track.
_MIN_SPAN_DEG = 1e-6


def _mappable(lap) -> bool:
    lat = lap.grid.get("lat_gps")
    lon = lap.grid.get("lon_gps")
    if lat is None or lon is None:
        return False
    if not (np.isfinite(lat).all() and np.isfinite(lon).all()):
        return False
    span = max(float(lat.max() - lat.min()), float(lon.max() - lon.min()))
    return span > _MIN_SPAN_DEG


def _gps_span(lap) -> float:
    lat, lon = lap.grid["lat_gps"], lap.grid["lon_gps"]
    return float(lat.max() - lat.min()) + float(lon.max() - lon.min())


def compute(session: ParsedSession) -> dict:
    mappable = [lap for lap in session.laps if _mappable(lap)]
    if not mappable:
        return {
            "insufficient_data": True,
            "reason": "no lap in this session carries usable GPS position data",
            "basis": "self-comparison within this session",
        }

    # Reference lap = fastest valid non-anomalous (contract rule 4), then
    # fastest valid, then — rather than refuse — any lap with a real GPS path,
    # flagged in a caveat: a map is still drawable from an out lap.
    clean = [lap for lap in mappable if lap.is_valid and not lap.is_anomalous]
    valid = [lap for lap in mappable if lap.is_valid]
    caveat: str | None = None
    if clean:
        ref = min(clean, key=lambda l: l.lap_time_s)
    elif valid:
        ref = min(valid, key=lambda l: l.lap_time_s)
        caveat = "no clean laps this session; map drawn from the fastest valid lap"
    else:
        ref = max(mappable, key=_gps_span)
        caveat = (
            f"no valid laps this session; map drawn from lap {ref.lap_number}, "
            "an out/in/partial lap — geometry only, not a representative line"
        )

    lat = ref.grid["lat_gps"].astype(np.float64)
    lon = ref.grid["lon_gps"].astype(np.float64)
    lat_mean = float(np.mean(lat))
    lon_mean = float(np.mean(lon))

    # Local equirectangular projection about the lap centroid. Exact enough
    # over a single circuit; keeps x and y in metres and centred on 0.
    x = (lon - lon_mean) * _M_PER_DEG * np.cos(np.radians(lat_mean))
    y = (lat - lat_mean) * _M_PER_DEG

    payload = {
        "basis": "reference lap = fastest valid non-anomalous lap (self-comparison within this session)",
        "source_lap": int(ref.lap_number),
        "projection": "local_equirectangular_meters",
        # THE ANCHOR THE PROJECTION IS ABOUT. It was computed here and then
        # discarded, which left the stored map as metre offsets around an origin
        # nobody recorded: a shape, not a place. Two consequences, both real.
        # Nothing external can ever be aligned to the map without re-ingesting
        # every session; and the map cannot be checked against the circuit's own
        # published position, which the file states independently in
        # WeekendInfo. Three extra numbers, and the inverse is exact:
        #   lon = origin_lon + x_m / (111320 * cos(radians(origin_lat)))
        #   lat = origin_lat + y_m / 111320
        "origin_lat": round(lat_mean, 8),
        "origin_lon": round(lon_mean, 8),
        "meters_per_degree": _M_PER_DEG,
        "x_m": [round(float(v), 2) for v in x],
        "y_m": [round(float(v), 2) for v in y],
        "grid_pct": [round(float(v), 4) for v in ref.grid["grid_pct"]],
        "note": "color by any lap_traces channel via index alignment",
    }
    if caveat is not None:
        payload["caveat"] = caveat
    return payload
