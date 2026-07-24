"""Low-level iRacing .ibt binary reader.

Format (verified against Long Beach, Mugello, Road Atlanta):
- Main header: first 40 bytes, ten little-endian int32s.
- varBuf array at byte offset 48: four entries x four int32s
  (tickCount, bufOffset, pad, pad); the first entry's bufOffset is the start
  of sample data.
- Record count is computed from file size — disk sub-header counts are not
  trustworthy.
- Session YAML: sessionInfoLen bytes at sessionInfoOffset, latin-1.
- Var headers: numVars x 144 bytes at varHeaderOffset.

Channels are always looked up by name, never fixed offset: offsets differ
between cars (the dc* channels vary).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

VAR_TYPE_DTYPES = {
    0: np.dtype("S1"),   # char, 1 byte
    1: np.dtype("?"),    # bool, 1 byte
    2: np.dtype("<i4"),  # int32
    3: np.dtype("<u4"),  # bitfield
    4: np.dtype("<f4"),  # float32
    5: np.dtype("<f8"),  # float64
}

# The 42 core channels every downstream module may rely on.
CORE_CHANNELS = (
    "Lap", "LapDistPct", "Speed", "Throttle", "Brake", "BrakeRaw",
    "SteeringWheelAngle", "Gear", "RPM", "LatAccel", "LongAccel", "VertAccel",
    "YawRate", "Yaw", "Lat", "Lon", "Alt", "VelocityX", "VelocityY",
    "FuelLevel", "LFspeed", "RFspeed", "LRspeed", "RRspeed", "BrakeABSactive",
    "BrakeABScutPct", "dcBrakeBias", "ShiftIndicatorPct", "ShiftGrindRPM",
    "SteeringWheelPctTorque", "SteeringWheelPctTorqueSignStops",
    "SteeringWheelTorque", "LFtempL", "LFtempM", "LFtempR", "LFwearM",
    "RRwearM", "FrameRate", "PlayerCarMyIncidentCount", "SessionNum",
    "OnPitRoad", "PlayerCarIdx",
)


class IbtFormatError(ValueError):
    """Raised when a file does not look like a valid .ibt."""


@dataclass(frozen=True)
class IbtHeader:
    ver: int
    status: int
    tick_rate: int
    session_info_update: int
    session_info_len: int
    session_info_offset: int
    num_vars: int
    var_header_offset: int
    num_buf: int
    buf_len: int


@dataclass(frozen=True)
class VarHeader:
    type: int
    offset: int
    count: int
    name: str
    description: str
    unit: str


def _cstr(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("latin-1")


class IbtFile:
    """Memory-loaded .ibt file with by-name vectorized channel access."""

    def __init__(self, data: bytes, source: str = "<bytes>"):
        self.source = source
        if len(data) < 112:
            raise IbtFormatError(f"{source}: too small to hold an .ibt header")
        self._data = data
        self.header = IbtHeader(*struct.unpack_from("<10i", data, 0))
        h = self.header
        if h.num_vars <= 0 or h.buf_len <= 0 or h.var_header_offset <= 0:
            raise IbtFormatError(f"{source}: implausible header {h}")

        # First varBuf entry at byte 48: (tickCount, bufOffset, pad, pad).
        _, self.buf_offset, _, _ = struct.unpack_from("<4i", data, 48)
        if not (0 < self.buf_offset <= len(data)):
            raise IbtFormatError(f"{source}: bad sample bufOffset {self.buf_offset}")

        self.record_count = (len(data) - self.buf_offset) // h.buf_len
        if self.record_count <= 0:
            raise IbtFormatError(f"{source}: no complete sample records")

        if h.var_header_offset + h.num_vars * 144 > len(data):
            raise IbtFormatError(f"{source}: var header table extends past EOF")
        self.var_headers = self._read_var_headers()
        self.channels: dict[str, VarHeader] = {v.name: v for v in self.var_headers}

        self._samples = np.frombuffer(
            data,
            dtype=np.uint8,
            count=self.record_count * h.buf_len,
            offset=self.buf_offset,
        ).reshape(self.record_count, h.buf_len)

    @classmethod
    def from_path(cls, path: str | Path) -> "IbtFile":
        p = Path(path)
        return cls(p.read_bytes(), source=p.name)

    def _read_var_headers(self) -> list[VarHeader]:
        out = []
        base = self.header.var_header_offset
        for i in range(self.header.num_vars):
            o = base + i * 144
            vtype, offset, count = struct.unpack_from("<3i", self._data, o)
            out.append(VarHeader(
                type=vtype,
                offset=offset,
                count=count,
                name=_cstr(self._data[o + 16:o + 48]),
                description=_cstr(self._data[o + 48:o + 112]),
                unit=_cstr(self._data[o + 112:o + 144]),
            ))
        return out

    def session_yaml(self) -> str:
        h = self.header
        return self._data[
            h.session_info_offset:h.session_info_offset + h.session_info_len
        ].decode("latin-1")

    def has_channel(self, name: str) -> bool:
        return name in self.channels

    def channel(self, name: str) -> np.ndarray:
        """All samples for a named channel; 1-D for count==1, else (nrec, count).

        Raises KeyError if absent — callers must report missing channels,
        never substitute (missing ≠ zero).
        """
        vh = self.channels[name]
        dtype = VAR_TYPE_DTYPES[vh.type]
        width = dtype.itemsize * vh.count
        raw = np.ascontiguousarray(self._samples[:, vh.offset:vh.offset + width])
        arr = raw.view(dtype)
        if vh.count == 1:
            return arr.ravel()
        return arr.reshape(self.record_count, vh.count)

    def missing_core_channels(self) -> list[str]:
        return [c for c in CORE_CHANNELS if c not in self.channels]
