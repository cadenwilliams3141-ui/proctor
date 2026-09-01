"""What you asked the car for, against what the car actually did (module 14).

Every control in a sim rig is a request. Between the request and the car sits a
pedal calibration, an ABS controller, four contact patches and a force-feedback
motor, and each of those can hand back less than was asked for. The .ibt carries
both sides of that exchange for three of the four controls, so this module puts
them side by side and reports the gap:

    brake     you pressed BrakeRaw; the car applied Brake, with BrakeABScutPct
              naming the share the ABS took back out
    throttle  you asked for Throttle; the wheels either put it down or spun,
              which the four wheel-speed channels show against ground speed
    steering  you turned SteeringWheelAngle; the car answered with LatAccel,
              and past some angle more lock stops buying more lateral force
    wheel     the rig asked for a torque; SteeringWheelPctTorqueSignStops says
              how often it was already against the stops and had nothing left

The steering block deserves its caveat up front: the angle at which extra lock
stops producing extra lateral force is measured HERE, from this session's own
data, and it moves with tires, fuel, and track. It is a description of the
session, not a limit to aim at.

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
            "abs_active", "abs_cut", "ffb_stops", "ffb_pct",
            "lf_speed", "rf_speed", "lr_speed", "rr_speed",
        )
    }

    payload = {
        "basis": _BASIS,
        "brake": _brake_block(ch, speed, moving),
        "throttle": _throttle_block(ch, speed, moving),
        "steering": _steering_block(ch, moving),
        "wheel": _wheel_block(ch, moving),
        "per_lap": _per_lap(session),
        "caveat": _CAVEAT,
    }
    payload["findings"] = _findings(payload)
    return payload


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
        "ceiling_note": (
            "both ceilings are your own maximum this session, not a hardware "
            "limit — the channels top out wherever you did"
        ),
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
            abs_block["cut_note"] = (
                "BrakeABScutPct is the share of the pressure you asked for that "
                "the ABS took back out — the gap between the pedal and the car"
            )
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
            out["decel_per_pedal_note"] = (
                "median g of deceleration per unit of pedal, over ticks with the "
                "pedal past half travel — a description of what the pedal bought"
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
            "threshold_note": (
                f"a wheel turning more than {_SLIP_MARGIN:.0%} faster than the "
                "ground while you are on power; the driven axle is not modelled, "
                "so this is the fastest wheel of the four"
            ),
        }
        if not slipping.any():
            out["slip"]["finding"] = (
                "no wheel ran meaningfully ahead of the ground while on power"
            )

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

    out: dict = {
        "measured": True,
        "bands": bins,
        "peak_steer_deg": round(float(deg.max()), 1),
        "note": (
            "lateral force returned for each amount of lock. The band where the "
            "figure stops climbing is where more steering stopped buying more "
            "grip IN THIS SESSION — read it as a description, not a target"
        ),
    }

    measured = [b for b in bins if b.get("measured")]
    if len(measured) >= 2:
        best = max(measured, key=lambda b: b["peak_lateral_g"])
        out["most_lateral_g_band"] = best["band"]
        beyond = [b for b in measured if _band_start(b["band"]) > _band_start(best["band"])]
        if beyond:
            drop = best["peak_lateral_g"] - max(b["peak_lateral_g"] for b in beyond)
            out["falloff_past_peak_g"] = round(drop, 3)
            out["falloff_note"] = (
                f"past {best['band']} of lock the lateral force you got back did "
                f"not rise — it fell by {drop:.2f} g at the highest bands"
                if drop > 0
                else "lateral force kept rising with lock across every band measured"
            )
    return out


def _band_start(label: str) -> float:
    return float(label.split("-")[0].replace("°+", "").replace("°", ""))


# ─────────────────────────────────────────────────────────────────────────────
# Wheel: force feedback the rig could not hand back
# ─────────────────────────────────────────────────────────────────────────────

def _wheel_block(ch: dict, moving: np.ndarray) -> dict:
    stops = ch.get("ffb_stops")
    if stops is None:
        return _unmeasured("the file does not carry a force-feedback saturation channel")

    # Magnitude: the channel is signed (see hardware._ffb), so a bare
    # comparison counts clipping in one steering direction only.
    saturated = np.abs(stops[moving]) >= 0.99
    share = 100.0 * float(saturated.mean())
    out: dict = {
        "measured": True,
        "clipping_pct_of_moving": round(share, 2),
        "note": (
            "while the wheel is against its stops the force it hands back stops "
            "changing, so any detail in that moment never reached your hands"
        ),
    }
    torque = ch.get("ffb_pct")
    if torque is not None:
        out["median_torque_pct"] = round(100.0 * float(np.median(np.abs(torque[moving]))), 1)
    if share == 0.0:
        out["finding"] = "the wheel never ran against its stops this session"
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Per lap, for the stint view
# ─────────────────────────────────────────────────────────────────────────────

def _per_lap(session: ParsedSession) -> list[dict]:
    """One row per lap: how much the car took back out, lap by lap."""
    rows: list[dict] = []
    for lap in session.laps:
        if "speed" not in lap.raw or len(lap.raw["speed"]) == 0:
            continue
        speed = lap.raw["speed"].astype(np.float64)
        moving = moving_mask(speed)
        pedal = lap.raw.get("brake_raw")
        if pedal is None:
            continue
        pedal = pedal.astype(np.float64)
        braking = moving & (pedal > _BRAKING)
        row: dict = {
            "lap": int(lap.lap_number),
            "clean": bool(lap.is_valid and not lap.is_out_lap and not lap.is_anomalous),
            "braking_ticks": int(np.count_nonzero(braking)),
        }
        if not braking.any():
            row["measured"] = False
            rows.append(row)
            continue

        row["measured"] = True
        row["peak_pedal_pct"] = round(100.0 * float(pedal[braking].max()), 1)

        abs_active = lap.raw.get("abs_active")
        if abs_active is not None:
            row["abs_engaged_pct"] = round(
                100.0 * float(abs_active.astype(bool)[braking].mean()), 1
            )
        abs_cut = lap.raw.get("abs_cut")
        if abs_cut is not None:
            row["mean_pressure_cut_pct"] = round(
                float(abs_cut.astype(np.float64)[braking].mean()), 2
            )

        long_accel = lap.raw.get("long_accel")
        if long_accel is not None:
            decel_g = np.maximum(-long_accel.astype(np.float64)[braking], 0.0) / _G
            loaded = pedal[braking] > 0.5
            row["peak_decel_g"] = round(float(np.percentile(decel_g, 98)), 3)
            if int(np.count_nonzero(loaded)) >= 10:
                row["decel_per_pedal_g"] = round(
                    float(np.median(decel_g[loaded] / pedal[braking][loaded])), 3
                )
        rows.append(row)
    return rows


def _findings(payload: dict) -> list[str]:
    """Plain sentences, one per block that had something to say."""
    out: list[str] = []

    brake = payload["brake"]
    if brake.get("measured"):
        abs_block = brake.get("abs", {})
        cut = abs_block.get("mean_cut_while_engaged_pct")
        engaged = abs_block.get("engaged_pct_of_braking")
        if engaged is not None and engaged > 0 and cut is not None:
            out.append(
                f"the ABS was working on {engaged:.1f}% of your braking, taking "
                f"back {cut:.1f}% of the pressure you asked for while it was in"
            )
        elif engaged == 0:
            out.append(
                "the car applied every bit of brake pressure you asked for — the "
                "ABS never came in"
            )

    throttle = payload["throttle"]
    slip = throttle.get("slip") if throttle.get("measured") else None
    if slip is not None and slip.get("share_of_on_power_pct", 0) > 0:
        out.append(
            f"a wheel was turning faster than the ground on "
            f"{slip['share_of_on_power_pct']:.1f}% of your time on power"
        )

    steering = payload["steering"]
    if steering.get("measured") and steering.get("falloff_note"):
        out.append(steering["falloff_note"])

    wheel = payload["wheel"]
    if wheel.get("measured") and wheel.get("clipping_pct_of_moving", 0) > 0:
        out.append(
            f"the wheel was against its stops for "
            f"{wheel['clipping_pct_of_moving']:.2f}% of the time you were moving, "
            "so that much of the road never reached your hands"
        )

    if not out:
        out.append(
            "every input this session reached the car without the electronics or "
            "the tires taking a measurable share back out"
        )
    return out
