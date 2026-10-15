"""Hardware / rig-level observations from the raw sensor channels (module 5).

This module observes the *equipment*, not the driving: signals the rig sent
that the driver did not, force-feedback clipping, column torque and brake-bias
changes. Ticks are concatenated across every lap of the session because the
subject is the rig's behaviour over the whole outing, not any single lap.

ONE OWNER PER NUMBER. What the driver asked for against what the car did with
it -- brake ceiling, Brake vs BrakeRaw, the ABS -- belongs to input_response.
It used to be computed here as well, and the two copies drifted: the ABS share
here counted braking from the APPLIED channel and input_response from the
PEDAL, so the phone and the desktop printed different figures for the same
session, and the FFB sign bug had to be fixed twice. This module now keeps only
what is about the rig itself.

Payloads carry numbers and the contract's honesty fields. The sentences a
driver reads are written in the web app (lib/proctor/explain.ts and the
screens), so the copy can change without a re-ingest.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedSession

METRIC_KEY = "hardware"

_BASIS = "raw sensor channels across all laps in this session"
_CAVEAT = "single-session observation; hardware trends need history"
_NOISE_CAVEAT = (
    "sensor-wear early-warning baseline; trend needs multiple sessions. "
    "A brief spike is a heuristic: a brake reading above 5% that comes and "
    "goes within 50 ms with the throttle flat on both sides"
)

# FFB clipping is flagged past a small share of moving ticks, where lost detail
# starts to matter at the limit. A watch heuristic, not a pass/fail limit.
_FFB_CLIP_CONCERN_PCT = 2.0

# The pedal is "silent" on full-throttle ticks. The sub-5% noise count below is
# the original measurement (69 on the golden Long Beach file) and is unchanged.
_FULL_THROTTLE = 0.9
_NOISE_BAND = 0.05
_NOISE_FLOOR = 0.001

# A brief spike: a brake reading above the noise band that starts and ends
# within this long while the throttle stays flat on both sides. No foot presses
# and releases a pedal in 50 ms, so a reading that short is the sensor, not the
# driver. Left-foot braking also overlaps full throttle, but it stays on far
# longer than this and so is never counted.
_SPIKE_MAX_MS = 50
_DEFAULT_TICK_RATE = 60

# dcBrakeBias is carried into ParsedLap.raw as "brake_bias" (RAW_CHANNEL_MAP).
# We still look for it under either the contract key or its raw channel name so
# the block degrades honestly on any future/partial contract that drops it,
# reporting itself unavailable rather than fabricating a value.
_BIAS_KEYS = ("brake_bias", "dcBrakeBias")


def _concat(session: ParsedSession, key: str) -> np.ndarray | None:
    """Concatenate one raw channel across every lap, or None if never present."""
    parts = [lap.raw[key] for lap in session.laps if key in lap.raw and len(lap.raw[key])]
    if not parts:
        return None
    return np.concatenate(parts)


def compute(session: ParsedSession) -> dict:
    speed = _concat(session, "speed")
    if speed is None or len(speed) == 0:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no ticks in this session",
            "caveat": _CAVEAT,
        }

    brake_raw = _concat(session, "brake_raw")
    throttle = _concat(session, "throttle")
    ffb_stops = _concat(session, "ffb_stops")
    steer_torque = _concat(session, "steer_torque")
    moving = moving_mask(speed)
    tick_rate = session.meta.tick_rate or _DEFAULT_TICK_RATE

    return {
        "basis": _BASIS,
        "pedal_noise_floor": _pedal_noise_floor(throttle, brake_raw, moving, tick_rate),
        "ffb": _ffb(ffb_stops, moving),
        "steer_torque": _steer_torque(steer_torque, moving),
        "brake_bias": _brake_bias(session),
        "caveat": _CAVEAT,
    }


def _brake_bias(session: ParsedSession) -> dict:
    """Distinct dcBrakeBias values in session order — unavailable in v1 raw."""
    key = next(
        (k for k in _BIAS_KEYS if any(k in lap.raw for lap in session.laps)),
        None,
    )
    series = _concat(session, key) if key else None
    if series is None or len(series) == 0:
        return {
            "available": False,
            "reason": "dcBrakeBias not carried into lap objects v1",
        }

    rounded = np.round(series.astype(np.float64), 1)
    # Collapse consecutive duplicates, preserving session order.
    keep = np.concatenate(([True], np.diff(rounded) != 0))
    distinct = [float(v) for v in rounded[keep]]
    return {
        "available": True,
        "values": distinct,
        "changed_during_session": len(distinct) > 1,
    }


def _pedal_noise_floor(
    throttle: np.ndarray,
    brake_raw: np.ndarray,
    moving: np.ndarray,
    tick_rate: int,
) -> dict:
    """Brake-sensor readings while flat on the throttle -- signals that were not the driver.

    Two measurements, kept apart because they answer different questions:

    spike_ticks   the original noise floor: full-throttle ticks where the
                  sensor read anything at all below 5%. Unchanged, so the
                  golden count stays comparable across versions.
    brief_spikes  readings ABOVE 5% that came and went too quickly to be a
                  foot. The noise floor above cannot see these at all -- its
                  qualifying ticks stop at 5%, so a fault that jumps the brake
                  to 30% for one frame was excluded rather than counted.
    """
    full = throttle > _FULL_THROTTLE
    qualifying = full & (brake_raw < _NOISE_BAND)
    total = int(np.count_nonzero(qualifying))
    if total == 0:
        return {
            "insufficient_data": True,
            "reason": "no full-throttle ticks (throttle > 0.9) to listen to the brake on",
            "caveat": _NOISE_CAVEAT,
        }

    vals = brake_raw[qualifying]
    spike_ticks = int(np.count_nonzero(vals > _NOISE_FLOOR))
    brief = _brief_spikes(full & moving, brake_raw, tick_rate)
    out = {
        "spike_ticks": spike_ticks,
        "max_spike": round(float(vals.max()), 4),
        "qualifying_ticks": total,
        "brief_spikes": brief,
        "flagged": spike_ticks > 0 or brief["events"] > 0,
        "caveat": _NOISE_CAVEAT,
    }
    if not out["flagged"]:
        out["finding"] = "no brake signal while you were flat on the throttle"
    return out


def _brief_spikes(full: np.ndarray, brake_raw: np.ndarray, tick_rate: int) -> dict:
    """Brake readings above the noise band too short to be a foot.

    A run of ticks with brake_raw above 5% counts when it lasts no longer than
    _SPIKE_MAX_MS AND the throttle is flat on every tick of it and on the tick
    either side. `full` already excludes stationary ticks (moving_mask).
    """
    max_ticks = max(1, round(_SPIKE_MAX_MS / 1000 * tick_rate))
    above = brake_raw > _NOISE_BAND
    edges = np.diff(np.concatenate(([0], above.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)  # exclusive

    n = len(brake_raw)
    events = 0
    peak = 0.0
    for a, b in zip(starts, ends):
        if b - a > max_ticks or a == 0 or b >= n:
            continue
        if not (full[a - 1] and full[b] and full[a:b].all()):
            continue
        events += 1
        peak = max(peak, float(brake_raw[a:b].max()))

    return {
        "events": events,
        "peak_pct": round(100.0 * peak, 1) if events else None,
        "max_duration_ms": _SPIKE_MAX_MS,
        "min_reading_pct": round(100.0 * _NOISE_BAND, 1),
    }


def _ffb(ffb_stops: np.ndarray, moving: np.ndarray) -> dict:
    """Share of moving ticks where FFB torque is clipped against the stops.

    THE MAGNITUDE, NOT THE SIGNED VALUE. The channel is
    SteeringWheelPctTorqueSignStops -- iRacing's SIGNED variant, which runs
    -1..+1 as the force reverses with the direction of the corner. Testing it
    with a bare `>= 0.99` therefore only ever saw clipping in one steering
    direction: a session that pinned the wheel through every left-hander and
    never through a right one reported "no FFB clipping detected", and a
    session that clipped both ways reported about half of what happened.

    That is a confident wrong number rather than a blank, which is the failure
    the honesty rules exist to catch -- an empty panel invites a question, and
    "no clipping detected" closes one.
    """
    if not moving.any():
        return {"insufficient_data": True, "reason": "no moving ticks"}

    clipping_pct = round(100.0 * float((np.abs(ffb_stops[moving]) >= 0.99).mean()), 2)
    out = {
        "clipping_pct": clipping_pct,
        "flagged": clipping_pct >= _FFB_CLIP_CONCERN_PCT,
        "flag_threshold_pct": _FFB_CLIP_CONCERN_PCT,
    }
    if clipping_pct == 0.0:
        out["finding"] = "no FFB clipping detected"
    return out


def _steer_torque(steer_torque: np.ndarray | None, moving: np.ndarray) -> dict:
    """Column torque in Nm — the same force ffb reports, in physical units.

    `ffb` reads SteeringWheelPctTorqueSignStops, which is torque normalised to
    whatever the rig's force range happens to be set to, so it cannot be
    compared between sessions or after a settings change. This one can: Nm is
    Nm. Both are kept because the normalised channel is the one that says
    "against the stops", and this one says how hard that actually was.

    The saturation share here is measured against the DRIVER'S OWN maximum this
    session, in keeping with the self-envelope rule — it is not a claim about
    the wheelbase's rated output, which the file does not carry.
    """
    if steer_torque is None:
        return {
            "available": False,
            "reason": "SteeringWheelTorque not carried into lap objects",
        }
    if not moving.any():
        return {"insufficient_data": True, "reason": "no moving ticks"}

    vals = np.abs(steer_torque[moving].astype(np.float64))
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        return {"insufficient_data": True, "reason": "no finite torque ticks while moving"}

    peak = float(vals.max())
    at_own_max = (
        round(100.0 * float((vals >= peak * 0.99).mean()), 2) if peak > 0 else 0.0
    )
    return {
        "available": True,
        "median_nm": round(float(np.median(vals)), 2),
        "peak_nm": round(peak, 2),
        "at_own_max_pct": at_own_max,
        "ticks": int(vals.size),
        "note": (
            "absolute torque at the column. at_own_max_pct is the share of "
            "moving ticks within 1% of YOUR highest reading this session, not a "
            "hardware rating"
        ),
    }
