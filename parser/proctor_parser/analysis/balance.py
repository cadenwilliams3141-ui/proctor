"""Self-calibrated understeer / oversteer tendency (module 11).

There is no wheelbase or steering-ratio model here. Instead the expected yaw
rate is calibrated from this session's own low-slip driving: a least-squares fit
of yaw_rate to steer*speed, whose single coefficient k silently absorbs the
wheelbase and steering ratio. Ticks whose actual yaw departs far from that
expectation (beyond the session's own 90th-percentile residual) are the
divergences; each is classed by whether the car rotated more than steered
(oversteer tendency) or less (understeer tendency), and chained to what the
driver was doing with the pedals.

Everything is descriptive self-comparison within one session. A weak fit (low
r2) means the expectation itself is untrustworthy, so a fit below 0.3 returns
insufficient data rather than numbers that look precise but aren't. The fit
excludes parked and near-parked ticks (speed < 5 m/s) and large steering
corrections (|steer| >= 1.5 rad) that break the small-angle relationship.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "balance"

_BASIS = (
    "expected yaw self-calibrated from this session's own low-slip data; "
    "no physics model"
)
_METHOD = (
    "least-squares k in yaw~=k*steer*speed; k absorbs wheelbase and steering "
    "ratio"
)
_CAVEAT = (
    "single-session self-calibration; a poor fit (low r2) weakens every number "
    "here"
)
_MIN_SPEED = 5.0        # exclude parked / near-parked ticks
_MAX_STEER = 1.5        # rad; beyond this the linear relationship breaks down
_MIN_R2 = 0.3           # below this the steer-yaw relationship can't be trusted
_DIVERGENCE_PCTILE = 90


def compute(session: ParsedSession) -> dict:
    steer_parts, speed_parts, yaw_parts, brake_parts, thr_parts = [], [], [], [], []
    dist_parts = []
    for lap in session.laps:
        if not lap.is_valid or "speed" not in lap.raw or len(lap.raw["speed"]) == 0:
            continue
        speed = lap.raw["speed"].astype(np.float64)
        steer = lap.raw["steer"].astype(np.float64)
        keep = (speed >= _MIN_SPEED) & (np.abs(steer) < _MAX_STEER)
        if not keep.any():
            continue
        steer_parts.append(steer[keep])
        speed_parts.append(speed[keep])
        yaw_parts.append(lap.raw["yaw_rate"].astype(np.float64)[keep])
        brake_parts.append(lap.raw["brake_raw"].astype(np.float64)[keep])
        thr_parts.append(lap.raw["throttle"].astype(np.float64)[keep])
        dist_parts.append(lap.raw["dist"].astype(np.float64)[keep])

    if not steer_parts:
        return {
            "basis": _BASIS,
            "method": _METHOD,
            "insufficient_data": True,
            "reason": "no valid moving ticks within the steering range to calibrate",
            "caveat": _CAVEAT,
        }

    steer = np.concatenate(steer_parts)
    speed = np.concatenate(speed_parts)
    yaw = np.concatenate(yaw_parts)
    brake = np.concatenate(brake_parts)
    throttle = np.concatenate(thr_parts)
    dist = np.concatenate(dist_parts)

    x = steer * speed
    sxx = float(np.sum(x * x))
    ss_tot = float(np.sum((yaw - float(np.mean(yaw))) ** 2))
    if sxx <= 0.0 or ss_tot <= 0.0:
        # Either no steering signal or a flat yaw trace: nothing to calibrate.
        return {
            "basis": _BASIS,
            "method": _METHOD,
            "insufficient_data": True,
            "fit_r2": 0.0,
            "reason": "steer-yaw relationship too weak to calibrate",
            "caveat": _CAVEAT,
        }

    k = float(np.sum(x * yaw) / sxx)
    resid = yaw - k * x
    ss_res = float(np.sum(resid ** 2))
    r2 = 1.0 - ss_res / ss_tot

    if r2 < _MIN_R2:
        return {
            "basis": _BASIS,
            "method": _METHOD,
            "insufficient_data": True,
            "fit_r2": round(r2, 3),
            "reason": "steer-yaw relationship too weak to calibrate",
            "caveat": _CAVEAT,
        }

    abs_resid = np.abs(resid)
    threshold = float(np.percentile(abs_resid, _DIVERGENCE_PCTILE))
    diverge = abs_resid > threshold
    n_moving = int(steer.size)
    n_div = int(np.count_nonzero(diverge))

    # Oversteer: the car rotated further in the steered direction than expected
    # (residual shares the steer's sign). Everything else diverging is understeer.
    same_sign = (np.sign(resid) == np.sign(steer)) & (np.sign(steer) != 0)
    oversteer = diverge & same_sign
    understeer = diverge & ~oversteer

    # Pedal state per tick: braking wins over throttle, else coasting.
    braking = brake > 0.2
    on_throttle = (~braking) & (throttle > 0.5)
    coasting = (~braking) & (~on_throttle)

    payload = {
        "basis": _BASIS,
        "method": _METHOD,
        "fit_k": round(k, 6),
        "fit_r2": round(r2, 3),
        "divergence_share_pct": round(100.0 * n_div / n_moving, 1) if n_moving else 0.0,
        "tendency": _split(understeer, oversteer, n_div),
        "by_input_state": {
            "braking": _state_block(diverge & braking, understeer, oversteer),
            "on_throttle": _state_block(diverge & on_throttle, understeer, oversteer),
            "coasting": _state_block(diverge & coasting, understeer, oversteer),
        },
        "by_corner": _by_corner(session, dist, diverge, understeer, oversteer),
        "brake_bias": _brake_bias(session),
        "caveat": _CAVEAT,
    }
    payload["finding"] = _finding(payload["by_input_state"])
    return payload


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, else fastest valid (contract rule 4)."""
    valid = [l for l in session.laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def _by_corner(
    session: ParsedSession,
    dist: np.ndarray,
    diverge: np.ndarray,
    understeer: np.ndarray,
    oversteer: np.ndarray,
) -> dict:
    """Understeer/oversteer lean inside each corner the reference lap carved.

    Ties the session-wide balance read to *where* on track it happened: corner
    windows come from the reference lap's speed profile, and the already-computed
    per-tick divergence flags are masked to each window by distance. Descriptive
    only — the corners are this driver's line, not the track's surveyed geometry.
    """
    ref = _reference_lap(session)
    if ref is None:
        return {"available": False, "reason": "no reference lap to place corners on"}
    corners = detect_corners(ref.grid["speed"], ref.grid["grid_pct"])
    if not corners:
        return {
            "available": False,
            "reason": "no corners detected on the reference lap's speed profile",
        }

    out: list[dict] = []
    for c in corners:
        in_corner = (dist >= c["start_pct"]) & (dist <= c["end_pct"])
        div_here = diverge & in_corner
        n = int(np.count_nonzero(div_here))
        us = round(100.0 * int((div_here & understeer).sum()) / n, 1) if n else 0.0
        os = round(100.0 * int((div_here & oversteer).sum()) / n, 1) if n else 0.0
        if n == 0:
            lean = "no divergences here"
        elif us > os:
            lean = "understeer"
        elif os > us:
            lean = "oversteer"
        else:
            lean = "even"
        out.append({
            "id": c["id"],
            "start_pct": c["start_pct"],
            "apex_pct": c["apex_pct"],
            "end_pct": c["end_pct"],
            "understeer_pct": us,
            "oversteer_pct": os,
            "lean": lean,
            "divergence_ticks": n,
        })
    return {"available": True, "reference_lap": int(ref.lap_number), "corners": out}


def _brake_bias(session: ParsedSession) -> dict:
    """Front brake-bias value(s) this session, with a general-mechanism note.

    Descriptive: reports the front-share value and whether the driver moved it,
    and explains the general relationship to balance without recommending any
    setting (Proctor observes, it does not prescribe setups).
    """
    parts = [
        lap.raw["brake_bias"]
        for lap in session.laps
        if "brake_bias" in lap.raw and len(lap.raw["brake_bias"])
    ]
    if not parts:
        return {
            "available": False,
            "reason": "brake-bias channel not carried for this session",
        }
    series = np.round(np.concatenate(parts).astype(np.float64), 1)
    keep = np.concatenate(([True], np.diff(series) != 0))
    distinct = [float(v) for v in series[keep]]
    return {
        "available": True,
        "front_pct_values": distinct,
        "changed_during_session": len(distinct) > 1,
        "note": (
            "brake bias is the front share of braking force; as a general "
            "mechanism more front bias leans the braking phase toward understeer "
            "and less toward oversteer. Compare it against the braking lean above "
            "— Proctor reports the value, it does not recommend a setting."
        ),
    }


def _split(understeer: np.ndarray, oversteer: np.ndarray, n_div: int) -> dict:
    """Understeer / oversteer share of all divergence ticks."""
    if n_div == 0:
        return {"understeer_pct": 0.0, "oversteer_pct": 0.0}
    return {
        "understeer_pct": round(100.0 * int(understeer.sum()) / n_div, 1),
        "oversteer_pct": round(100.0 * int(oversteer.sum()) / n_div, 1),
    }


def _state_block(in_state: np.ndarray, understeer: np.ndarray, oversteer: np.ndarray) -> dict:
    """Understeer / oversteer share among divergence ticks in one pedal state."""
    ticks = int(np.count_nonzero(in_state))
    if ticks == 0:
        return {"understeer_pct": 0.0, "oversteer_pct": 0.0, "ticks": 0}
    return {
        "understeer_pct": round(100.0 * int((in_state & understeer).sum()) / ticks, 1),
        "oversteer_pct": round(100.0 * int((in_state & oversteer).sum()) / ticks, 1),
        "ticks": ticks,
    }


def _finding(by_state: dict) -> str:
    """One descriptive sentence: which way each pedal state leaned. No advice."""
    labels = {"braking": "under braking", "on_throttle": "on throttle", "coasting": "coasting"}
    clauses = []
    for state, phrase in labels.items():
        block = by_state[state]
        if block["ticks"] == 0:
            continue
        if block["understeer_pct"] > block["oversteer_pct"]:
            clauses.append(f"divergences {phrase} lean understeer")
        elif block["oversteer_pct"] > block["understeer_pct"]:
            clauses.append(f"divergences {phrase} lean oversteer")
        else:
            clauses.append(f"divergences {phrase} split evenly")
    if not clauses:
        return "no divergences to describe"
    return "; ".join(clauses)
