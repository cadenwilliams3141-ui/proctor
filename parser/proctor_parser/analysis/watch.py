"""The watcher: lockups, slides, coasting, hesitations, off-tracks, tows and
possible traffic, tick by tick, on every pass through every corner.

Observes measured channels only; thresholds are absolute where physics gives
them meaning and drawn from the driver's own passes through the same corner
where it does not. A kind that never happened is reported as "none observed";
a kind whose channel the file lacks is "not checkable", never zero. Time links
("passes with this here were X s slower") are associations, not causes.
"""

from __future__ import annotations

from proctor_parser.analysis._engine import engine, insufficient
from proctor_parser.events import detect, summarise
from proctor_parser.session import ParsedSession

METRIC_KEY = "watch"
BASIS = "measured channels; baselines from your own passes through each corner"


def compute(session: ParsedSession) -> dict:
    model, runs = engine(session)
    if model.insufficient:
        return insufficient(BASIS, model.insufficient)
    found = detect(model, runs, tick_rate=session.meta.tick_rate or 60,
                   redline=session.meta.car_redline_rpm)
    out = {"basis": BASIS}
    out.update(summarise(model, runs, found))
    out["caveat"] = (
        "time links compare your passes with and without each event at that corner; they "
        "show what went together, not why. Possible traffic is the shape a car in the way "
        "leaves (a lift from flat out and back) — Proctor cannot see other cars."
    )
    return out
