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
    # Heading and velocity in the car's own frame. These are core channels
    # (every file is rejected without them) that v1 validated and then threw
    # away. vel_x/vel_y are what make chassis slip angle a MEASUREMENT --
    # atan2(vel_y, vel_x) is the angle between where the car points and where
    # it is actually going -- rather than something fitted from a model.
    "yaw": "Yaw",
    "vel_x": "VelocityX",
    "vel_y": "VelocityY",
    "lat_gps": "Lat",
    "lon_gps": "Lon",
    # Elevation, for the road grade under the car. LongAccel carries the
    # component of gravity along a slope, so braking g at an elevation-changing
    # circuit is wrong by g*sin(theta) until this is subtracted.
    "alt": "Alt",
    "lf_speed": "LFspeed",
    "rf_speed": "RFspeed",
    "lr_speed": "LRspeed",
    "rr_speed": "RRspeed",
    "abs_active": "BrakeABSactive",
    "abs_cut": "BrakeABScutPct",
    "ffb_stops": "SteeringWheelPctTorqueSignStops",
    "ffb_pct": "SteeringWheelPctTorque",
    # Absolute self-aligning torque at the column, in Nm. ffb_pct is the same
    # force normalised to the rig's own range and so cannot be compared across
    # sessions or settings; this one can, and it is the physical quantity the
    # front tires actually send back to the driver's hands.
    "steer_torque": "SteeringWheelTorque",
    "fuel": "FuelLevel",
    "lf_temp_l": "LFtempL",
    "lf_temp_m": "LFtempM",
    "lf_temp_r": "LFtempR",
    "brake_bias": "dcBrakeBias",
    "frame_rate": "FrameRate",
    # The driver's running incident count. Core (every file has it) and used
    # for the per-lap incident_delta, but until the coach needed to know WHICH
    # corner an incident happened in, it never reached the modules.
    "incidents": "PlayerCarMyIncidentCount",
}

# Raw keys that also get resampled onto the fixed distance grid (5.4).
GRID_CHANNELS = (
    "speed", "throttle", "brake", "brake_raw", "steer", "gear", "rpm",
    "lat_accel", "long_accel", "lat_gps", "lon_gps", "abs_active",
)

# Channels that are read WHEN PRESENT and simply absent when not.
#
# These are deliberately not in CORE_CHANNELS. A core channel missing fails the
# whole file with MissingChannelsError, which is right for Speed and wrong for
# these: they have been in iRacing telemetry for years, but a file recorded by
# an older build, or a future one that renames them, should still parse into
# every other module rather than being rejected outright.
#
# A module that wants one checks `if "track_surface" in lap.raw` and reports
# itself unavailable otherwise. Absent stays absent — it never becomes a zero,
# which for `track_surface` would read as OffTrack for the entire session.
OPTIONAL_CHANNEL_MAP = {
    # irsdk_TrkLoc: -1 NotInWorld, 0 OffTrack, 1 InPitStall, 2 AproachingPits,
    # 3 OnTrack. The sim's own answer to "was the car on the racing surface",
    # which is the one thing a .ibt can say about where the track ENDS.
    "track_surface": "PlayerTrackSurface",
    # irsdk_TrkSurf: 1-4 asphalt, 5-6 concrete, 9-10 paint, 11-14 rumble
    # (kerbs), 15-18 grass, 19-22 dirt, 23 sand, 24-25 gravel, and so on.
    "track_surface_material": "PlayerTrackSurfaceMaterial",
    # The clock and the tape measure. Read when present, never required.
    #
    # SessionTime is the sim's own clock in seconds. Tick index / tick_rate is
    # the fallback and is exact only if no tick was ever dropped; SessionTime
    # is exact either way. LapDist is distance round the lap in METRES, which
    # pins the track's true length more precisely than the YAML's two decimals.
    # LapLastLapTime is the sim's official time for the lap just completed,
    # used only to cross-check the parser's own lap times — never to replace
    # them.
    "session_time": "SessionTime",
    "dist_m": "LapDist",
    "lap_last_time": "LapLastLapTime",
}

# How far either side of a Lap-counter change to look for the LapDistPct wrap.
# The two usually change on the same tick; the search tolerates them disagreeing.
_CROSSING_SEARCH_TICKS = 10
# LapLastLapTime is read this long after the crossing, by which point the sim
# has published the completed lap's time.
_LAST_LAP_READ_DELAY_S = 2.0


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
    # When the car crossed the start/finish line, in seconds relative to this
    # lap's FIRST TICK, interpolated between the two ticks either side of the
    # LapDistPct wrap. Negative when the line was crossed just before the Lap
    # counter changed. None when the lap has no such crossing (an out lap that
    # starts in the pit box, a partial final lap). See proctor_parser.timing.
    start_crossing_s: float | None = None
    end_crossing_s: float | None = None
    # The sim's own LapLastLapTime for this lap, read just after it ended.
    # A cross-check only; lap_time_s keeps its tick-count definition.
    sim_lap_time_s: float | None = None

    @property
    def lap_time_exact_s(self) -> float | None:
        """Crossing-to-crossing time, finer than the 1/tick_rate steps of
        lap_time_s. None unless both crossings were found."""
        if self.start_crossing_s is None or self.end_crossing_s is None:
            return None
        return self.end_crossing_s - self.start_crossing_s


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
    # Present-or-absent, never substituted. See OPTIONAL_CHANNEL_MAP.
    for key, ch in OPTIONAL_CHANNEL_MAP.items():
        if ibt.has_channel(ch):
            raw_full[key] = ibt.channel(ch)
    lap_ch = ibt.channel("Lap").astype(np.int64)
    session_num_ch = ibt.channel("SessionNum").astype(np.int64)
    on_pit = ibt.channel("OnPitRoad").astype(bool)
    incidents = ibt.channel("PlayerCarMyIncidentCount").astype(np.int64)
    lf_wear = ibt.channel("LFwearM").astype(np.float64)

    # Tire wear frozen for the whole file (official races): detect, record,
    # don't fight it. Modules skip wear analysis when true.
    wear_masked = bool(np.nanstd(lf_wear) == 0.0)

    tick_rate = ibt.header.tick_rate
    clock = _tick_clock(raw_full.get("session_time"), len(lap_ch), tick_rate)
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

            start_x = _crossing_time(raw_full["dist"], clock, a, s_start, s_end)
            end_x = (
                None if is_partial
                else _crossing_time(raw_full["dist"], clock, b, s_start, s_end)
            )
            sim_lap = None
            if "lap_last_time" in raw_full and not is_partial and tick_rate:
                k = b + int(round(_LAST_LAP_READ_DELAY_S * tick_rate))
                if k < s_end:
                    v = float(raw_full["lap_last_time"][k])
                    sim_lap = v if np.isfinite(v) and v > 0 else None

            parsed_laps.append(ParsedLap(
                lap_number=lap_number,
                lap_time_s=lap_time_s,
                is_valid=is_valid,
                is_out_lap=is_out_lap,
                incident_delta=incident_delta,
                is_anomalous=incident_delta > 0,  # profile pass may add more below
                raw=raw,
                grid=grid,
                start_crossing_s=None if start_x is None else start_x - float(clock[a]),
                end_crossing_s=None if end_x is None else end_x - float(clock[a]),
                sim_lap_time_s=sim_lap,
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


def _tick_clock(session_time: np.ndarray | None, n: int, tick_rate: int) -> np.ndarray:
    """Seconds at every tick of the file.

    SessionTime when it is present and behaves like a clock (finite, strictly
    increasing, steps near 1/tick_rate); otherwise tick index / tick_rate.
    """
    rate = float(tick_rate or 60)
    fallback = np.arange(n, dtype=np.float64) / rate
    if session_time is None or len(session_time) != n or n < 2:
        return fallback
    st = np.asarray(session_time, dtype=np.float64)
    if not np.all(np.isfinite(st)):
        return fallback
    steps = np.diff(st)
    # Session boundaries can reset SessionTime; a clock that ever runs
    # backwards or stalls is not trusted for interpolation.
    if np.any(steps <= 0):
        return fallback
    if abs(float(np.median(steps)) * rate - 1.0) > 0.05:
        return fallback
    return st


def _crossing_time(
    dist: np.ndarray, clock: np.ndarray, near: int, s_start: int, s_end: int
) -> float | None:
    """Clock time at which LapDistPct wrapped from ~1 to ~0 nearest tick `near`.

    Linear interpolation between the two ticks either side of the wrap: the
    car covered (1 - d_before) + d_after of the lap in one tick, and the line
    sits (1 - d_before) of the way along it.
    """
    lo = max(s_start + 1, near - _CROSSING_SEARCH_TICKS)
    hi = min(s_end - 1, near + _CROSSING_SEARCH_TICKS)
    if hi < lo:
        return None
    d = np.asarray(dist[lo - 1:hi + 1], dtype=np.float64)
    jumps = np.flatnonzero(np.diff(d) < -0.5)
    if jumps.size == 0:
        return None
    ks = jumps + lo  # index of the first tick after each wrap
    k = int(ks[np.argmin(np.abs(ks - near))])
    before, after = float(dist[k - 1]), float(dist[k])
    span = (1.0 - before) + after
    if not np.isfinite(span) or span <= 0:
        return None
    frac = min(1.0, max(0.0, (1.0 - before) / span))
    return float(clock[k - 1] + frac * (clock[k] - clock[k - 1]))
