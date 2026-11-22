"""The coach: where the time is, and what your own fastest passes did
differently — only where the evidence holds up (see proctor_parser.coaching).

Emits STRUCTURED actions with their evidence — laps, n, rho, false-discovery q,
bootstrap stability, explained gain — never prose. The rule (2026-11-22):
prescribe only what the driver's own laps demonstrated.
"""

from __future__ import annotations

from proctor_parser.analysis._engine import engine, insufficient
from proctor_parser.coaching import BASIS, coach
from proctor_parser.session import ParsedSession

METRIC_KEY = "coach"


def compute(session: ParsedSession) -> dict:
    model, runs = engine(session)
    if model.insufficient:
        return insufficient(BASIS, model.insufficient)
    return coach(session, model, runs)
