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

Each event also carries the STATE OF EVERY INPUT at the moment it began: speed,
gear, both pedals, steering, the load the car was already carrying, and how fast
the pedal was moving in the fifth of a second before it let go. That block
answers "what was I doing when this happened" from measured channels alone. It
does not say what to do instead — the technique call stays with the driver.
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

_G = 9.81
# How far back to look for the pedal's rate of change, in seconds. A fifth of a
# second is long enough to see a stab and short enough not to average it away.
_RATE_WINDOW_S = 0.2
# Steering past this counts the event as happening while the car was turning
# rather than in a straight line. ~11 degrees at the wheel.
_TURNING_RAD = 0.2


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
        "common_ground": {
            "lockups": _common_ground(lock_kept, "lockup"),
            "wheelspin": _common_ground(spin_kept, "wheelspin"),
        },
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
            "inputs": _inputs_at(lap, int(g[0]), tick_rate, mode),
        })
    return events


def _at(lap: ParsedLap, key: str, i: int) -> float | None:
    """One channel's value at one tick, or None where the channel is absent."""
    arr = lap.raw.get(key)
    if arr is None or i >= len(arr):
        return None
    value = float(arr[i])
    return value if np.isfinite(value) else None


def _inputs_at(lap: ParsedLap, i: int, tick_rate: int, mode: str) -> dict:
    """Every input the file carries, at the tick the slip began.

    This is the "what was I doing" block. It reports channel readings and
    nothing else — no cause is assigned and no correction is suggested, because
    neither is in the data.
    """
    speed = _at(lap, "speed", i)
    steer = _at(lap, "steer", i)
    lat = _at(lap, "lat_accel", i)
    lon = _at(lap, "long_accel", i)

    out: dict = {
        "speed_kmh": None if speed is None else round(speed * 3.6, 1),
        "gear": None if _at(lap, "gear", i) is None else int(_at(lap, "gear", i)),
        "throttle_pct": _pct(_at(lap, "throttle", i)),
        "brake_pedal_pct": _pct(_at(lap, "brake_raw", i)),
        "brake_applied_pct": _pct(_at(lap, "brake", i)),
        "steer_deg": None if steer is None else round(np.degrees(steer), 1),
        "lateral_g": None if lat is None else round(lat / _G, 2),
        "longitudinal_g": None if lon is None else round(lon / _G, 2),
    }

    if lat is not None and lon is not None:
        out["combined_g"] = round(float(np.hypot(lat, lon)) / _G, 2)

    if steer is not None:
        turning = abs(steer) > _TURNING_RAD
        out["turning"] = bool(turning)
        if turning:
            # Which way the car was turning, so the wheel that let go can be
            # read as the loaded (outside) or unloaded (inside) one.
            out["turn_direction"] = "left" if steer > 0 else "right"

    abs_active = _at(lap, "abs_active", i)
    if abs_active is not None:
        out["abs_active"] = bool(abs_active)
    bias = _at(lap, "brake_bias", i)
    if bias is not None:
        out["brake_bias_pct_front"] = round(bias, 1)

    # How fast the relevant pedal was moving into the event. A pedal already at
    # rest and a pedal being stamped on look identical at a single tick.
    channel = "brake_raw" if mode == "lockup" else "throttle"
    out["pedal"] = channel
    rate = _rate_into(lap, channel, i, tick_rate)
    if rate is not None:
        out["pedal_change_pct_per_100ms"] = rate
    else:
        # raw arrays are sliced per lap, so an event in the opening moments of a
        # lap has its run-up in the previous lap's array. Say that rather than
        # reporting a rate of zero, which would read as "the pedal was steady".
        out["pedal_change_unavailable"] = (
            "the event began too close to the start of the lap to measure the "
            f"pedal's movement over the {_RATE_WINDOW_S * 1000:.0f} ms before it"
        )
    return out


def _pct(value: float | None) -> float | None:
    return None if value is None else round(100.0 * value, 1)


def _rate_into(lap: ParsedLap, key: str, i: int, tick_rate: int) -> float | None:
    """Change in one pedal over the window before tick i, per 100 ms."""
    arr = lap.raw.get(key)
    if arr is None or tick_rate <= 0:
        return None
    back = max(1, int(round(_RATE_WINDOW_S * tick_rate)))
    start = i - back
    if start < 0 or i >= len(arr):
        return None
    delta = float(arr[i]) - float(arr[start])
    if not np.isfinite(delta):
        return None
    seconds = back / tick_rate
    return round(100.0 * delta / (seconds * 10.0), 1)


def _common_ground(events: list[dict], kind: str) -> dict:
    """What the events of one kind had in common, across the session.

    A single lockup is an incident; twenty of them at the same speed, in the
    same gear, with the same pedal rate, is a pattern — and a pattern is worth
    naming even though its cause is not in the file.
    """
    if not events:
        return {
            "measured": False,
            "reason": f"no {kind} events to find anything in common between",
        }

    def values(path: str) -> list[float]:
        return [
            e["inputs"][path]
            for e in events
            if isinstance(e.get("inputs"), dict) and e["inputs"].get(path) is not None
        ]

    out: dict = {"measured": True, "events": len(events)}

    speeds = values("speed_kmh")
    if speeds:
        out["median_speed_kmh"] = round(float(np.median(speeds)), 1)
    gears = values("gear")
    if gears:
        counts = {int(g): gears.count(g) for g in set(gears)}
        top = max(counts.items(), key=lambda kv: kv[1])
        out["most_common_gear"] = top[0]
        out["most_common_gear_share_pct"] = round(100.0 * top[1] / len(gears), 1)
    rates = values("pedal_change_pct_per_100ms")
    if rates:
        out["median_pedal_change_pct_per_100ms"] = round(float(np.median(rates)), 1)

    turning = [
        e["inputs"]["turning"]
        for e in events
        if isinstance(e.get("inputs"), dict) and "turning" in e["inputs"]
    ]
    if turning:
        out["while_turning_pct"] = round(100.0 * sum(turning) / len(turning), 1)

    combined = values("combined_g")
    if combined:
        out["median_combined_g"] = round(float(np.median(combined)), 2)

    if kind == "lockup":
        abs_on = [
            e["inputs"]["abs_active"]
            for e in events
            if isinstance(e.get("inputs"), dict) and "abs_active" in e["inputs"]
        ]
        if abs_on:
            out["with_abs_active_pct"] = round(100.0 * sum(abs_on) / len(abs_on), 1)

    # Which corner of the car gave up most often — the one fact here that is
    # about the car rather than the input.
    wheel_hits: dict[str, int] = {}
    for e in events:
        for w in e.get("wheels", []):
            wheel_hits[w] = wheel_hits.get(w, 0) + 1
    if wheel_hits:
        top_wheel = max(wheel_hits.items(), key=lambda kv: kv[1])
        out["most_affected_wheel"] = top_wheel[0]
        out["most_affected_wheel_events"] = top_wheel[1]
        out["wheel_counts"] = dict(sorted(wheel_hits.items()))

    out["note"] = (
        "shared conditions across these events, read from the channels. They "
        "describe when the slip happened, not why — intent and setup are not "
        "channels in this file"
    )
    return out
