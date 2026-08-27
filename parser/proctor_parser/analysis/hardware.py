"""Hardware / rig-level observations from the raw sensor channels (module 5).

This module observes the *equipment*, not the driving: brake-sensor
calibration, ABS engagement, brake-bias changes, pedal noise floor, and
force-feedback clipping. Ticks are concatenated across every lap of the
session because the subject is the rig's behaviour over the whole outing, not
any single lap.

Every Brake-vs-BrakeRaw comparison excludes stationary ticks via moving_mask:
the sim forces Brake=1.0 with BrakeRaw=0 whenever the car is stopped
(contract rule 1), which would otherwise read as a permanent sensor fault at
every race start.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedSession

METRIC_KEY = "hardware"

_BASIS = "raw sensor channels across all laps in this session"
_CAVEAT = "single-session observation; hardware trends need history"
_NOISE_CAVEAT = "sensor-wear early-warning baseline; trend needs multiple sessions"

# "Worth noticing" thresholds for the areas-of-concern summary. These are watch
# heuristics, not pass/fail limits: any pedal-noise spike is surfaced (the noise
# floor should be silent), and FFB clipping is flagged past a small share of
# moving ticks where lost detail starts to matter at the limit.
_FFB_CLIP_CONCERN_PCT = 2.0

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

    brake = _concat(session, "brake")
    brake_raw = _concat(session, "brake_raw")
    throttle = _concat(session, "throttle")
    abs_active = _concat(session, "abs_active")
    ffb_stops = _concat(session, "ffb_stops")
    steer_torque = _concat(session, "steer_torque")
    moving = moving_mask(speed)

    brake_vs_raw = _brake_vs_raw(brake, brake_raw, moving)
    noise = _pedal_noise_floor(throttle, brake_raw)
    ffb = _ffb(ffb_stops, moving)

    return {
        "basis": _BASIS,
        "brake_vs_raw": brake_vs_raw,
        "abs": _abs_block(brake, abs_active, moving),
        "brake_bias": _brake_bias(session),
        "pedal_noise_floor": noise,
        "ffb": ffb,
        "steer_torque": _steer_torque(steer_torque, moving),
        "areas_of_concern": _areas_of_concern(noise, ffb),
        "caveat": _CAVEAT,
    }


def _brake_vs_raw(brake: np.ndarray, brake_raw: np.ndarray, moving: np.ndarray) -> dict:
    """Brake command vs sensor reading over moving ticks only (contract rule 1)."""
    stationary_excluded = int(np.count_nonzero(~moving))
    if not moving.any():
        return {
            "insufficient_data": True,
            "reason": "no moving ticks to compare",
            "stationary_ticks_excluded": stationary_excluded,
        }

    b = brake[moving]
    r = brake_raw[moving]
    diff = np.abs(b - r)

    # The driver's demonstrated brake ceiling: the most the sensor ever
    # delivered while moving this session. Self-envelope — the sim Brake
    # channel itself tops out wherever the driver did, so "sensor at command
    # saturation" would read null on real files. Not a hardware limit claim.
    return {
        "max_abs_diff": round(float(diff.max()), 4),
        "mean_abs_diff": round(float(diff.mean()), 4),
        "brake_ceiling_pct": round(100.0 * float(r.max()), 1),
        "ceiling_note": "your own max this session, not a hardware limit",
        "stationary_ticks_excluded": stationary_excluded,
    }


def _abs_block(brake: np.ndarray, abs_active: np.ndarray, moving: np.ndarray) -> dict:
    """ABS engagement share of braking ticks + distinct activation events."""
    active = abs_active.astype(bool)
    # Rising edges = distinct activations (False -> True), over all ticks.
    events = int(np.count_nonzero(np.diff(active.astype(np.int8)) == 1))

    braking = moving & (brake > 0.2)
    n_braking = int(np.count_nonzero(braking))
    if n_braking == 0:
        return {
            "insufficient_data": True,
            "reason": "no moving braking ticks (brake > 0.2)",
            "activation_events": events,
        }

    engaged_pct = round(100.0 * float(active[braking].mean()), 1)
    out = {
        "engaged_pct_of_braking": engaged_pct,
        "activation_events": events,
        "braking_ticks": n_braking,
    }
    if engaged_pct == 0.0 and events == 0:
        out["finding"] = "no ABS engagement detected"
    return out


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


def _pedal_noise_floor(throttle: np.ndarray, brake_raw: np.ndarray) -> dict:
    """Brake-sensor floor while hard on throttle (the pedal should be silent)."""
    qualifying = (throttle > 0.9) & (brake_raw < 0.05)
    total = int(np.count_nonzero(qualifying))
    if total == 0:
        return {
            "insufficient_data": True,
            "reason": "no full-throttle straight ticks (throttle > 0.9, brake_raw < 0.05)",
            "caveat": _NOISE_CAVEAT,
        }

    vals = brake_raw[qualifying]
    return {
        "spike_ticks": int(np.count_nonzero(vals > 0.001)),
        "max_spike": round(float(vals.max()), 4),
        "qualifying_ticks": total,
        "caveat": _NOISE_CAVEAT,
    }


def _ffb(ffb_stops: np.ndarray, moving: np.ndarray) -> dict:
    """Share of moving ticks where FFB torque is clipped against the stops."""
    if not moving.any():
        return {"insufficient_data": True, "reason": "no moving ticks"}

    clipping_pct = round(100.0 * float((ffb_stops[moving] >= 0.99).mean()), 2)
    out = {"clipping_pct": clipping_pct}
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


def _areas_of_concern(noise: dict, ffb: dict) -> dict:
    """Descriptive brake-pedal / sensor watch items drawn from the blocks above.

    Observations, never a verdict or health score: each entry names what a
    channel showed and where the watch heuristic sits, and an all-clear session
    returns an explicit "nothing to flag" finding rather than an empty silence.
    """
    concerns: list[dict] = []

    spike_ticks = noise.get("spike_ticks")
    if isinstance(spike_ticks, int) and spike_ticks > 0:
        concerns.append({
            "area": "brake sensor noise",
            "observation": (
                f"{spike_ticks} of {noise.get('qualifying_ticks')} full-throttle "
                f"ticks read a nonzero brake (peak {noise.get('max_spike')}), "
                "where the pedal should be silent"
            ),
            "watch": _NOISE_CAVEAT,
        })

    clip = ffb.get("clipping_pct")
    if isinstance(clip, (int, float)) and clip >= _FFB_CLIP_CONCERN_PCT:
        concerns.append({
            "area": "force-feedback clipping",
            "observation": (
                f"FFB torque clipped against the stops on {clip}% of moving "
                "ticks — detail is lost wherever it saturates"
            ),
            "watch": f"flagged past {_FFB_CLIP_CONCERN_PCT:.0f}% of moving ticks",
        })

    out: dict = {"concerns": concerns}
    if not concerns:
        out["finding"] = "no brake-pedal or sensor concerns detected this session"
    out["caveat"] = "watch items, not diagnoses; a trend needs multiple sessions"
    return out
