"""Proctor telemetry parser: iRacing .ibt bytes in, structured lap objects out.

Pure-function philosophy: no DB calls, no HTTP. The Render service calls this
and handles persistence.
"""

from proctor_parser.ibt import CORE_CHANNELS, IbtFile

__all__ = ["IbtFile", "CORE_CHANNELS"]
