"""Session-info YAML → metadata.

iRacing's embedded YAML occasionally contains values PyYAML chokes on
(unquoted strings with special characters), so every field also has a regex
fallback. Missing fields stay None — missing ≠ zero.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml


@dataclass
class YamlMeta:
    track_name: str | None = None
    track_length_km: float | None = None
    event_type: str | None = None
    car_name: str | None = None
    car_redline_rpm: float | None = None
    driver_car_idx: int | None = None
    # Where the circuit actually is. iRacing puts these in the same WeekendInfo
    # block the track name comes from, and this parser read that block and threw
    # them away — the pattern CLAUDE.md warns about for CORE_CHANNELS vs
    # RAW_CHANNEL_MAP, one step further along. They are what turns the track map
    # from a shape into a place: without them the stored map is metre offsets
    # about an origin nobody recorded, and nothing external can ever be aligned
    # to it. Kept because they are free and the file already carried them.
    track_latitude: float | None = None
    track_longitude: float | None = None
    track_altitude_m: float | None = None
    # Radians, iRacing's own field. Recorded, not yet used: the map is projected
    # from geographic Lat/Lon rather than a track-local frame, so nothing here
    # needs it today. It is stored rather than interpreted.
    track_north_offset_rad: float | None = None
    # SessionNum -> SessionType ('Practice'/'Qualify'/'Race'/'Testing'…)
    session_types: dict[int, str] = field(default_factory=dict)


def _rx(key: str, text: str) -> str | None:
    m = re.search(rf"^\s*{key}:\s*(.+?)\s*$", text, re.MULTILINE)
    return m.group(1) if m else None


def _to_float(val) -> float | None:
    if val is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(val))
    return float(m.group(0)) if m else None


def parse_yaml_meta(yaml_text: str) -> YamlMeta:
    meta = YamlMeta()
    data = None
    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError:
        data = None
    if not isinstance(data, dict):
        data = None

    if data is not None:
        weekend = data.get("WeekendInfo") or {}
        meta.track_name = weekend.get("TrackDisplayName")
        meta.track_length_km = _to_float(weekend.get("TrackLength"))
        meta.event_type = weekend.get("EventType")
        meta.track_latitude = _to_float(weekend.get("TrackLatitude"))
        meta.track_longitude = _to_float(weekend.get("TrackLongitude"))
        meta.track_altitude_m = _to_float(weekend.get("TrackAltitude"))
        meta.track_north_offset_rad = _to_float(weekend.get("TrackNorthOffset"))

        driver_info = data.get("DriverInfo") or {}
        meta.driver_car_idx = driver_info.get("DriverCarIdx")
        meta.car_redline_rpm = _to_float(driver_info.get("DriverCarRedLine"))
        for d in driver_info.get("Drivers") or []:
            if isinstance(d, dict) and d.get("CarIdx") == meta.driver_car_idx:
                meta.car_name = d.get("CarScreenName")
                break

        for s in (data.get("SessionInfo") or {}).get("Sessions") or []:
            if isinstance(s, dict) and s.get("SessionNum") is not None:
                meta.session_types[int(s["SessionNum"])] = s.get("SessionType")

    # Regex fallbacks for anything the YAML pass didn't fill.
    if meta.track_name is None:
        meta.track_name = _rx("TrackDisplayName", yaml_text)
    if meta.track_length_km is None:
        meta.track_length_km = _to_float(_rx("TrackLength", yaml_text))
    if meta.event_type is None:
        meta.event_type = _rx("EventType", yaml_text)
    if meta.track_latitude is None:
        meta.track_latitude = _to_float(_rx("TrackLatitude", yaml_text))
    if meta.track_longitude is None:
        meta.track_longitude = _to_float(_rx("TrackLongitude", yaml_text))
    if meta.track_altitude_m is None:
        meta.track_altitude_m = _to_float(_rx("TrackAltitude", yaml_text))
    if meta.track_north_offset_rad is None:
        meta.track_north_offset_rad = _to_float(_rx("TrackNorthOffset", yaml_text))
    if meta.car_redline_rpm is None:
        meta.car_redline_rpm = _to_float(_rx("DriverCarRedLine", yaml_text))
    if meta.driver_car_idx is None:
        idx = _to_float(_rx("DriverCarIdx", yaml_text))
        meta.driver_car_idx = int(idx) if idx is not None else None
    if meta.car_name is None:
        meta.car_name = _rx("CarScreenName", yaml_text)
    if not meta.session_types:
        nums = re.findall(r"^\s*SessionNum:\s*(\d+)", yaml_text, re.MULTILINE)
        types = re.findall(r"^\s*SessionType:\s*(.+?)\s*$", yaml_text, re.MULTILINE)
        meta.session_types = {int(n): t for n, t in zip(nums, types)}

    return meta
