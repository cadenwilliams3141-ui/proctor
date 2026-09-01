"""What happened between the driver, the car and the ground (module 18).

Every other module reads what the driver ASKED for and what the car DID. This
one reads the three quantities in between — the ones a driver feels but cannot
see — and it is built entirely from channels the parser has always required and
never carried into lap objects until now.

  1. SLIP ANGLE. beta = atan2(vel_y, vel_x): the angle between where the car is
     pointing and where it is actually travelling. This is a MEASUREMENT, not a
     fit — VelocityX and VelocityY are the sim's own velocity vector in the
     car's own frame, so no wheelbase, steering ratio or tyre model appears
     anywhere in it. balance.py answers the same question by fitting expected
     yaw and reading the residual; this answers it directly, which is why both
     are kept and their agreement is reported.

  2. ROTATION AGAINST THE PATH. A car on a steady circular path has yaw rate
     lat_accel / speed. The difference between that and the measured YawRate is
     d(beta)/dt, so (1) and (2) are two views of one quantity and must agree in
     sign — a useful internal check, and the reason both are computed here
     rather than in separate modules.

  3. SELF-ALIGNING TORQUE AGAINST LOCK. SteeringWheelTorque in Nm, binned by
     how much lock was applied. Front tyres past their peak slip angle return
     LESS torque for MORE lock, so the band where this curve turns over is the
     front axle giving up, measured on the driver's own data. input_response.py
     bins the same lock against LATERAL G; this bins it against the force that
     actually reaches the driver's hands, and the band edges are shared so the
     two read side by side.

  4. ROAD GRADE. LongAccel includes the component of gravity along a slope, so
     braking g is overstated downhill and understated uphill. Grade comes from
     Alt against distance travelled; both the corrected and uncorrected figures
     are reported, never one silently replacing the other.

WHAT THIS MODULE WILL NOT DO. It does not report per-tyre load in kilograms.
Turning lateral and longitudinal g into wheel loads needs centre-of-gravity
height, track width and wheelbase — per-car constants, which is exactly what
the self-envelope thesis exists to avoid. The force on the car is reported in
g, and the payload says plainly that the per-tyre split is not available.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "contact_patch"

_BASIS = "the car's own velocity, yaw and column-torque channels, this session"
_METHOD = (
    "slip angle = atan2(vel_y, vel_x); path yaw rate = lat_accel / speed; "
    "self-aligning torque binned by steering lock; grade from altitude over "
    "distance. No tyre model and no per-car constants"
)
_CAVEAT = (
    "single-session self-comparison; every figure is what this car did on this "
    "run, never a limit of the car or a target"
)

_G = 9.81
_MIN_TICKS = 40           # below this a block reports itself unmeasured
_MIN_BIN_TICKS = 40
_MIN_CORNER_TICKS = 20
# Shared with input_response._STEER_BINS_DEG on purpose: the torque-vs-lock and
# lateral-g-vs-lock panels are read against each other, so the bands must match.
_STEER_BINS_DEG = (0.0, 20.0, 45.0, 75.0, 110.0, 150.0, 1e9)
# Slip angle is only meaningful with real forward speed. Below this the lateral
# component is noise and atan2 swings wildly for no physical reason.
_MIN_SPEED_FOR_SLIP = 8.0
# A grade beyond this is a GPS/altitude dropout, not a road.
_MAX_PLAUSIBLE_GRADE = 0.30
_PEAK_PCTILE = 98


def compute(session: ParsedSession) -> dict:
    laps = [lap for lap in session.laps if _usable(lap)]
    if not laps:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": "no lap in this session carries the channels this needs",
            "caveat": _CAVEAT,
        }

    return {
        "basis": _BASIS,
        "method": _METHOD,
        "slip": _slip(laps),
        "rotation": _rotation(laps),
        "steer_torque": _torque_vs_lock(laps),
        "grade": _grade(laps, session),
        "corners": _by_corner(session),
        "per_tire_load": {
            "available": False,
            "reason": (
                "splitting the car's force between four tyres needs centre-of-"
                "gravity height, track width and wheelbase — per-car constants "
                "this app does not hold and will not guess"
            ),
            "note": (
                "the whole-car force IS measured and reported in g; only the "
                "per-tyre split is unavailable"
            ),
        },
        "caveat": _CAVEAT,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Gathering
# ─────────────────────────────────────────────────────────────────────────────

_NEEDED = ("speed", "vel_x", "vel_y", "yaw_rate", "lat_accel", "steer", "steer_torque")


def _usable(lap: ParsedLap) -> bool:
    """A lap this module can read: valid, and carrying every channel it needs."""
    if not lap.is_valid or "speed" not in lap.raw or len(lap.raw["speed"]) == 0:
        return False
    return all(k in lap.raw and len(lap.raw[k]) == len(lap.raw["speed"]) for k in _NEEDED)


def _gather(laps: list[ParsedLap], *keys: str) -> dict[str, np.ndarray]:
    """Concatenate the named raw channels across laps, moving ticks only."""
    out: dict[str, list[np.ndarray]] = {k: [] for k in keys}
    for lap in laps:
        moving = moving_mask(lap.raw["speed"])
        if not moving.any():
            continue
        for k in keys:
            out[k].append(lap.raw[k].astype(np.float64)[moving])
    return {k: (np.concatenate(v) if v else np.empty(0)) for k, v in out.items()}


def _unmeasured(reason: str) -> dict:
    return {"measured": False, "reason": reason}


def _finite(*arrays: np.ndarray) -> np.ndarray:
    """Ticks where every one of these arrays is a real number."""
    keep = np.ones(len(arrays[0]), dtype=bool)
    for a in arrays:
        keep &= np.isfinite(a)
    return keep


# ─────────────────────────────────────────────────────────────────────────────
# 1. Slip angle
# ─────────────────────────────────────────────────────────────────────────────

def _slip_angle_deg(vel_x: np.ndarray, vel_y: np.ndarray) -> np.ndarray:
    """Degrees between where the car points and where it is going.

    Positive is one side and negative the other; which side is which is the
    sim's convention, so the module reports magnitudes and only ever compares
    signs WITHIN itself (against the corner's own direction), never asserting
    that positive means left."""
    return np.degrees(np.arctan2(vel_y, vel_x))


def _slip(laps: list[ParsedLap]) -> dict:
    ch = _gather(laps, "speed", "vel_x", "vel_y")
    if ch["speed"].size == 0:
        return _unmeasured("no moving ticks in this session")

    keep = _finite(ch["vel_x"], ch["vel_y"], ch["speed"]) & (ch["speed"] >= _MIN_SPEED_FOR_SLIP)
    n = int(np.count_nonzero(keep))
    if n < _MIN_TICKS:
        return _unmeasured(
            f"only {n} ticks above {_MIN_SPEED_FOR_SLIP:.0f} m/s, where slip angle means anything"
        )

    beta = _slip_angle_deg(ch["vel_x"][keep], ch["vel_y"][keep])
    mag = np.abs(beta)
    return {
        "measured": True,
        "ticks": n,
        "peak_deg": round(float(np.percentile(mag, _PEAK_PCTILE)), 2),
        "median_deg": round(float(np.median(mag)), 2),
        "highest_single_tick_deg": round(float(mag.max()), 2),
        "note": (
            "the angle between where the car was pointing and where it was "
            "actually travelling. Measured from the car's own velocity vector, "
            "not fitted. The peak is the 98th percentile, so one kerb strike "
            "cannot stand in for the session"
        ),
        "speed_floor_note": (
            f"ticks below {_MIN_SPEED_FOR_SLIP:.0f} m/s are excluded — at low "
            "speed the lateral component is sensor noise and the angle swings "
            "for no physical reason"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Rotation against the path
# ─────────────────────────────────────────────────────────────────────────────

def _rotation(laps: list[ParsedLap]) -> dict:
    ch = _gather(laps, "speed", "yaw_rate", "lat_accel", "vel_x", "vel_y")
    if ch["speed"].size == 0:
        return _unmeasured("no moving ticks in this session")

    keep = _finite(ch["yaw_rate"], ch["lat_accel"], ch["speed"]) & (
        ch["speed"] >= _MIN_SPEED_FOR_SLIP
    )
    n = int(np.count_nonzero(keep))
    if n < _MIN_TICKS:
        return _unmeasured(f"only {n} ticks fast enough to compare rotation against path")

    speed = ch["speed"][keep]
    yaw_rate = ch["yaw_rate"][keep]
    # Yaw rate a steady circular path would need. speed is already >= the floor,
    # so no clipping is required, but guard the division anyway (contract 5).
    path_rate = ch["lat_accel"][keep] / np.maximum(speed, 1.0)
    diff = yaw_rate - path_rate

    # Sign convention differs between YawRate and LatAccel in some builds, so
    # the module reports the CORRELATION rather than asserting which way round
    # they run. A strong negative correlation means the two channels simply
    # disagree in sign; the magnitudes are still comparable either way.
    if np.std(yaw_rate) < 1e-9 or np.std(path_rate) < 1e-9:
        agreement = None
    else:
        agreement = round(float(np.corrcoef(yaw_rate, path_rate)[0, 1]), 3)

    rotating_more = float(np.mean(np.abs(yaw_rate) > np.abs(path_rate))) * 100.0
    return {
        "measured": True,
        "ticks": n,
        "median_abs_difference_rad_s": round(float(np.median(np.abs(diff))), 4),
        "peak_abs_difference_rad_s": round(float(np.percentile(np.abs(diff), _PEAK_PCTILE)), 4),
        "rotated_more_than_path_pct": round(rotating_more, 1),
        "path_agreement": agreement,
        "note": (
            "a car on a steady circular path turns at lat_accel / speed. The "
            "gap between that and the yaw rate actually measured is the rate "
            "the slip angle was changing — the car rotating into or out of the "
            "corner rather than simply following it"
        ),
        "agreement_note": (
            "path_agreement is the correlation between measured and path yaw "
            "rate. Near 1 or -1 means the two channels track each other and "
            "only their sign convention differs; near 0 would mean this "
            "comparison is not reading what it thinks it is"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Self-aligning torque against lock
# ─────────────────────────────────────────────────────────────────────────────

def _band_label(lo: float, hi: float) -> str:
    return f"{lo:.0f}°+" if hi > 1e8 else f"{lo:.0f}-{hi:.0f}°"


def _band_start(label: str) -> float:
    return float(label.split("-")[0].rstrip("°+"))


def _torque_vs_lock(laps: list[ParsedLap]) -> dict:
    ch = _gather(laps, "speed", "steer", "steer_torque")
    if ch["speed"].size == 0:
        return _unmeasured("no moving ticks in this session")

    keep = _finite(ch["steer"], ch["steer_torque"])
    deg = np.degrees(np.abs(ch["steer"][keep]))
    torque = np.abs(ch["steer_torque"][keep])
    if deg.size < _MIN_TICKS:
        return _unmeasured(f"only {deg.size} moving ticks carry both lock and column torque")

    bands: list[dict] = []
    for lo, hi in zip(_STEER_BINS_DEG[:-1], _STEER_BINS_DEG[1:]):
        inside = (deg >= lo) & (deg < hi)
        count = int(np.count_nonzero(inside))
        label = _band_label(lo, hi)
        if count < _MIN_BIN_TICKS:
            bands.append({
                "band": label,
                "ticks": count,
                "measured": False,
                "reason": f"only {count} ticks at this much lock",
            })
            continue
        bands.append({
            "band": label,
            "ticks": count,
            "measured": True,
            "median_torque_nm": round(float(np.median(torque[inside])), 2),
            "peak_torque_nm": round(float(np.percentile(torque[inside], _PEAK_PCTILE)), 2),
        })

    out: dict = {
        "measured": True,
        "ticks": int(deg.size),
        "bands": bands,
        "peak_torque_nm": round(float(np.percentile(torque, _PEAK_PCTILE)), 2),
        "median_torque_nm": round(float(np.median(torque)), 2),
        "note": (
            "how hard the front tyres pushed back through the column for each "
            "amount of lock. Torque that keeps climbing means the front axle "
            "still had more to give; torque that turns over while lock keeps "
            "rising is the front tyres past their best slip angle — the thing a "
            "driver feels as the wheel going light"
        ),
        "bands_note": (
            "band edges match input_response's lateral-g bands so the two can "
            "be read against each other"
        ),
    }

    measured = [b for b in bands if b.get("measured")]
    if len(measured) >= 2:
        best = max(measured, key=lambda b: b["median_torque_nm"])
        out["most_torque_band"] = best["band"]
        beyond = [b for b in measured if _band_start(b["band"]) > _band_start(best["band"])]
        if beyond:
            lowest_beyond = min(b["median_torque_nm"] for b in beyond)
            drop = best["median_torque_nm"] - lowest_beyond
            out["falloff_past_peak_nm"] = round(float(drop), 2)
            out["falloff_note"] = (
                f"past {best['band']} of lock the wheel gave back "
                f"{drop:.2f} Nm LESS, not more"
                if drop > 0
                else "torque kept rising with lock across every band used"
            )
        else:
            out["falloff_past_peak_nm"] = None
            out["falloff_note"] = (
                f"{best['band']} is the most lock measured this session, so "
                "nothing here shows what lies past it"
            )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 4. Road grade
# ─────────────────────────────────────────────────────────────────────────────

def _grade(laps: list[ParsedLap], session: ParsedSession) -> dict:
    if not all("alt" in lap.raw and "long_accel" in lap.raw for lap in laps):
        return _unmeasured("this session does not carry altitude")

    track_m = (session.meta.track_length_km or 0.0) * 1000.0
    if track_m <= 0:
        return _unmeasured("track length is unknown, so distance per tick cannot be scaled")

    grades: list[np.ndarray] = []
    raw_decel: list[np.ndarray] = []
    corrected: list[np.ndarray] = []

    for lap in laps:
        moving = moving_mask(lap.raw["speed"])
        if int(np.count_nonzero(moving)) < _MIN_TICKS:
            continue
        alt = lap.raw["alt"].astype(np.float64)[moving]
        dist = lap.raw["dist"].astype(np.float64)[moving] * track_m
        long_accel = lap.raw["long_accel"].astype(np.float64)[moving]
        brake = lap.raw["brake_raw"].astype(np.float64)[moving]

        d_alt = np.gradient(alt)
        d_dist = np.gradient(dist)
        # A lap wraps 1 -> 0 at the line, which makes one d_dist hugely negative.
        # Guarding on magnitude drops that sample rather than inventing a cliff.
        ok = np.isfinite(d_alt) & np.isfinite(d_dist) & (np.abs(d_dist) > 0.01)
        if not ok.any():
            continue
        grade = np.zeros_like(d_alt)
        grade[ok] = d_alt[ok] / d_dist[ok]
        ok &= np.abs(grade) <= _MAX_PLAUSIBLE_GRADE

        braking = ok & (brake > 0.2)
        if braking.any():
            # Uphill (positive grade) already helps you stop, so the road is
            # doing part of the work the brakes are being credited with.
            gravity_term = _G * np.sin(np.arctan(grade[braking]))
            raw_decel.append(np.abs(long_accel[braking]) / _G)
            corrected.append(np.abs(long_accel[braking] + gravity_term) / _G)
        grades.append(grade[ok])

    if not grades:
        return _unmeasured("no lap had enough moving ticks with usable altitude")

    all_grades = np.concatenate(grades)
    out: dict = {
        "measured": True,
        "ticks": int(all_grades.size),
        "steepest_climb_pct": round(float(np.percentile(all_grades, _PEAK_PCTILE) * 100.0), 2),
        "steepest_descent_pct": round(float(np.percentile(all_grades, 100 - _PEAK_PCTILE) * 100.0), 2),
        "note": (
            "the slope of the road under the car, from altitude against "
            "distance travelled. It matters because the accelerometer cannot "
            "tell braking from gravity: on a downhill some of the deceleration "
            "you read is the hill, and on an uphill some of your braking is "
            "credited to the road"
        ),
    }

    if raw_decel:
        raw_all = np.concatenate(raw_decel)
        corr_all = np.concatenate(corrected)
        peak_raw = float(np.percentile(raw_all, _PEAK_PCTILE))
        peak_corr = float(np.percentile(corr_all, _PEAK_PCTILE))
        out["braking"] = {
            "measured": True,
            "ticks": int(raw_all.size),
            "peak_decel_g_uncorrected": round(peak_raw, 3),
            "peak_decel_g_grade_corrected": round(peak_corr, 3),
            "difference_g": round(peak_corr - peak_raw, 3),
            "note": (
                "both are reported because the uncorrected figure is what every "
                "other panel in this app uses; the corrected one is what the "
                "brakes and tyres actually did once the hill is taken out"
            ),
        }
    else:
        out["braking"] = _unmeasured("no braking ticks with a usable grade under them")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 5. Corner by corner — the whole point of the module
# ─────────────────────────────────────────────────────────────────────────────

def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, else fastest valid (contract rule 4)."""
    valid = [l for l in session.laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def _by_corner(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return _unmeasured("no valid lap to detect corners from")

    corners = detect_corners(
        ref.grid["speed"],
        ref.grid["grid_pct"],
        ref.grid.get("lat_gps"),
        ref.grid.get("lon_gps"),
    )
    if not corners:
        return _unmeasured("no corners were detected on the reference lap")

    laps = [lap for lap in session.laps if _usable(lap)]
    if not laps:
        return _unmeasured("no lap carries the channels this needs")

    out: list[dict] = []
    for corner in corners:
        beta_parts, torque_parts, deg_parts, rot_parts = [], [], [], []
        for lap in laps:
            dist = lap.raw["dist"].astype(np.float64)
            speed = lap.raw["speed"].astype(np.float64)
            inside = (
                (dist >= corner["start_pct"])
                & (dist <= corner["end_pct"])
                & (speed >= _MIN_SPEED_FOR_SLIP)
            )
            if not inside.any():
                continue
            vx = lap.raw["vel_x"].astype(np.float64)[inside]
            vy = lap.raw["vel_y"].astype(np.float64)[inside]
            ok = _finite(vx, vy)
            if ok.any():
                beta_parts.append(_slip_angle_deg(vx[ok], vy[ok]))
            torque_parts.append(np.abs(lap.raw["steer_torque"].astype(np.float64)[inside]))
            deg_parts.append(np.degrees(np.abs(lap.raw["steer"].astype(np.float64)[inside])))
            rot_parts.append(
                lap.raw["yaw_rate"].astype(np.float64)[inside]
                - lap.raw["lat_accel"].astype(np.float64)[inside]
                / np.maximum(speed[inside], 1.0)
            )

        entry: dict = {
            "id": corner["id"],
            "start_pct": corner["start_pct"],
            "apex_pct": corner["apex_pct"],
            "end_pct": corner["end_pct"],
        }
        if corner.get("radius_m") is not None:
            entry["radius_m"] = corner["radius_m"]
            entry["dir"] = corner.get("dir")

        beta = np.concatenate(beta_parts) if beta_parts else np.empty(0)
        beta = beta[np.isfinite(beta)]
        if beta.size < _MIN_CORNER_TICKS:
            entry["measured"] = False
            entry["reason"] = f"only {beta.size} ticks through this corner across the session"
            entry["ticks"] = int(beta.size)
            out.append(entry)
            continue

        torque = np.concatenate(torque_parts)
        deg = np.concatenate(deg_parts)
        rot = np.concatenate(rot_parts)
        torque = torque[np.isfinite(torque)]
        deg = deg[np.isfinite(deg)]
        rot = rot[np.isfinite(rot)]

        entry.update({
            "measured": True,
            "ticks": int(beta.size),
            "laps_pooled": len(beta_parts),
            "peak_slip_deg": round(float(np.percentile(np.abs(beta), _PEAK_PCTILE)), 2),
            "median_slip_deg": round(float(np.median(np.abs(beta))), 2),
            "peak_torque_nm": (
                round(float(np.percentile(torque, _PEAK_PCTILE)), 2) if torque.size else None
            ),
            "peak_lock_deg": round(float(np.percentile(deg, _PEAK_PCTILE)), 1) if deg.size else None,
            "median_rotation_gap_rad_s": (
                round(float(np.median(np.abs(rot))), 4) if rot.size else None
            ),
        })
        out.append(entry)

    measured = [c for c in out if c.get("measured")]
    block: dict = {
        "measured": bool(measured),
        "reference_lap": ref.lap_number,
        "laps_pooled": len(laps),
        "corners": out,
        "note": (
            "every clean lap's ticks through each corner window are pooled, so "
            "these describe how the corner was taken across the run rather than "
            "on any one lap"
        ),
    }
    if measured:
        most = max(measured, key=lambda c: c["peak_slip_deg"])
        least = min(measured, key=lambda c: c["peak_slip_deg"])
        block["most_slip"] = {"id": most["id"], "peak_slip_deg": most["peak_slip_deg"]}
        block["least_slip"] = {"id": least["id"], "peak_slip_deg": least["peak_slip_deg"]}
    else:
        block["reason"] = "no corner had enough ticks to measure"
    return block
