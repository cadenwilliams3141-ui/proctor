"""Every pass through every corner: where the driver braked, turned, was
slowest and got back to full throttle, and how long each phase took.

Observes, per lap and corner, from the 60 Hz ticks in metres from the segment
start: brake point, peak and attack, release, turn-in, trail-braking overlap,
minimum speed and where it was, throttle pickup and full throttle, coasting,
steering corrections, throttle re-lifts, ABS time, and speeds on entry, exit
and at the end of the following straight. Phase times use the SAME stations
(the typical landmarks) for every pass, so they compare and sum exactly.

Each pass carries flags (off track, incident, tow, possible traffic, ...) so
that what follows from it can leave it out honestly rather than silently.
"""

from __future__ import annotations

from proctor_parser.analysis._engine import engine, insufficient
from proctor_parser.coaching import _phase_times
from proctor_parser.events import landmarks
from proctor_parser.phases import EXCLUDE, FLAG_NAMES
from proctor_parser.session import ParsedSession

METRIC_KEY = "corner_laps"
BASIS = "self-comparison: your own passes through each corner, this session"

METRICS = {
    # key: decimals in the payload
    "v_entry": 2, "brake_on": 1, "brake_peak": 3, "brake_attack": 2, "release": 1,
    "turn_in": 1, "trail": 1, "v_min": 2, "v_min_at": 1, "pickup": 1, "full": 1,
    "coast": 1, "corrections": 0, "relifts": 0, "abs_ms": 0, "v_exit": 2, "v_eos": 2,
}
UNITS = {
    "v_entry": "m/s", "brake_on": "m", "brake_peak": "ratio", "brake_attack": "ratio/s",
    "release": "m", "turn_in": "m", "trail": "m", "v_min": "m/s", "v_min_at": "m",
    "pickup": "m", "full": "m", "coast": "m", "corrections": "count", "relifts": "count",
    "abs_ms": "ms", "v_exit": "m/s", "v_eos": "m/s",
}


def _r(v, nd):
    if v is None:
        return None
    return int(round(v)) if nd == 0 else round(float(v), nd)


def compute(session: ParsedSession) -> dict:
    model, runs = engine(session)
    if model.insufficient:
        return insufficient(BASIS, model.insufficient)
    corners = []
    for c in model.corners:
        rs = sorted(runs.get(c.id, []), key=lambda r: r.lap_index)
        if not rs:
            corners.append({"id": c.id, "insufficient_data": True,
                            "reason": "no complete pass through this corner"})
            continue
        lm = landmarks(rs)
        names, edges, pt = _phase_times(rs, lm)
        corners.append({
            "id": c.id,
            "seg_len_m": round(min(r.seg_len for r in rs), 1),
            "landmarks": {k: _r(v, 1) for k, v in lm.items()},
            "phase_names": names,
            "phase_edges_m": [round(e, 1) for e in edges],
            "runs": {
                "lap": [int(r.lap) for r in rs],
                "flags": [int(r.flags) for r in rs],
                "usable": [not (r.flags & EXCLUDE) for r in rs],
                "time_s": [round(r.time_s, 4) for r in rs],
                "phase_s": [[round(float(x), 4) for x in row] for row in pt],
                "m": {k: [_r(r.metrics.get(k), nd) for r in rs] for k, nd in METRICS.items()},
            },
        })
    return {
        "basis": BASIS,
        "units": UNITS,
        "positions": "metres from the start of the corner's segment",
        "flag_bits": {name: bit for bit, name in FLAG_NAMES.items()},
        "corners": corners,
        "caveat": (
            "turn-in is 20% of the steering each pass used in that corner, so it is relative, "
            "not an absolute angle; a pass flagged for any reason is kept here but left out of "
            "every comparison"
        ),
    }
