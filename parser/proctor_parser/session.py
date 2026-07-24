"""Parser output contract: bytes in → ParsedSession list out.

This is the hub. Pure function: no DB, no HTTP. The Render service calls
parse_ibt() and handles persistence. Analysis modules receive these objects
and must not reach back into the binary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np

from proctor_parser.ibt import IbtFile
from proctor_parser.laps import (
    GRID_POINTS,
    anomalous_by_profile,
    contiguous_runs,
    resample_to_grid,
)
from proctor_parser.meta import parse_yaml_meta

# Contract key -> .ibt channel name for the per-tick raw arrays (5.4).
RAW_CHANNEL_MAP = {
    "dist": "LapDistPct",
    "speed": "Speed",
    "throttle": "Throttle",
    "brake": "Brake",
    "brake_raw": "BrakeRaw",
    "steer": "SteeringWheelAngle",
    "gear": "Gear",
    "rpm": "RPM",
    "lat_accel": "LatAccel",
    "long_accel": "LongAccel",
    "vert_accel": "VertAccel",
    "yaw_rate": "YawRate",
    "lat_gps": "Lat",
    "lon_gps": "Lon",
    "lf_speed": "LFspeed",
    "rf_speed": "RFspeed",
    "lr_speed": "LRspeed",
    "rr_speed": "RRspeed",
    "abs_active": "BrakeABSactive",
    "abs_cut": "BrakeABScutPct",
    "ffb_stops": "SteeringWheelPctTorqueSignStops",
    "ffb_pct": "SteeringWheelPctTorque",
    "fuel": "FuelLevel",
    "lf_temp_l": "LFtempL",
    "lf_temp_m": "LFtempM",
    "lf_temp_r": "LFtempR",
    "brake_bias": "dcBrakeBias",
    "frame_rate": "FrameRate",
}

# Raw keys that also get resampled onto the fixed distance grid (5.4).
GRID_CHANNELS = (
    "speed", "throttle", "brake", "brake_raw", "steer", "gear", "rpm",
    "lat_accel", "long_accel", "lat_gps", "lon_gps", "abs_active",
)


class MissingChannelsError(ValueError):
    """Core channels absent from the file. Missing ≠ zero: fail loudly."""

    def __init__(self, missing: list[str]):
        self.missing = missing
        super().__init__(f"core channels missing from file: {missing}")


@dataclass
class SessionMeta:
    track_name: str | None
    car_name: str | None
    session_type: str | None
    session_num: int
    track_length_km: float | None
    car_redline_rpm: float | None
    tick_rate: int
    recorded_at: datetime | None
    wear_masked: bool


@dataclass
class ParsedLap:
    lap_number: int
    lap_time_s: float | None
    is_valid: bool
    is_out_lap: bool
    incident_delta: int
    is_anomalous: bool
    raw: dict[str, np.ndarray]   # per-tick arrays, all equal length
    grid: dict[str, np.ndarray]  # fixed GRID_POINTS-length arrays


@dataclass
class ParsedSession:
    meta: SessionMeta
    laps: list[ParsedLap]


def parse_ibt(data: bytes | IbtFile, recorded_at: datetime | None = None) -> list[ParsedSession]:
    """Parse an .ibt file into one ParsedSession per SessionNum run.

    Raises MissingChannelsError if any of the 42 core channels is absent,
    IbtFormatError if the binary layout is invalid.
    """
    ibt = data if isinstance(data, IbtFile) else IbtFile(data)

    missing = ibt.missing_core_channels()
    if missing:
        raise MissingChannelsError(missing)

    ymeta = parse_yaml_meta(ibt.session_yaml())

    raw_full = {key: ibt.channel(ch) for key, ch in RAW_CHANNEL_MAP.items()}
    lap_ch = ibt.channel("Lap").astype(np.int64)
    session_num_ch = ibt.channel("SessionNum").astype(np.int64)
    on_pit = ibt.channel("OnPitRoad").astype(bool)
    incidents = ibt.channel("PlayerCarMyIncidentCount").astype(np.int64)
    lf_wear = ibt.channel("LFwearM").astype(np.float64)

    # Tire wear frozen for the whole file (official races): detect, record,
    # don't fight it. Modules skip wear analysis when true.
    wear_masked = bool(np.nanstd(lf_wear) == 0.0)

    tick_rate = ibt.header.tick_rate
    sessions: list[ParsedSession] = []

    for session_num, s_start, s_end in contiguous_runs(session_num_ch):
        lap_runs = contiguous_runs(lap_ch[s_start:s_end])
        parsed_laps: list[ParsedLap] = []
        # iRacing's lap counter repeats after resets/tows (0,1,2,0,1,…).
        # lap_number must be unique per session — for modules keying dicts by
        # it and for the DB constraint — so reused numbers are remapped to
        # max_used+1, preserving chronological order.
        used_numbers: set[int] = set()

        for run_idx, (lap_number, l_start, l_end) in enumerate(lap_runs):
            if lap_number in used_numbers:
                lap_number = max(used_numbers) + 1
            used_numbers.add(lap_number)
            a, b = s_start + l_start, s_start + l_end
            n_ticks = b - a

            is_first = run_idx == 0
            is_last = run_idx == len(lap_runs) - 1
            touches_pit = bool(on_pit[a:b].any())
            is_out_lap = is_first or touches_pit
            # Final run has no closing lap-increment, so it is partial.
            is_partial = is_last

            # A valid lap must actually cover the track and last a plausible
            # time — real files contain 1-tick lap runs from resets/tows.
            dist_slice = raw_full["dist"][a:b]
            covers_track = bool(
                float(dist_slice.min()) < 0.05 and float(dist_slice.max()) > 0.95
            )
            plausible_duration = n_ticks >= tick_rate * 10
            is_valid = (
                not (is_out_lap or is_partial)
                and covers_track
                and plausible_duration
            )

            # Partial laps have no closing boundary, so no honest time exists.
            lap_time_s = None if (is_partial or not tick_rate) else n_ticks / tick_rate
            incident_delta = int(incidents[b - 1] - incidents[a])

            raw = {key: arr[a:b] for key, arr in raw_full.items()}
            grid = resample_to_grid(
                raw["dist"],
                {key: raw[key].astype(np.float64) for key in GRID_CHANNELS},
            )

            parsed_laps.append(ParsedLap(
                lap_number=lap_number,
                lap_time_s=lap_time_s,
                is_valid=is_valid,
                is_out_lap=is_out_lap,
                incident_delta=incident_delta,
                is_anomalous=incident_delta > 0,  # profile pass may add more below
                raw=raw,
                grid=grid,
            ))

        profile_flagged = anomalous_by_profile({
            lap.lap_number: lap.grid["speed"] for lap in parsed_laps if lap.is_valid
        })
        for lap in parsed_laps:
            if lap.lap_number in profile_flagged:
                lap.is_anomalous = True

        sessions.append(ParsedSession(
            meta=SessionMeta(
                track_name=ymeta.track_name,
                car_name=ymeta.car_name,
                session_type=ymeta.session_types.get(session_num) or ymeta.event_type,
                session_num=session_num,
                track_length_km=ymeta.track_length_km,
                car_redline_rpm=ymeta.car_redline_rpm,
                tick_rate=tick_rate,
                recorded_at=recorded_at,
                wear_masked=wear_masked,
            ),
            laps=parsed_laps,
        ))

    return sessions
