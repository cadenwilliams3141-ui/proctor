"""Shared, per-session engine for the coaching modules.

segments, corner_laps, watch and coach all stand on the same track model and
the same measured passes. compute_all calls each module separately, so the
first one to ask builds them and caches the result on the session object;
the rest reuse it. Pure all the same: the cache holds only what is computed
from the session itself.
"""

from __future__ import annotations

from proctor_parser.phases import Run, build_runs
from proctor_parser.session import ParsedSession
from proctor_parser.track_model import TrackModel, build_track_model

_ATTR = "_proctor_engine"


def engine(session: ParsedSession) -> tuple[TrackModel, dict[int, list[Run]]]:
    cached = getattr(session, _ATTR, None)
    if cached is not None:
        return cached
    model = build_track_model(session)
    runs = {} if model.insufficient else build_runs(session, model)
    setattr(session, _ATTR, (model, runs))
    return model, runs


def insufficient(basis: str, reason: str) -> dict:
    return {"basis": basis, "insufficient_data": True, "reason": reason}
