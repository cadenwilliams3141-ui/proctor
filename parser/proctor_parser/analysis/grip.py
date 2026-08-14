"""Demonstrated grip between the tires and the road (module 13).

The question this answers is "how much grip did the car actually have", and the
only honest way to answer it from disk telemetry is to measure the forces that
were there. Three accelerometer channels are enough:

    horizontal = hypot(lat_accel, long_accel)     what the tires produced
    vertical   = |vert_accel|                     what was pressing them down
    mu         = horizontal / vertical            the ratio of the two

That ratio is a friction coefficient in the mechanical sense — force sideways
over force downwards — and it is MEASURED, not modelled. What it is not:

  * It is not the tire's limit. It is the grip the driver used. A lap spent
    tiptoeing reads low because the driver asked for little, not because the
    grip was not there.
  * It is not per-tire. There is one accelerometer on the car, so this is the
    whole car's combined ratio; it cannot say which corner ran out first.
  * vert_accel carries aerodynamic downforce, kerbs, crests and dips as well as
    weight, so on a winged car the LOAD rises with speed. The ratio does not
    follow it up: rubber is load sensitive and gives back less force per unit of
    load the harder it is pressed, so a fast car reads more load, more force and
    a LOWER mu. Both halves are reported by speed band rather than averaged away,
    and `by_load` reports the relationship itself.

Everything is self-comparison inside one session: every "high" and "low" here is
against this driver's own numbers this session, never against a target.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "grip"

_G = 9.81

_BASIS = (
    "measured accelerometer forces in this session: horizontal force over "
    "vertical force, tick by tick"
)
_CAVEAT = (
    "this is the grip you USED, not the grip the tires had; one accelerometer "
    "means it is a whole-car figure and cannot name a single tire"
)
_METHOD = "mu = hypot(lat_accel, long_accel) / |vert_accel|, moving ticks only"

# Below this the vertical reading is too small to divide by — a car mid-crest
# can unload briefly, and a ratio against near-zero load is a divide-by-noise,
# not a measurement of grip.
_MIN_VERT_MS2 = 3.0

# Robust boundary. A single tick at a kerb strike is a bump, not a demonstration
# of grip, so the "peak" reported everywhere here is a high percentile.
#
# CRITICAL: a percentile is only taken over ticks that were DOING the thing.
# Braking g used to be the 98th percentile of max(-long, 0) across the whole
# session, and every non-braking tick contributes a structural zero to that
# array. A driver who brakes for 15% of the lap had their "peak" read off the
# 87th percentile of their braking; one who brakes for 1.5% got a reported peak
# of exactly 0.0 g while braking at 1.5 g. The number moved with how much of the
# lap was spent braking rather than with how hard the car braked, and zero is
# the one value an absence must never be rendered as.
_PEAK_PCTILE = 98.0

# A state needs this many ticks before a percentile over it means anything.
_MIN_STATE_TICKS = 30

# Ticks below this are not in the state at all; they are the structural zeros.
_IN_STATE_G = 0.05

# Speed bands for the downforce story, in m/s. Bands with fewer ticks than the
# minimum are reported as unmeasured rather than averaged from nothing.
_SPEED_BANDS = ((0.0, 25.0), (25.0, 40.0), (40.0, 55.0), (55.0, 70.0), (70.0, 1e9))
_MIN_BAND_TICKS = 60

# Fewer clean laps than this and a stint trend is a line through noise.
_MIN_LAPS_FOR_TREND = 4

# Load bins for the grip-against-load curve, spanning the 1st-99th percentile of
# the load the car actually carried. Trimmed at both ends because one airborne
# tick would otherwise stretch the whole range and leave every real bin crushed
# into the middle of it.
_LOAD_BINS = 12
_MIN_BIN_TICKS = 40

# Pedal/steering gates that split a tick into what the car was being asked for.
_BRAKING = 0.2
_ON_POWER = 0.5
_CORNERING_G = 0.3 * _G


def _insufficient(reason: str) -> dict:
    return {
        "basis": _BASIS,
        "method": _METHOD,
        "insufficient_data": True,
        "reason": reason,
        "caveat": _CAVEAT,
    }


def _lap_arrays(lap: ParsedLap) -> dict[str, np.ndarray] | None:
    """Moving, finite ticks of one lap with the grip ratio attached."""
    needed = ("speed", "lat_accel", "long_accel", "vert_accel")
    if any(k not in lap.raw or len(lap.raw[k]) == 0 for k in needed):
        return None

    speed = lap.raw["speed"].astype(np.float64)
    lat = lap.raw["lat_accel"].astype(np.float64)
    lon = lap.raw["long_accel"].astype(np.float64)
    vert = np.abs(lap.raw["vert_accel"].astype(np.float64))

    moving = moving_mask(speed)
    finite = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(vert)
    loaded = vert >= _MIN_VERT_MS2
    keep = moving & finite & loaded
    if not keep.any():
        return None

    horizontal = np.hypot(lat[keep], lon[keep])
    return {
        # Counted, not silently dropped. The low-load guard removes exactly the
        # ticks where the ratio would be largest, so a session with many of them
        # is one where the reported grip is conservative for a reason the reader
        # is entitled to know about.
        "_counts": {
            "stationary_excluded": int(np.count_nonzero(~moving)),
            "low_load_excluded": int(np.count_nonzero(moving & finite & ~loaded)),
            "non_finite_excluded": int(np.count_nonzero(moving & ~finite)),
            "kept": int(np.count_nonzero(keep)),
        },
        "speed": speed[keep],
        "lat": lat[keep],
        "long": lon[keep],
        "vert": vert[keep],
        "horizontal": horizontal,
        "mu": horizontal / vert[keep],
        "combined_g": horizontal / _G,
        "load_g": vert[keep] / _G,
        "dist": lap.raw["dist"].astype(np.float64)[keep],
        "brake": lap.raw["brake_raw"].astype(np.float64)[keep]
        if "brake_raw" in lap.raw
        else np.zeros(int(keep.sum())),
        "throttle": lap.raw["throttle"].astype(np.float64)[keep]
        if "throttle" in lap.raw
        else np.zeros(int(keep.sum())),
    }


def compute(session: ParsedSession) -> dict:
    per_lap_arrays: dict[int, dict[str, np.ndarray]] = {}
    for lap in session.laps:
        arrays = _lap_arrays(lap)
        if arrays is not None:
            per_lap_arrays[lap.lap_number] = arrays

    if not per_lap_arrays:
        return _insufficient(
            "no moving ticks carry all three accelerometer channels with a "
            "usable vertical load"
        )

    everything = {
        key: np.concatenate([a[key] for a in per_lap_arrays.values()])
        for key in ("mu", "combined_g", "load_g", "speed", "lat", "long", "brake", "throttle")
    }

    excluded = {
        key: int(sum(a["_counts"][key] for a in per_lap_arrays.values()))
        for key in ("stationary_excluded", "low_load_excluded", "non_finite_excluded", "kept")
    }

    payload: dict = {
        "basis": _BASIS,
        "method": _METHOD,
        "ticks_excluded": {
            **excluded,
            "note": (
                "stationary ticks are excluded because the sim forces the brake on "
                "when the car is stopped; low-load ticks are excluded because a "
                "ratio against near-zero vertical load is a divide-by-noise, and "
                "those are exactly the ticks that would read as the most grip"
            ),
        },
        "session": _session_block(everything),
        "by_speed": _by_speed(everything),
        "by_load": _by_load(everything),
        "by_input_state": _by_input_state(everything),
        "laps": _by_lap(session, per_lap_arrays),
        "corners": _by_corner(session, per_lap_arrays),
        "caveat": _CAVEAT,
    }
    payload["stint"] = _stint_trend(session, payload["laps"])
    payload["finding"] = _finding(payload)
    return payload


def _directional_peak(values_g: np.ndarray) -> tuple[float | None, int, str | None]:
    """Peak of a one-sided quantity, over the ticks that were doing it.

    `values_g` has already been clipped at zero, so every tick that was not in
    the state reads exactly 0. Those are excluded before the percentile rather
    than counted as small values — including them measures the SHARE of the lap
    spent in the state, not the force reached while in it.
    """
    in_state = values_g > _IN_STATE_G
    n = int(np.count_nonzero(in_state))
    if n < _MIN_STATE_TICKS:
        return None, n, f"only {n} ticks above {_IN_STATE_G} g — too few to take a peak from"
    return round(float(np.percentile(values_g[in_state], _PEAK_PCTILE)), 3), n, None


def _session_block(a: dict[str, np.ndarray]) -> dict:
    """The whole session's demonstrated grip, in one block."""
    braking_g, braking_n, braking_why = _directional_peak(np.maximum(-a["long"], 0.0) / _G)
    traction_g, traction_n, traction_why = _directional_peak(np.maximum(a["long"], 0.0) / _G)
    lateral_g, lateral_n, lateral_why = _directional_peak(np.abs(a["lat"]) / _G)

    return {
        "peak_mu": round(float(np.percentile(a["mu"], _PEAK_PCTILE)), 3),
        "median_mu": round(float(np.median(a["mu"])), 3),
        "peak_combined_g": round(float(np.percentile(a["combined_g"], _PEAK_PCTILE)), 3),
        # Null, never 0, when the state was too rare to take a peak from. A zero
        # here would read as "the car never braked hard", which is a claim.
        "peak_lateral_g": lateral_g,
        "lateral_ticks": lateral_n,
        "lateral_reason": lateral_why,
        "peak_braking_g": braking_g,
        "braking_ticks": braking_n,
        "braking_reason": braking_why,
        "peak_traction_g": traction_g,
        "traction_ticks": traction_n,
        "traction_reason": traction_why,
        "median_vertical_load_g": round(float(np.median(a["load_g"])), 3),
        "peak_vertical_load_g": round(float(np.percentile(a["load_g"], _PEAK_PCTILE)), 3),
        "ticks": int(a["mu"].size),
        "note": (
            "peak figures are the 98th percentile of the ticks that were doing "
            "the thing — one kerb strike is a bump, and a lap spent mostly not "
            "braking must not drag the braking figure down"
        ),
    }


def _by_speed(a: dict[str, np.ndarray]) -> dict:
    """Grip against speed. On a winged car this is the downforce story."""
    bands: list[dict] = []
    for lo, hi in _SPEED_BANDS:
        in_band = (a["speed"] >= lo) & (a["speed"] < hi)
        n = int(np.count_nonzero(in_band))
        label = f"{lo * 3.6:.0f}+ km/h" if hi > 1e8 else f"{lo * 3.6:.0f}-{hi * 3.6:.0f} km/h"
        if n < _MIN_BAND_TICKS:
            bands.append({
                "band": label,
                "ticks": n,
                "measured": False,
                "reason": f"only {n} ticks in this band, too few to speak for",
            })
            continue
        bands.append({
            "band": label,
            "ticks": n,
            "measured": True,
            "peak_mu": round(float(np.percentile(a["mu"][in_band], _PEAK_PCTILE)), 3),
            "peak_combined_g": round(
                float(np.percentile(a["combined_g"][in_band], _PEAK_PCTILE)), 3
            ),
            "median_vertical_load_g": round(float(np.median(a["load_g"][in_band])), 3),
        })

    measured = [b for b in bands if b.get("measured")]
    out: dict = {"bands": bands}
    if len(measured) >= 2:
        low, high = measured[0], measured[-1]
        load_change = high["median_vertical_load_g"] - low["median_vertical_load_g"]
        mu_change = high["peak_mu"] - low["peak_mu"]

        # Downforce is read off the LOAD column, not the mu column.
        #
        # This used to conclude "downforce" from mu rising with speed, which is
        # the wrong signature and usually the opposite of what happens. Downforce
        # presses the car down: it shows up as VERTICAL LOAD rising with speed.
        # The tire's mu then FALLS as that load rises, because rubber is load
        # sensitive — so a winged car reads more load, more cornering force, and
        # LESS mu at speed, and the old test called that "no downforce".
        #
        # Median load per band is also the least confounded column here: peak mu
        # and peak force both depend on whether the driver was cornering hard in
        # that band, and the top band is mostly straight-line running.
        out["fastest_vs_slowest"] = {
            "slowest_band": low["band"],
            "fastest_band": high["band"],
            "load_change_g": round(load_change, 3),
            "peak_mu_change": round(mu_change, 3),
            "downforce_note": (
                f"vertical load rose {load_change:.2f} g from the slowest band to "
                "the fastest, which is what aerodynamic downforce looks like in "
                "these channels"
                if load_change > 0.05
                else "vertical load did not rise with speed in this session's data"
            ),
            "mu_note": (
                f"the grip ratio fell {abs(mu_change):.2f} as load rose — rubber "
                "gives back less force per unit of load the harder it is pressed, "
                "so more downforce and a lower ratio are the same story"
                if mu_change < -0.05
                else (
                    f"the grip ratio rose {mu_change:.2f} with speed"
                    if mu_change > 0.05
                    else "the grip ratio held roughly level across the speed range"
                )
            ),
        }
    else:
        out["finding"] = "too few populated speed bands to compare high speed against low"
    return out


def _by_load(a: dict[str, np.ndarray]) -> dict:
    """Horizontal force against the vertical load that produced it.

    This is the measurement the rest of the module is a summary of, and the one
    a single `peak_mu` cannot carry. mu = horizontal / vertical is a RATIO, so
    its highest values come from the ticks where the denominator was smallest —
    a crest, a light moment over a kerb. Ranking ticks by that ratio therefore
    finds the car at its lightest rather than at its most planted, and calling
    the result "peak grip" reads as a claim about the tires.

    Binning by load instead asks the question that has an answer: at THIS much
    load, how much force came back. Three things fall out of the shape:

      * how far right the bins reach   — how much load the car ever carried,
                                          which is weight plus downforce
      * whether the envelope bends     — rubber is load sensitive, so force per
        below a straight line             unit of load falls as load rises
      * how far the cloud sits below   — how much of the available grip went
        the envelope                      unused, which is commitment, not tire

    Still demonstrated grip, not tire capability: a bin the driver never pushed
    in reads low because nothing asked for more.
    """
    load = a["load_g"]
    if load.size == 0:
        return {"measured": False, "reason": "no ticks with a usable vertical load"}

    lo = float(np.percentile(load, 1))
    hi = float(np.percentile(load, 99))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 0.05:
        return {
            "measured": False,
            "reason": (
                f"vertical load barely moved in this session (spread {hi - lo:.3f} g), "
                "so there is no load range to describe grip across"
            ),
        }

    edges = np.linspace(lo, hi, _LOAD_BINS + 1)
    bins: list[dict] = []
    for i in range(_LOAD_BINS):
        in_bin = (load >= edges[i]) & (load < edges[i + 1] if i < _LOAD_BINS - 1 else load <= edges[i + 1])
        n = int(np.count_nonzero(in_bin))
        centre = round(float((edges[i] + edges[i + 1]) / 2), 3)
        if n < _MIN_BIN_TICKS:
            bins.append({
                "load_g": centre,
                "ticks": n,
                "measured": False,
                "reason": f"only {n} ticks at this load",
            })
            continue
        peak_h = float(np.percentile(a["combined_g"][in_bin], _PEAK_PCTILE))
        bins.append({
            "load_g": centre,
            "ticks": n,
            "measured": True,
            "peak_horizontal_g": round(peak_h, 3),
            "median_horizontal_g": round(float(np.median(a["combined_g"][in_bin])), 3),
            # The ratio at the bin's own load, so it is comparable across bins.
            "peak_mu": round(peak_h / centre, 3) if centre > 0 else None,
        })

    measured = [b for b in bins if b.get("measured")]
    out: dict = {
        "measured": len(measured) >= 2,
        "bins": bins,
        "load_range_g": [round(lo, 3), round(hi, 3)],
    }
    if len(measured) < 2:
        out["reason"] = "fewer than two load bins carried enough ticks to compare"
        return out

    first, last = measured[0], measured[-1]
    out["lightest_bin"] = {"load_g": first["load_g"], "peak_mu": first["peak_mu"]}
    out["heaviest_bin"] = {"load_g": last["load_g"], "peak_mu": last["peak_mu"]}

    # The slope across ALL measured bins, weighted by how many ticks each bin
    # holds — not first bin against last.
    #
    # Comparing the endpoints is what the speed-band block used to do and it is
    # wrong here for a specific reason: the lightest bins are crest and kerb
    # moments, where the car is unloaded AND the driver is not asking for
    # anything, so they read low on commitment rather than on grip. On real data
    # they sit at a few dozen ticks against a few thousand in the middle. Taking
    # the endpoints let those bins set the sign of the finding, and they
    # reported "grip rose with load" for a tire that plainly lost 0.4 of ratio
    # across the range. Weighting by ticks lets the populated middle decide it.
    loads = np.array([b["load_g"] for b in measured], dtype=np.float64)
    mus = np.array([b["peak_mu"] for b in measured], dtype=np.float64)
    weights = np.array([b["ticks"] for b in measured], dtype=np.float64)
    slope = float(np.polyfit(loads, mus, 1, w=np.sqrt(weights))[0])
    span = float(loads[-1] - loads[0])
    mu_change = slope * span

    out["mu_per_g_of_load"] = round(slope, 3)
    out["mu_change_across_load"] = round(mu_change, 3)
    mu_drop = -mu_change
    out["load_sensitivity_note"] = (
        f"force per unit of load fell {mu_drop:.2f} across the {span:.2f} g of load "
        "this session covered — the signature of load-sensitive rubber"
        if mu_drop > 0.05
        else (
            f"force per unit of load rose {abs(mu_drop):.2f} as load increased, which "
            "is not the usual direction for a tire and is worth a second session "
            "before reading anything into it"
            if mu_drop < -0.05
            else "force per unit of load held roughly level across the load range"
        )
    )
    return out


def _by_input_state(a: dict[str, np.ndarray]) -> dict:
    """Where the grip went: braking, cornering, or putting the power down."""
    braking = a["brake"] > _BRAKING
    on_power = (~braking) & (a["throttle"] > _ON_POWER)
    cornering = np.abs(a["lat"]) > _CORNERING_G

    def block(mask: np.ndarray, name: str) -> dict:
        n = int(np.count_nonzero(mask))
        if n < _MIN_BAND_TICKS:
            return {
                "state": name,
                "ticks": n,
                "measured": False,
                "reason": f"only {n} ticks in this state",
            }
        return {
            "state": name,
            "ticks": n,
            "measured": True,
            "peak_mu": round(float(np.percentile(a["mu"][mask], _PEAK_PCTILE)), 3),
            "median_mu": round(float(np.median(a["mu"][mask])), 3),
        }

    return {
        "braking": block(braking, "braking"),
        "cornering": block(cornering, "cornering"),
        "on_power": block(on_power, "on power"),
        "combined": block(braking & cornering, "braking while cornering"),
        "note": (
            "states overlap on purpose — trail braking is in both 'braking' and "
            "'cornering', which is the point of measuring them separately"
        ),
    }


def _by_lap(session: ParsedSession, arrays: dict[int, dict[str, np.ndarray]]) -> list[dict]:
    """Per-lap grip, in lap order, clean laps marked."""
    out: list[dict] = []
    for lap in session.laps:
        a = arrays.get(lap.lap_number)
        if a is None:
            continue
        clean = bool(lap.is_valid and not lap.is_out_lap and not lap.is_anomalous)
        out.append({
            "lap": int(lap.lap_number),
            "clean": clean,
            "lap_time_s": None if lap.lap_time_s is None else round(float(lap.lap_time_s), 3),
            "peak_mu": round(float(np.percentile(a["mu"], _PEAK_PCTILE)), 3),
            "median_mu": round(float(np.median(a["mu"])), 3),
            "peak_combined_g": round(float(np.percentile(a["combined_g"], _PEAK_PCTILE)), 3),
            "peak_lateral_g": round(
                float(np.percentile(np.abs(a["lat"]) / _G, _PEAK_PCTILE)), 3
            ),
            "peak_braking_g": round(
                float(np.percentile(np.maximum(-a["long"], 0.0) / _G, _PEAK_PCTILE)), 3
            ),
        })
    return out


def _by_corner(session: ParsedSession, arrays: dict[int, dict[str, np.ndarray]]) -> dict:
    """Peak grip demonstrated in each corner of this driver's own reference line."""
    ref = _reference_lap(session)
    if ref is None:
        return {
            "measured": False,
            "reason": "no valid lap to detect corners from",
        }

    corners = detect_corners(
        ref.grid["speed"],
        ref.grid["grid_pct"],
        ref.grid.get("lat_gps"),
        ref.grid.get("lon_gps"),
    )
    if not corners:
        return {
            "measured": False,
            "reason": "no prominent speed minima in the reference lap — no corners detected",
        }

    # Every clean lap's ticks pooled per corner: a corner's grip is a property of
    # the corner across the session, not of one lap through it.
    pooled = {
        lap.lap_number: arrays[lap.lap_number]
        for lap in session.laps
        if lap.lap_number in arrays and lap.is_valid and not lap.is_anomalous
    }
    if not pooled:
        pooled = arrays

    rows: list[dict] = []
    for corner in corners:
        mus: list[np.ndarray] = []
        lats: list[np.ndarray] = []
        for a in pooled.values():
            inside = (a["dist"] >= corner["start_pct"]) & (a["dist"] <= corner["end_pct"])
            if inside.any():
                mus.append(a["mu"][inside])
                lats.append(np.abs(a["lat"][inside]) / _G)
        if not mus:
            rows.append({
                "id": corner["id"],
                "measured": False,
                "reason": "no moving ticks fell inside this corner's window",
            })
            continue
        mu = np.concatenate(mus)
        lat = np.concatenate(lats)
        row = {
            "id": corner["id"],
            "measured": True,
            "start_pct": corner["start_pct"],
            "apex_pct": corner["apex_pct"],
            "end_pct": corner["end_pct"],
            "peak_mu": round(float(np.percentile(mu, _PEAK_PCTILE)), 3),
            "peak_lateral_g": round(float(np.percentile(lat, _PEAK_PCTILE)), 3),
            "ticks": int(mu.size),
        }
        if corner.get("radius_m") is not None:
            row["radius_m"] = corner["radius_m"]
            row["dir"] = corner.get("dir")
        rows.append(row)

    measured = [r for r in rows if r.get("measured")]
    out: dict = {"measured": True, "corners": rows, "laps_pooled": len(pooled)}
    if measured:
        best = max(measured, key=lambda r: r["peak_mu"])
        worst = min(measured, key=lambda r: r["peak_mu"])
        out["most_grip"] = {"id": best["id"], "peak_mu": best["peak_mu"]}
        out["least_grip"] = {"id": worst["id"], "peak_mu": worst["peak_mu"]}
    return out


def _stint_trend(session: ParsedSession, laps: list[dict]) -> dict:
    """Did the grip you were reaching change over the run?"""
    clean = [l for l in laps if l["clean"]]
    if len(clean) < _MIN_LAPS_FOR_TREND:
        return {
            "measured": False,
            "reason": (
                f"only {len(clean)} clean laps — fewer than {_MIN_LAPS_FOR_TREND} is "
                "a line drawn through noise, not a trend"
            ),
        }

    x = np.arange(len(clean), dtype=np.float64)
    y = np.array([l["peak_mu"] for l in clean], dtype=np.float64)
    slope = float(np.polyfit(x, y, 1)[0])

    third = max(1, len(clean) // 3)
    first_mean = float(np.mean(y[:third]))
    last_mean = float(np.mean(y[-third:]))

    out = {
        "measured": True,
        "clean_laps": len(clean),
        "peak_mu_per_lap": round(slope, 5),
        "first_third_peak_mu": round(first_mean, 3),
        "last_third_peak_mu": round(last_mean, 3),
        "change": round(last_mean - first_mean, 3),
        "caveat": (
            "a fall here is the grip you REACHED falling, which can be the tires, "
            "the fuel load, the track, or you settling into a pace — one session "
            "cannot separate those"
        ),
    }
    if session.meta.wear_masked:
        out["wear_masked"] = True
        out["wear_note"] = (
            "tire wear is frozen in this session, so whatever moved here, it was "
            "not wear"
        )
    return out


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, else fastest valid (contract rule 4)."""
    valid = [l for l in session.laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def _finding(payload: dict) -> str:
    """One plain sentence naming what the numbers above showed."""
    peak = payload["session"]["peak_mu"]
    states = payload["by_input_state"]
    measured = [
        (key, block)
        for key, block in states.items()
        if isinstance(block, dict) and block.get("measured")
    ]
    if not measured:
        return f"peak demonstrated grip {peak:.2f} g of force per g of load"

    strongest = max(measured, key=lambda kv: kv[1]["peak_mu"])
    return (
        f"peak demonstrated grip was {peak:.2f} g of horizontal force per g of "
        f"vertical load, and the highest of it came while {strongest[1]['state']}"
    )
