"""How the run changed from the first lap to the last (module 15).

A stint is not a set of independent laps. Fuel burns off, tire surfaces heat up,
brakes soak, and the driver settles into a rhythm — and every one of those moves
the numbers. This module lays the session out in lap order and reports which of
its measured quantities drifted, and by how much.

What it will NOT do is name a cause. A braking figure that falls over a run is
consistent with brake temperature, with tire surface, with a lighter car, and
with the driver simply braking differently once the lap was learned. One session
cannot separate those, so this module reports the drift and says so out loud.

`wear_masked` is honoured (contract rule 2): iRacing freezes tire wear in
official sessions, so where it is set no wear claim is made at all — but
temperature, grip and brake response are still real measurements and are still
reported, with the masking flagged alongside them.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "stint"

_G = 9.81

_BASIS = "the session's own laps in the order they were driven"
_CAVEAT = (
    "a drift over one run is a description of that run; it names no cause, and "
    "separating tires from brakes from fuel from the driver needs more sessions "
    "than one"
)

_BRAKING = 0.2
_MIN_LAPS_FOR_TREND = 4   # fewer than this and a trend line is drawn through noise
_MIN_BRAKING_TICKS = 20
_PEAK_PCTILE = 98.0


def compute(session: ParsedSession) -> dict:
    laps = [_lap_row(lap) for lap in session.laps]
    laps = [row for row in laps if row is not None]

    if not laps:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no lap in this session carries moving ticks to measure",
            "caveat": _CAVEAT,
        }

    clean = [row for row in laps if row["clean"]]

    payload: dict = {
        "basis": _BASIS,
        "laps": laps,
        "clean_lap_count": len(clean),
        "trends": _trends(clean),
        "fuel": _fuel(laps),
        "caveat": _CAVEAT,
    }
    if session.meta.wear_masked:
        payload["wear"] = {
            "measured": False,
            "reason": (
                "iRacing froze tire wear for this session, so no wear figure is "
                "claimed from it"
            ),
            "note": (
                "temperature, grip and brake response below are still real "
                "measurements — only wear itself is frozen"
            ),
        }
    payload["findings"] = _findings(payload, session)
    return payload


def _lap_row(lap: ParsedLap) -> dict | None:
    """Everything measurable about one lap, for the lap-order series."""
    if "speed" not in lap.raw or len(lap.raw["speed"]) == 0:
        return None
    speed = lap.raw["speed"].astype(np.float64)
    moving = moving_mask(speed)
    if not moving.any():
        return None

    row: dict = {
        "lap": int(lap.lap_number),
        "clean": bool(lap.is_valid and not lap.is_out_lap and not lap.is_anomalous),
        "out_lap": bool(lap.is_out_lap),
        "anomalous": bool(lap.is_anomalous),
        "lap_time_s": None if lap.lap_time_s is None else round(float(lap.lap_time_s), 3),
    }

    lat = lap.raw.get("lat_accel")
    lon = lap.raw.get("long_accel")
    if lat is not None and lon is not None:
        lat_g = np.abs(lat.astype(np.float64)[moving]) / _G
        lon_g = lon.astype(np.float64)[moving] / _G
        row["peak_lateral_g"] = round(float(np.percentile(lat_g, _PEAK_PCTILE)), 3)
        row["peak_braking_g"] = round(
            float(np.percentile(np.maximum(-lon_g, 0.0), _PEAK_PCTILE)), 3
        )
        row["peak_traction_g"] = round(
            float(np.percentile(np.maximum(lon_g, 0.0), _PEAK_PCTILE)), 3
        )

    row.update(_brake_response(lap, moving))
    row.update(_tire_row(lap, moving))

    fuel = lap.raw.get("fuel")
    if fuel is not None and len(fuel):
        f = fuel.astype(np.float64)
        row["fuel_start_l"] = round(float(f[0]), 2)
        row["fuel_end_l"] = round(float(f[-1]), 2)
        # Refuelling makes this negative; report what happened rather than
        # clamping it to a "used" figure that never happened.
        row["fuel_used_l"] = round(float(f[0] - f[-1]), 3)

    return row


def _brake_response(lap: ParsedLap, moving: np.ndarray) -> dict:
    """How much deceleration this lap's braking bought per unit of pedal.

    The pedal is BrakeRaw — the sensor under the driver's foot — so this is the
    car's answer to the driver's request, and it is read only where the pedal was
    genuinely loaded. Stationary ticks are already excluded by `moving`, which
    matters because the sim forces Brake=1.0 with BrakeRaw=0 when parked.
    """
    pedal_ch = lap.raw.get("brake_raw")
    long_ch = lap.raw.get("long_accel")
    if pedal_ch is None or long_ch is None:
        return {}

    pedal = pedal_ch.astype(np.float64)
    braking = moving & (pedal > _BRAKING)
    n = int(np.count_nonzero(braking))
    if n < _MIN_BRAKING_TICKS:
        return {"brake_response_measured": False, "braking_ticks": n}

    decel_g = np.maximum(-long_ch.astype(np.float64)[braking], 0.0) / _G
    asked = pedal[braking]
    loaded = asked > 0.5

    out: dict = {
        "brake_response_measured": True,
        "braking_ticks": n,
        "peak_pedal_pct": round(100.0 * float(asked.max()), 1),
    }
    if int(np.count_nonzero(loaded)) >= 10:
        out["decel_per_pedal_g"] = round(
            float(np.median(decel_g[loaded] / asked[loaded])), 3
        )

    abs_active = lap.raw.get("abs_active")
    if abs_active is not None:
        out["abs_engaged_pct"] = round(
            100.0 * float(abs_active.astype(bool)[braking].mean()), 1
        )
    return out


def _tire_row(lap: ParsedLap, moving: np.ndarray) -> dict:
    """Left-front surface temperature over the lap, and the edge spread.

    Left-front is the only tire-temperature corner the .ibt carries. L/M/R are
    the tire's left, middle and right edges as iRacing records them; which is
    physically inner or outer depends on the corner, so no such claim is made.
    """
    edges = ("l", "m", "r")
    if any(f"lf_temp_{e}" not in lap.raw for e in edges):
        return {"tire_measured": False}

    vals = {}
    for e in edges:
        arr = lap.raw[f"lf_temp_{e}"].astype(np.float64)
        if len(arr) != len(moving) or not moving.any():
            return {"tire_measured": False}
        vals[e] = float(np.mean(arr[moving]))

    return {
        "tire_measured": True,
        "lf_temp_left_c": round(vals["l"], 1),
        "lf_temp_middle_c": round(vals["m"], 1),
        "lf_temp_right_c": round(vals["r"], 1),
        "lf_temp_spread_c": round(max(vals.values()) - min(vals.values()), 1),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Trends
# ─────────────────────────────────────────────────────────────────────────────

_TRACKED = (
    ("lap_time_s", "lap time", "s"),
    ("decel_per_pedal_g", "deceleration per unit of pedal", "g"),
    ("peak_braking_g", "peak braking", "g"),
    ("peak_lateral_g", "peak lateral", "g"),
    ("lf_temp_middle_c", "left-front middle temperature", "°C"),
    ("lf_temp_spread_c", "left-front edge spread", "°C"),
    ("abs_engaged_pct", "share of braking with the ABS in", "%"),
)


def _trends(clean: list[dict]) -> dict:
    if len(clean) < _MIN_LAPS_FOR_TREND:
        return {
            "measured": False,
            "reason": (
                f"only {len(clean)} clean laps — fewer than {_MIN_LAPS_FOR_TREND} "
                "is a line drawn through noise, not a trend"
            ),
        }

    out: dict = {"measured": True, "clean_laps": len(clean), "series": {}}
    for key, label, unit in _TRACKED:
        values = [(i, row[key]) for i, row in enumerate(clean) if row.get(key) is not None]
        if len(values) < _MIN_LAPS_FOR_TREND:
            out["series"][key] = {
                "measured": False,
                "label": label,
                "reason": f"only {len(values)} clean laps carry this figure",
            }
            continue

        x = np.array([v[0] for v in values], dtype=np.float64)
        y = np.array([v[1] for v in values], dtype=np.float64)
        slope = float(np.polyfit(x, y, 1)[0])
        third = max(1, len(y) // 3)
        first = float(np.mean(y[:third]))
        last = float(np.mean(y[-third:]))

        out["series"][key] = {
            "measured": True,
            "label": label,
            "unit": unit,
            "per_lap": round(slope, 5),
            "first_third": round(first, 3),
            "last_third": round(last, 3),
            "change": round(last - first, 3),
            "laps_used": len(y),
        }
    return out


def _fuel(laps: list[dict]) -> dict:
    used = [row["fuel_used_l"] for row in laps if row.get("fuel_used_l") is not None]
    if not used:
        return {"measured": False, "reason": "the file carries no fuel-level channel"}

    burned = [u for u in used if u > 0]
    starts = [row["fuel_start_l"] for row in laps if row.get("fuel_start_l") is not None]
    ends = [row["fuel_end_l"] for row in laps if row.get("fuel_end_l") is not None]

    out: dict = {
        "measured": True,
        "total_used_l": round(float(starts[0] - ends[-1]), 2) if starts and ends else None,
        "laps_counted": len(used),
        "note": (
            "fuel level is a measured channel, so this is a reading rather than "
            "an estimate; it says nothing about what a race stint would need"
        ),
    }
    if burned:
        out["mean_per_lap_l"] = round(float(np.mean(burned)), 3)
        out["max_per_lap_l"] = round(float(np.max(burned)), 3)
    if any(u < -0.05 for u in used):
        out["refuelled"] = True
        out["refuel_note"] = (
            "at least one lap ended with more fuel than it started, so the car "
            "was refuelled during this session"
        )
    return out


def _findings(payload: dict, session: ParsedSession) -> list[str]:
    """Plain sentences describing what drifted, without naming a cause."""
    trends = payload["trends"]
    if not trends.get("measured"):
        return [
            "this run was too short to say anything about how it changed — "
            + str(trends.get("reason", ""))
        ]

    out: list[str] = []
    series = trends["series"]

    lap_time = series.get("lap_time_s", {})
    if lap_time.get("measured"):
        change = lap_time["change"]
        if abs(change) < 0.05:
            out.append(
                f"your pace held flat across {trends['clean_laps']} clean laps — "
                f"the last few averaged within {abs(change):.3f} s of the first few"
            )
        else:
            direction = "quicker" if change < 0 else "slower"
            out.append(
                f"the last third of your clean laps averaged {abs(change):.3f} s "
                f"{direction} than the first third"
            )

    brake = series.get("decel_per_pedal_g", {})
    if brake.get("measured"):
        change = brake["change"]
        if change < -0.02:
            out.append(
                f"the same pedal bought {abs(change):.2f} g less deceleration by "
                f"the end of the run than at the start ({brake['first_third']:.2f} g "
                f"down to {brake['last_third']:.2f} g per unit of pedal)"
            )
        elif change > 0.02:
            out.append(
                f"the same pedal bought {change:.2f} g MORE deceleration by the "
                "end of the run than at the start"
            )
        else:
            out.append(
                "the deceleration your pedal bought stayed level from the first "
                "laps to the last"
            )

    tire = series.get("lf_temp_middle_c", {})
    if tire.get("measured"):
        change = tire["change"]
        if abs(change) >= 1.0:
            direction = "up" if change > 0 else "down"
            out.append(
                f"the left-front's middle surface ran {abs(change):.1f} °C "
                f"{direction} across the run, from {tire['first_third']:.0f} °C "
                f"to {tire['last_third']:.0f} °C"
            )
        else:
            out.append("left-front surface temperature was steady across the run")

    lat = series.get("peak_lateral_g", {})
    if lat.get("measured") and abs(lat["change"]) >= 0.03:
        direction = "less" if lat["change"] < 0 else "more"
        out.append(
            f"you were reaching {abs(lat['change']):.2f} g {direction} lateral "
            "load by the end of the run than at the start"
        )

    if session.meta.wear_masked:
        out.append(
            "tire wear is frozen in this session, so whatever moved above, wear "
            "was not the cause of it"
        )

    return out
