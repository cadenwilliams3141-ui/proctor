"""Session fingerprint: the driver compared against themselves (module 7).

Describes how one session hangs together — fuel burn and pace drift, the
throttle-to-brake handoff style, a fatigue proxy from steering activity, and
frame health. Everything here is descriptive self-comparison: a single
session observes, it does not diagnose, and it never claims causation (the
fuel/pace relationship is reported as "consistent with" at most).

Clean laps are valid, non-anomalous laps. Findings that need more sessions to
be trustworthy carry the payload-level caveat.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "report_card"

_BASIS = "self-comparison within this session"
_CAVEAT = "one session; fingerprints firm up with history"

# A steering-velocity reversal only counts when the wheel actually moved this
# much between ticks; below it the "reversal" is sensor jitter, not input.
_REVERSAL_MIN_RAD_PER_TICK = 0.005


def compute(session: ParsedSession) -> dict:
    tick_rate = session.meta.tick_rate or 60
    clean = [lap for lap in session.laps if lap.is_valid and not lap.is_anomalous]

    return {
        "basis": _BASIS,
        "fuel_fade": _fuel_fade(clean),
        "driving_style": _driving_style(clean, tick_rate),
        "fatigue_curve": _fatigue_curve(clean, tick_rate),
        "frame_health": _frame_health(session),
        "caveat": _CAVEAT,
    }


def _frame_health(session: ParsedSession) -> dict:
    """Min/mean FPS and sub-60 moments — rig-level, so all laps count."""
    parts = [lap.raw["frame_rate"] for lap in session.laps if "frame_rate" in lap.raw]
    if not parts:
        return {"available": False, "reason": "FrameRate not carried into lap objects"}
    fps = np.concatenate(parts).astype(np.float64)
    fps = fps[np.isfinite(fps)]
    if fps.size == 0:
        return {"available": False, "reason": "FrameRate channel carried no samples"}
    tick_rate = session.meta.tick_rate or 60
    sub60 = int(np.count_nonzero(fps < 60.0))
    out = {
        "available": True,
        "min_fps": round(float(fps.min()), 1),
        "mean_fps": round(float(fps.mean()), 1),
        "sub_60_ticks": sub60,
        "sub_60_seconds": round(sub60 / tick_rate, 1),
    }
    if sub60 == 0:
        out["finding"] = "no sub-60 FPS moments"  # negative result worth showing
    return out


def _fuel_fade(clean: list[ParsedLap]) -> dict:
    """Fuel burn per lap and whether pace drifted as the car lightened."""
    if not clean:
        return {"insufficient_data": True, "reason": "no clean laps"}

    burns = np.array(
        [float(l.raw["fuel"][0]) - float(l.raw["fuel"][-1])
         for l in clean if len(l.raw["fuel"])],
        dtype=np.float64,
    )
    burn_median = round(float(np.median(burns)), 3) if burns.size else None
    total_drop = round(float(burns.sum()), 3) if burns.size else None

    times = [l.lap_time_s for l in clean if l.lap_time_s is not None]
    n = len(times)
    if n < 4:
        pace_trend = {
            "insufficient_data": True,
            "reason": f"need >=4 clean laps for a pace trend; have {n}",
        }
        pace_delta = None
        agreement = "insufficient_data"
    else:
        k = min(5, n // 2)
        first_mean = float(np.mean(times[:k]))
        last_mean = float(np.mean(times[-k:]))
        pace_delta = round(last_mean - first_mean, 3)
        pace_trend = {
            "first_laps_mean_s": round(first_mean, 3),
            "last_laps_mean_s": round(last_mean, 3),
            "laps_averaged_each_end": k,
            "pace_delta_s": pace_delta,
        }
        if pace_delta < 0:
            agreement = (
                "pace improved as fuel load dropped — consistent with a lighter "
                "car, not established as causal"
            )
        elif pace_delta > 0:
            agreement = "pace did not improve while fuel dropped"
        else:
            agreement = "pace held flat while fuel dropped"

    out = {
        "fuel_burn_l_per_lap_median": burn_median,
        "total_fuel_drop_l": total_drop,
        "clean_laps": len(clean),
        "pace_trend": pace_trend,
        "pace_delta_s": pace_delta,
        "agreement": agreement,
    }
    if total_drop is not None:
        out["weight_note"] = (
            f"car got lighter by ~{total_drop} liters of fuel over the run"
        )
    return out


def _driving_style(clean: list[ParsedLap], tick_rate: int) -> dict:
    """Median gap between throttle release and brake application (handoff style)."""
    if not clean:
        return {"insufficient_data": True, "reason": "no clean laps"}

    throttle = np.concatenate([l.raw["throttle"] for l in clean])
    brake_raw = np.concatenate([l.raw["brake_raw"] for l in clean])

    # Brake application = brake_raw rising up through 0.1.
    brake_rise = np.flatnonzero((brake_raw[:-1] < 0.1) & (brake_raw[1:] >= 0.1)) + 1
    if brake_rise.size < 5:
        return {
            "insufficient_data": True,
            "reason": f"need >=5 brake applications; found {int(brake_rise.size)}",
        }

    # Throttle release = throttle falling down through 0.1.
    thr_fall = np.flatnonzero((throttle[:-1] >= 0.1) & (throttle[1:] < 0.1)) + 1
    if thr_fall.size == 0:
        return {
            "insufficient_data": True,
            "reason": "no throttle-release crossings to measure against",
        }

    # Nearest release within ±3s of each application, SIGNED: a left-foot
    # braker's release often comes AFTER the brake goes on (negative gap), so
    # a backward-only search would miss the signature entirely and match a
    # stale release from the previous corner.
    window = int(3.0 * tick_rate)
    gaps: list[int] = []
    for r in brake_rise:
        i = int(np.searchsorted(thr_fall, r))
        cands = []
        if i > 0:
            cands.append(int(thr_fall[i - 1]))
        if i < thr_fall.size:
            cands.append(int(thr_fall[i]))
        cands = [c for c in cands if abs(c - int(r)) <= window]
        if cands:
            gaps.append(int(r) - min(cands, key=lambda c: abs(c - int(r))))
    if not gaps:
        return {
            "insufficient_data": True,
            "reason": "no throttle release within 3s of any brake application",
        }

    gaps_ms = np.asarray(gaps, dtype=np.float64) * 1000.0 / tick_rate
    median_ms = round(float(np.median(gaps_ms)), 1)
    if abs(median_ms) <= 50:
        observation = (
            "throttle release and brake application overlap — consistent with "
            "left-foot braking"
        )
    elif median_ms >= 200:
        observation = "distinct gap between throttle release and braking"
    else:
        observation = "mixed"

    return {
        "median_release_to_brake_ms": median_ms,
        "brake_applications": int(brake_rise.size),
        "matched_applications": len(gaps),
        "brake_before_lift_pct": round(100.0 * float((gaps_ms <= 0).mean()), 1),
        "style_observation": observation,
        "note": "signed gap: negative = brake applied before the throttle lift",
    }


def _fatigue_curve(clean: list[ParsedLap], tick_rate: int) -> dict:
    """Steering reversal rate, first third of clean laps vs last third."""
    if len(clean) < 3:
        return {
            "insufficient_data": True,
            "reason": f"need >=3 clean laps to split into thirds; have {len(clean)}",
        }

    third = max(1, len(clean) // 3)
    rate_first = _reversal_rate(clean[:third], tick_rate)
    rate_last = _reversal_rate(clean[-third:], tick_rate)

    if rate_first == 0.0 and rate_last == 0.0:
        ratio = None
        finding = "flat — negligible qualifying steering reversals in either third"
    else:
        ratio = round(rate_last / rate_first, 2) if rate_first > 0 else None
        if rate_first > 0 and abs(rate_last - rate_first) / rate_first <= 0.10:
            finding = "flat — reversal rate held steady late in the session"
        elif rate_last > rate_first:
            finding = "reversal rate rose late in the session"
        else:
            finding = "reversal rate fell late in the session"

    return {
        "first_third_reversals_per_min": round(rate_first, 2),
        "last_third_reversals_per_min": round(rate_last, 2),
        "ratio_last_over_first": ratio,
        "finding": finding,
    }


def _reversal_rate(laps: list[ParsedLap], tick_rate: int) -> float:
    """Meaningful steering-velocity sign changes per minute over these laps."""
    steer = np.concatenate([l.raw["steer"] for l in laps])
    minutes = len(steer) / tick_rate / 60.0
    if minutes <= 0 or len(steer) < 3:
        return 0.0

    vel = np.diff(steer)
    sign = np.sign(vel)
    # A reversal: velocity sign flips AND the wheel actually moved this tick.
    flips = (sign[:-1] * sign[1:] < 0) & (np.abs(vel[1:]) > _REVERSAL_MIN_RAD_PER_TICK)
    return int(np.count_nonzero(flips)) / minutes
