"""Wheel-slip events: lockups under braking, wheelspin under power (module 8).

Observes each wheel's rotational speed against the car's ground speed, tick by
tick, over moving ticks only. A wheel spinning far slower than the ground while
the driver is on the brake is a lockup; a wheel spinning far faster than the
ground while on the throttle is wheelspin. Both thresholds are fixed heuristics
(the driven-axle layout is unknown), so this describes where the channels
diverged, it never diagnoses grip or setup.

Only moving ticks count (contract rule 1): the sim forces Brake=1.0 with
BrakeRaw=0 while stopped, and a parked car's zeroed wheel speeds would otherwise
read as a permanent lockup at every pit exit. brake_raw (the real pedal sensor)
gates lockups so the forced-brake ticks never qualify.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "lockup_wheelspin"

_BASIS = "wheel speeds vs ground speed, this session's own data"
_CAVEAT = (
    "thresholds are fixed heuristics (0.5x under braking, 1.1x under power); "
    "driven-axle layout is not modeled"
)

WHEELS = ("lf", "rf", "lr", "rr")

_LOCKUP_RATIO = 0.5    # wheel slower than half ground speed while braking
_WHEELSPIN_RATIO = 1.1  # wheel faster than 1.1x ground speed while on power
_EVENT_GAP_TICKS = 5    # a gap longer than this splits one event into two
_EVENT_CAP = 50         # keep only the N most-severe events per category


def compute(session: ParsedSession) -> dict:
    tick_rate = session.meta.tick_rate or 60
    lockups: list[dict] = []
    wheelspin: list[dict] = []
    for lap in session.laps:
        if "speed" not in lap.raw or len(lap.raw["speed"]) == 0:
            continue
        lockups.extend(_events(lap, tick_rate, "lockup"))
        wheelspin.extend(_events(lap, tick_rate, "wheelspin"))

    lock_total = len(lockups)
    spin_total = len(wheelspin)
    # Most-severe first: lowest ratio is the deepest lockup, highest ratio is
    # the wildest wheelspin.
    lock_kept = sorted(lockups, key=lambda e: e["peak_slip_ratio"])[:_EVENT_CAP]
    spin_kept = sorted(
        wheelspin, key=lambda e: e["peak_slip_ratio"], reverse=True
    )[:_EVENT_CAP]

    payload: dict = {
        "basis": _BASIS,
        "lockups": lock_kept,
        "wheelspin": spin_kept,
        "counts": {"lockup_events": lock_total, "wheelspin_events": spin_total},
        "caveat": _CAVEAT,
    }
    # counts hold the true totals; the lists above are capped, so flag when a
    # list no longer shows every event.
    if lock_total > _EVENT_CAP or spin_total > _EVENT_CAP:
        payload["events_truncated"] = True
    # Negative results are findings (contract honesty rules).
    if lock_total == 0:
        payload["lockups_finding"] = "no lockups detected"
    if spin_total == 0:
        payload["wheelspin_finding"] = "no wheelspin detected"
    return payload


def _events(lap: ParsedLap, tick_rate: int, mode: str) -> list[dict]:
    """Grouped slip events for one lap in either 'lockup' or 'wheelspin' mode."""
    speed = lap.raw["speed"].astype(np.float64)
    moving = moving_mask(speed)
    # Guard the division: moving ticks are already > 5 m/s, but clip anyway.
    ground = np.clip(speed, 1.0, None)
    ratios = {w: lap.raw[f"{w}_speed"].astype(np.float64) / ground for w in WHEELS}

    if mode == "lockup":
        gate = moving & (lap.raw["brake_raw"] > 0.2)
        triggered = {w: gate & (ratios[w] < _LOCKUP_RATIO) for w in WHEELS}
    else:
        gate = moving & (lap.raw["throttle"] > 0.5)
        triggered = {w: gate & (ratios[w] > _WHEELSPIN_RATIO) for w in WHEELS}

    any_trig = np.zeros(len(speed), dtype=bool)
    for w in WHEELS:
        any_trig |= triggered[w]
    idx = np.flatnonzero(any_trig)
    if idx.size == 0:
        return []

    # Split into events wherever the gap between qualifying ticks exceeds the
    # tolerance; short gaps stay inside one event.
    splits = np.flatnonzero(np.diff(idx) > _EVENT_GAP_TICKS) + 1
    groups = np.split(idx, splits)

    dist = lap.raw["dist"].astype(np.float64)
    events: list[dict] = []
    for g in groups:
        wheels = sorted(w for w in WHEELS if bool(triggered[w][g].any()))
        stacked = np.stack([ratios[w][g] for w in WHEELS])
        peak = float(stacked.min()) if mode == "lockup" else float(stacked.max())
        n_ticks = int(g[-1] - g[0] + 1)
        events.append({
            "lap": int(lap.lap_number),
            "start_pct": round(float(dist[g[0]]), 4),
            "wheels": wheels,
            "duration_ms": round(n_ticks * 1000.0 / tick_rate),
            "peak_slip_ratio": round(peak, 3),
        })
    return events
