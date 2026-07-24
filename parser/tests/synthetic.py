"""Builds tiny in-memory .ibt files so structural tests need no real telemetry."""

from __future__ import annotations

import struct

import numpy as np

from proctor_parser.ibt import CORE_CHANNELS, VAR_TYPE_DTYPES

DEFAULT_YAML = """---
WeekendInfo:
 TrackDisplayName: Testland
 TrackLength: 4.00 km
 EventType: Test
DriverInfo:
 DriverCarIdx: 0
 DriverCarRedLine: 9000.000
 Drivers:
 - CarIdx: 0
   CarScreenName: Test Car GT3
SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionType: Testing
 - SessionNum: 1
   SessionType: Race
...
"""

INT_CHANNELS = {"Lap", "Gear", "SessionNum", "PlayerCarMyIncidentCount", "PlayerCarIdx"}
BOOL_CHANNELS = {"OnPitRoad", "BrakeABSactive"}


def build_ibt(
    channels: dict[str, np.ndarray],
    tick_rate: int = 60,
    yaml_text: str = DEFAULT_YAML,
    channel_order: list[str] | None = None,
) -> bytes:
    """Assemble valid .ibt bytes from name -> samples arrays (equal lengths)."""
    names = channel_order or list(channels)
    nrec = len(next(iter(channels.values())))

    # Assign var types and sequential offsets in the given order.
    entries = []
    offset = 0
    for name in names:
        if name in INT_CHANNELS:
            vtype = 2
        elif name in BOOL_CHANNELS:
            vtype = 1
        else:
            vtype = 4
        width = VAR_TYPE_DTYPES[vtype].itemsize
        entries.append((name, vtype, offset, width))
        offset += width
    buf_len = offset

    var_header_offset = 112
    yaml_bytes = yaml_text.encode("latin-1")
    yaml_offset = var_header_offset + len(names) * 144
    data_offset = yaml_offset + len(yaml_bytes)

    header = struct.pack(
        "<10i", 2, 1, tick_rate, 0, len(yaml_bytes), yaml_offset,
        len(names), var_header_offset, 1, buf_len,
    )
    var_buf = struct.pack("<4i", nrec, data_offset, 0, 0) + b"\x00" * 48

    var_headers = b""
    for name, vtype, off, _w in entries:
        var_headers += struct.pack("<3i", vtype, off, 1) + b"\x00" * 4
        var_headers += name.encode()[:32].ljust(32, b"\x00")
        var_headers += b"\x00" * 64  # description
        var_headers += b"\x00" * 32  # unit

    samples = np.zeros((nrec, buf_len), dtype=np.uint8)
    for name, vtype, off, width in entries:
        dtype = VAR_TYPE_DTYPES[vtype]
        col = np.ascontiguousarray(np.asarray(channels[name]).astype(dtype))
        samples[:, off:off + width] = col.view(np.uint8).reshape(nrec, width)

    return header + b"\x00" * 8 + var_buf + var_headers + yaml_bytes + samples.tobytes()


def make_core_channels(
    n_laps: int = 7,
    ticks_per_lap: int = 720,
    slow_lap: int | None = 3,
    incident_lap: int | None = 5,
    wear_varies: bool = False,
    session_break_at_lap: int | None = None,
) -> dict[str, np.ndarray]:
    """All 42 core channels for a synthetic session.

    Lap 0 is an out lap (on pit road, starts stationary with the sim's
    forced Brake=1/BrakeRaw=0). The final lap is partial by construction.
    """
    n = n_laps * ticks_per_lap
    t = np.arange(n)
    lap = t // ticks_per_lap
    in_lap = t % ticks_per_lap

    speed = np.full(n, 50.0)
    if slow_lap is not None:
        speed[lap == slow_lap] = 30.0
    stationary = (lap == 0) & (in_lap < 10)
    speed[stationary] = 0.0

    brake = np.where(in_lap < 20, 0.8, 0.0)
    brake_raw = brake.copy()
    # Stationary auto-brake: sim forces Brake=1.0 while BrakeRaw stays 0.
    brake[stationary] = 1.0
    brake_raw[stationary] = 0.0

    incidents = np.zeros(n)
    if incident_lap is not None:
        # Step mid-lap so the incident lands inside incident_lap's tick range.
        mid = ticks_per_lap // 2
        incidents[(lap > incident_lap) | ((lap == incident_lap) & (in_lap >= mid))] = 4.0

    session_num = np.zeros(n)
    if session_break_at_lap is not None:
        session_num[lap >= session_break_at_lap] = 1.0

    dist = in_lap / ticks_per_lap
    ch: dict[str, np.ndarray] = {
        "Lap": lap.astype(float),
        "LapDistPct": dist,
        "Speed": speed,
        "Throttle": np.where(brake > 0, 0.0, 1.0),
        "Brake": brake,
        "BrakeRaw": brake_raw,
        "SteeringWheelAngle": np.sin(dist * 2 * np.pi) * 0.5,
        "Gear": np.full(n, 4.0),
        "RPM": np.full(n, 7000.0),
        "LatAccel": np.sin(dist * 2 * np.pi) * 15.0,
        "LongAccel": np.where(brake > 0, -20.0, 5.0),
        "VertAccel": np.full(n, -9.8),
        "YawRate": np.zeros(n),
        "Yaw": np.zeros(n),
        "Lat": 33.0 + dist * 0.01,
        "Lon": -84.0 + dist * 0.01,
        "Alt": np.full(n, 300.0),
        "VelocityX": speed,
        "VelocityY": np.zeros(n),
        "FuelLevel": np.linspace(60.0, 40.0, n),
        "LFspeed": speed,
        "RFspeed": speed,
        "LRspeed": speed,
        "RRspeed": speed,
        "BrakeABSactive": np.zeros(n),
        "BrakeABScutPct": np.zeros(n),
        "dcBrakeBias": np.full(n, 52.0),
        "ShiftIndicatorPct": np.zeros(n),
        "ShiftGrindRPM": np.zeros(n),
        "SteeringWheelPctTorque": np.full(n, 0.4),
        "SteeringWheelPctTorqueSignStops": np.full(n, 0.4),
        "SteeringWheelTorque": np.full(n, 5.0),
        "LFtempL": np.full(n, 80.0),
        "LFtempM": np.full(n, 85.0),
        "LFtempR": np.full(n, 90.0),
        "LFwearM": np.linspace(1.0, 0.95, n) if wear_varies else np.full(n, 1.0),
        "RRwearM": np.linspace(1.0, 0.96, n) if wear_varies else np.full(n, 1.0),
        "FrameRate": np.full(n, 120.0),
        "PlayerCarMyIncidentCount": incidents,
        "SessionNum": session_num,
        "OnPitRoad": (lap == 0).astype(float),
        "PlayerCarIdx": np.zeros(n),
    }
    assert set(ch) == set(CORE_CHANNELS)
    return ch
