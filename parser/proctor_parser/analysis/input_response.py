"""What you asked the car for, against what the car actually did (module 14).

Every control in a sim rig is a request. Between the request and the car sits a
pedal calibration, an ABS controller and four contact patches, and each of them
can hand back less than was asked for. The .ibt carries both sides of that
exchange, so this module puts them side by side and reports the gap:

    brake     you pressed BrakeRaw; the car applied Brake, with BrakeABScutPct
              naming the share the ABS took back out
    throttle  you asked for Throttle; the wheels either put it down or spun,
              which the four wheel-speed channels show against ground speed
    steering  you turned SteeringWheelAngle; the car answered with LatAccel,
              and past some angle more lock stops buying more lateral force

ONE OWNER PER NUMBER. This module owns the brake ceiling and the ABS share;
hardware owns what the rig itself did (pedal noise, FFB clipping). The ABS share
counts braking from the PEDAL (BrakeRaw), because "your braking" means when your
foot was on it -- the applied channel drops out exactly where the ABS cuts it.

Payloads carry numbers and the contract's honesty fields. The sentences a driver
reads are written in the web app, so the copy can change without a re-ingest.

All Brake-vs-BrakeRaw logic runs on moving ticks only (contract rule 1): the sim
forces Brake=1.0 with BrakeRaw=0 whenever the car is stopped, which would
otherwise read as the car inventing brake pressure at every pit stop.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedSession

METRIC_KEY = "input_response"

_G = 9.81

_BASIS = "your inputs against the car's response, measured channel by channel"
_CAVEAT = (
    "one session, one car, one set of conditions; every threshold here is read "
    "off your own data rather than brought in from outside"
)

_BRAKING = 0.2          # brake_raw above this counts as a braking tick
_ON_POWER = 0.5         # throttle above this counts as asking for drive
_MIN_TICKS = 40         # below this a block reports itself unmeasured
_WHEELS = ("lf", "rf", "lr", "rr")

# Wheel speed above ground speed by more than this while on power is slip the
# driver would feel. Deliberately tighter than lockup_wheelspin's event
# threshold: that module finds discrete events, this one measures the everyday
# share.
_SLIP_MARGIN = 0.04

# Steering bins, in degrees at the wheel. The last is open-ended.
_STEER_BINS_DEG = (0.0, 20.0, 45.0, 75.0, 110.0, 150.0, 1e9)
_MIN_BIN_TICKS = 40


def _concat(session: ParsedSession, key: str, mask_key: str = "speed") -> np.ndarray | None:
    parts = [
        lap.raw[key]
        for lap in session.laps
        if key in lap.raw and len(lap.raw[key]) and len(lap.raw[key]) == len(lap.raw[mask_key])
    ]
    if not parts:
        return None
    return np.concatenate(parts).astype(np.float64)


def _unmeasured(reason: str) -> dict:
    return {"measured": False, "reason": reason}


def compute(session: ParsedSession) -> dict:
    speed = _concat(session, "speed")
    if speed is None or speed.size == 0:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no ticks in this session",
            "caveat": _CAVEAT,
        }

    moving = moving_mask(speed)
    if not moving.any():
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "the car never exceeded 5 m/s in this session",
            "caveat": _CAVEAT,
        }

    ch = {
        key: _concat(session, key)
        for key in (
            "brake", "brake_raw", "throttle", "steer", "lat_accel", "long_accel",
            "abs_active", "abs_cut",
            "lf_speed", "rf_speed", "lr_speed", "rr_speed",
        )
    }

    return {
        "basis": _BASIS,
        "brake": _brake_block(ch, speed, moving),
        "throttle": _throttle_block(ch, speed, moving),
        "steering": _steering_block(ch, moving),
        "caveat": _CAVEAT,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Brake: pedal pressed vs pressure applied
# ─────────────────────────────────────────────────────────────────────────────

def _brake_block(ch: dict, speed: np.ndarray, moving: np.ndarray) -> dict:
    pedal = ch.get("brake_raw")
    applied = ch.get("brake")
    if pedal is None or applied is None:
        return _unmeasured("the file does not carry both Brake and BrakeRaw")

    braking = moving & (pedal > _BRAKING)
    n = int(np.count_nonzero(braking))
    if n < _MIN_TICKS:
        return _unmeasured(f"only {n} moving braking ticks in this session")

    asked = pedal[braking]
    got = applied[braking]
    # Positive means the pedal was ahead of the pressure the car used.
    held_back = asked - got

    out: dict = {
        "measured": True,
        "braking_ticks": n,
        "stationary_ticks_excluded": int(np.count_nonzero(~moving)),
        "pedal_ceiling_pct": round(100.0 * float(asked.max()), 1),
        "applied_ceiling_pct": round(100.0 * float(got.max()), 1),
        "mean_held_back_pct": round(100.0 * float(held_back.mean()), 2),
        "max_held_back_pct": round(100.0 * float(held_back.max()), 2),
    }

    abs_active = ch.get("abs_active")
    abs_cut = ch.get("abs_cut")
    if abs_active is not None:
        engaged = abs_active[braking].astype(bool)
        share = 100.0 * float(engaged.mean())
        rising = int(np.count_nonzero(np.diff(abs_active.astype(bool).astype(np.int8)) == 1))
        abs_block: dict = {
            "engaged_pct_of_braking": round(share, 1),
            "activation_events": rising,
        }
        if abs_cut is not None:
            cut = abs_cut[braking]
            active_cut = cut[engaged] if engaged.any() else cut[:0]
            abs_block["mean_pressure_cut_pct"] = round(float(cut.mean()), 2)
            abs_block["max_pressure_cut_pct"] = round(float(cut.max()), 2)
            if active_cut.size:
                abs_block["mean_cut_while_engaged_pct"] = round(float(active_cut.mean()), 2)
        if share == 0.0 and rising == 0:
            abs_block["finding"] = "the ABS never engaged this session"
        out["abs"] = abs_block

    # What the braking actually produced, so the pedal has an outcome attached.
    long_accel = ch.get("long_accel")
    if long_accel is not None:
        decel_g = np.maximum(-long_accel[braking], 0.0) / _G
        out["peak_deceleration_g"] = round(float(np.percentile(decel_g, 98)), 3)
        # Deceleration bought per unit of pedal, on the ticks where the pedal was
        # genuinely loaded. Falls when the brakes stop answering the pedal.
        loaded = asked > 0.5
        if int(np.count_nonzero(loaded)) >= _MIN_TICKS:
            out["decel_per_pedal_g"] = round(
                float(np.median(decel_g[loaded] / asked[loaded])), 3
            )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Throttle: asked for drive vs put it down
# ─────────────────────────────────────────────────────────────────────────────

def _throttle_block(ch: dict, speed: np.ndarray, moving: np.ndarray) -> dict:
    throttle = ch.get("throttle")
    if throttle is None:
        return _unmeasured("the file does not carry a throttle channel")

    on_power = moving & (throttle > _ON_POWER)
    n = int(np.count_nonzero(on_power))
    if n < _MIN_TICKS:
        return _unmeasured(f"only {n} moving ticks above {_ON_POWER:.0%} throttle")

    out: dict = {
        "measured": True,
        "on_power_ticks": n,
        "mean_throttle_pct": round(100.0 * float(throttle[on_power].mean()), 1),
    }

    wheels = [ch.get(f"{w}_speed") for w in _WHEELS]
    if all(w is not None for w in wheels):
        ground = np.clip(speed, 1.0, None)
        # Fastest wheel against the ground: whichever corner is spinning is the
        # one that shows the slip, and the layout of driven axles is unknown.
        fastest = np.max(np.stack([w / ground for w in wheels]), axis=0)
        excess = fastest[on_power] - 1.0
        slipping = excess > _SLIP_MARGIN
        out["slip"] = {
            "share_of_on_power_pct": round(100.0 * float(slipping.mean()), 2),
            "mean_excess_pct_while_slipping": (
                round(100.0 * float(excess[slipping].mean()), 2) if slipping.any() else 0.0
            ),
            "peak_excess_pct": round(100.0 * float(excess.max()), 2),
            # The driven axle is not modelled, so this is the fastest wheel of four.
            "threshold_pct": round(100.0 * _SLIP_MARGIN, 1),
        }
        if not slipping.any():
            out["slip"]["finding"] = "no wheel spun while you were on power"

    long_accel = ch.get("long_accel")
    if long_accel is not None:
        drive_g = np.maximum(long_accel[on_power], 0.0) / _G
        out["peak_traction_g"] = round(float(np.percentile(drive_g, 98)), 3)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Steering: lock asked for vs lateral force returned
# ─────────────────────────────────────────────────────────────────────────────

def _steering_block(ch: dict, moving: np.ndarray) -> dict:
    steer = ch.get("steer")
    lat = ch.get("lat_accel")
    if steer is None or lat is None:
        return _unmeasured("the file does not carry both steering angle and lateral g")

    deg = np.degrees(np.abs(steer[moving]))
    lat_g = np.abs(lat[moving]) / _G
    if deg.size < _MIN_TICKS:
        return _unmeasured(f"only {deg.size} moving ticks to read steering from")

    bins: list[dict] = []
    for lo, hi in zip(_STEER_BINS_DEG[:-1], _STEER_BINS_DEG[1:]):
        inside = (deg >= lo) & (deg < hi)
        count = int(np.count_nonzero(inside))
        label = f"{lo:.0f}°+" if hi > 1e8 else f"{lo:.0f}-{hi:.0f}°"
        if count < _MIN_BIN_TICKS:
            bins.append({
                "band": label,
                "ticks": count,
                "measured": False,
                "reason": f"only {count} ticks at this much lock",
            })
            continue
        bins.append({
            "band": label,
            "ticks": count,
            "measured": True,
            "median_lateral_g": round(float(np.median(lat_g[inside])), 3),
            "peak_lateral_g": round(float(np.percentile(lat_g[inside], 98)), 3),
        })

    # The band where lateral g stops climbing describes THIS session; it moves
    # with tires, fuel and track, and is not a target.
    out: dict = {
        "measured": True,
        "bands": bins,
        "peak_steer_deg": round(float(deg.max()), 1),
    }

    measured = [b for b in bins if b.get("measured")]
    if len(measured) >= 2:
        best = max(measured, key=lambda b: b["peak_lateral_g"])
        out["most_lateral_g_band"] = best["band"]
        beyond = [b for b in measured if _band_start(b["band"]) > _band_start(best["band"])]
        if beyond:
            drop = best["peak_lateral_g"] - max(b["peak_lateral_g"] for b in beyond)
            out["falloff_past_peak_g"] = round(drop, 3)
    return out


def _band_start(label: str) -> float:
    return float(label.split("-")[0].replace("°+", "").replace("°", ""))
