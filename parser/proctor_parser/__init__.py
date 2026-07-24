"""Proctor telemetry parser: iRacing .ibt bytes in, structured lap objects out.

Pure-function philosophy: no DB calls, no HTTP. The Render service calls this
and handles persistence.
"""

from proctor_parser.ibt import CORE_CHANNELS, IbtFile, IbtFormatError
from proctor_parser.laps import GRID_POINTS, STATIONARY_SPEED_MPS, moving_mask
from proctor_parser.session import (
    GRID_CHANNELS,
    RAW_CHANNEL_MAP,
    MissingChannelsError,
    ParsedLap,
    ParsedSession,
    SessionMeta,
    parse_ibt,
)

__all__ = [
    "CORE_CHANNELS", "IbtFile", "IbtFormatError",
    "GRID_POINTS", "STATIONARY_SPEED_MPS", "moving_mask",
    "GRID_CHANNELS", "RAW_CHANNEL_MAP", "MissingChannelsError",
    "ParsedLap", "ParsedSession", "SessionMeta", "parse_ibt",
]
