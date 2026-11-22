"""Full-rate lap storage: every tick of a lap, every channel the analysis reads.

The 1000-point distance grid is enough to draw a lap and too coarse to study
one (about 4 m a point, no time axis). This keeps the lap as recorded — 60 Hz,
~35 channels — compactly enough to store every lap of every session:

    per channel:  quantise to a fixed step (the channel's own resolution)
                  -> first value as int32, then tick-to-tick deltas as int16
                     (int32 when a jump would not fit, flagged per channel)
                  -> split the delta bytes into planes (all low bytes, then all
                     high bytes), which is what lets zlib find the structure
    all channels: concatenated, zlib level 6

The quantisation step is at or below each channel's own recorded precision, so
nothing a screen can show is lost. The format is versioned (`codec`) and the
header carries everything needed to decode it, so the web decoder never has to
know the channel list in advance. zlib output is exactly what the browser's
DecompressionStream("deflate") reads.

Two channels are synthesised, both from proctor_parser.timing: `t` (seconds
since the lap's start/finish crossing) and `d` (metres from the line), so a
reader can put any channel on a time OR a distance axis without re-deriving
either.
"""

from __future__ import annotations

import json
import struct
import zlib

import numpy as np

from proctor_parser.session import ParsedLap
from proctor_parser.timing import LapClock

CODEC = 1

# key -> quantisation step, in the channel's own unit. Order is the stored order.
SCALES: dict[str, float] = {
    "t": 1e-4, "d": 1e-2, "dist": 1e-7,
    "speed": 1e-2, "throttle": 1e-4, "brake": 1e-4, "brake_raw": 1e-4,
    "steer": 1e-4, "gear": 1.0, "rpm": 1.0,
    "lat_accel": 1e-2, "long_accel": 1e-2, "vert_accel": 1e-2,
    "yaw_rate": 1e-4, "yaw": 1e-4, "vel_x": 1e-2, "vel_y": 1e-2,
    "lat_gps": 1e-7, "lon_gps": 1e-7, "alt": 1e-2,
    "lf_speed": 1e-2, "rf_speed": 1e-2, "lr_speed": 1e-2, "rr_speed": 1e-2,
    "abs_active": 1.0, "abs_cut": 1e-1, "ffb_stops": 1e-3, "ffb_pct": 1e-3,
    "steer_torque": 1e-2, "fuel": 1e-3, "lf_temp_l": 1e-1, "lf_temp_m": 1e-1,
    "lf_temp_r": 1e-1, "brake_bias": 1e-2, "incidents": 1.0,
    "track_surface": 1.0, "track_surface_material": 1.0,
}
# Unwrapped before storage so the deltas stay small (heading wraps at +-pi).
UNWRAP = {"yaw"}


def _planes(a: np.ndarray, width: int) -> bytes:
    """Little-endian ints as byte planes: every value's byte 0, then byte 1, ..."""
    raw = a.astype(f"<i{width}").view(np.uint8).reshape(-1, width)
    return b"".join(raw[:, k].tobytes() for k in range(width))


def _unplanes(buf: bytes, count: int, width: int) -> np.ndarray:
    b = np.frombuffer(buf, dtype=np.uint8, count=count * width).reshape(width, count)
    return np.ascontiguousarray(b.T).view(f"<i{width}").reshape(count)


def encode_lap(lap: ParsedLap, clock: LapClock, tick_rate: int) -> tuple[dict, bytes]:
    """(header, compressed bytes) for one lap. Every tick, in order."""
    n = len(lap.raw["dist"])
    cols: dict[str, np.ndarray] = {"t": clock.tick_t_s, "d": clock.tick_d_m}
    for key in SCALES:
        if key in ("t", "d"):
            continue
        if key in lap.raw and len(lap.raw[key]) == n:
            v = np.asarray(lap.raw[key], dtype=np.float64)
            cols[key] = np.unwrap(v) if key in UNWRAP and np.all(np.isfinite(v)) else v

    chans, blocks, nan = [], [], {}
    for key, v in cols.items():
        step = SCALES[key]
        v = np.asarray(v, dtype=np.float64)
        bad = ~np.isfinite(v)
        if bad.any():
            # Missing ticks are carried forward for the byte stream and listed
            # by index in the header, so a reader can put them back as gaps.
            nan[key] = np.flatnonzero(bad).tolist()[:5000]
            good = np.where(~bad, np.arange(n), 0)
            np.maximum.accumulate(good, out=good)
            v = np.where(bad, v[good], v)
            v = np.nan_to_num(v, nan=0.0)
        q = np.round(v / step).astype(np.int64)
        first = int(q[0]) if n else 0
        deltas = np.diff(q)
        width = 2 if deltas.size == 0 or (deltas.min() >= -32768 and deltas.max() <= 32767) else 4
        if abs(first) > 2**31 - 1:
            raise ValueError(f"{key}: first value out of int32 range at step {step}")
        blocks.append(struct.pack("<i", first) + _planes(deltas, width))
        chans.append({"k": key, "scale": step, "w": width})

    header = {
        "codec": CODEC,
        "rate": int(tick_rate),
        "n": int(n),
        "lap": int(lap.lap_number),
        "length_m": round(float(clock.length_m), 3),
        "start_crossing_s": lap.start_crossing_s,
        "end_crossing_s": lap.end_crossing_s,
        "ch": chans,
        "nan": nan,
    }
    return header, zlib.compress(b"".join(blocks), 6)


def decode_lap(header: dict, data: bytes) -> dict[str, np.ndarray]:
    """The inverse of encode_lap: channel -> float64 array (NaN where missing)."""
    if header.get("codec") != CODEC:
        raise ValueError(f"unknown codec {header.get('codec')}")
    n = int(header["n"])
    raw = zlib.decompress(data)
    out: dict[str, np.ndarray] = {}
    pos = 0
    for c in header["ch"]:
        first = struct.unpack_from("<i", raw, pos)[0]
        pos += 4
        width = int(c["w"])
        count = max(n - 1, 0)
        deltas = _unplanes(raw[pos:pos + count * width], count, width) if count else np.empty(0, np.int64)
        pos += count * width
        q = np.concatenate(([first], first + np.cumsum(deltas.astype(np.int64))))[:n]
        v = q.astype(np.float64) * float(c["scale"])
        for i in header.get("nan", {}).get(c["k"], []):
            v[i] = np.nan
        out[c["k"]] = v
    return out


def header_json(header: dict) -> str:
    return json.dumps(header, separators=(",", ":"))
