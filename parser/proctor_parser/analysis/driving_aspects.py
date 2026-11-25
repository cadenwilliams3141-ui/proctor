"""What each part of the driving was worth, against the driver's own best (module 20).

The question a driver asks after a session is not "where did the lap go" but
"what should I work on" -- braking, turn-in, the throttle, the line. This module
answers the measurable half of that: it carves every clean lap into the same
stretches of road, corner by corner, times each stretch, and reports how much
the TYPICAL pass through it gave away against the driver's own quick ones.

THE ZONES. For each corner the reference lap carved (detect_corners), on fixed
lap fractions so every lap is timed over the same road:

    braking    earliest brake onset across the clean laps -> median turn-in
    rotation   median turn-in -> the apex (the slowest point of the reference)
    exit       apex -> median point the throttle went full and stayed there
    straight   full throttle -> the next corner's braking (billed to nothing)

Braking later shows as a gain inside the braking zone, because the zone starts
where the earliest lap braked. The straight is NOT billed to the throttle: the
speed it is driven at depends on the exit, but also on tow, fuel and gearing,
and a disk file cannot see another car. Its link with exit speed is reported as
a link, never as a cost.

THE TIMES CLOSE. Zones are timed from each lap's raw ticks through a crossing
clock (analysis/zones.py), so the sum of a lap's zones IS its recorded lap time.
No resampling, no rescale.

THE TARGET IS THE DRIVER'S OWN. `at_stake_s` is the typical pass (median) minus
the SECOND-quickest pass -- a time the driver did at least twice, so one lucky
pass cannot set it. Summing best-of-each-zone from different laps describes a lap
nobody drove, so the payload says so and reports the real gap beside it.
Tendencies compare the typical pass against the median of the quickest third.

What this module does NOT do is say what to do. It describes, per the analysis
contract; the instructions a driver reads are composed in the web app
(web/lib/proctor/coach.ts) from these numbers, and point only at what one of
the driver's own laps already did.

Line and grip get no zone: they happen inside the other three. They are
reported as LINKED time -- laps with a lockup in a corner against laps without,
a lateral offset against corner time -- which overlaps the zones and is never
added to them.
"""

from __future__ import annotations

import math

import numpy as np

from proctor_parser.analysis import line_offset, zones
from proctor_parser.analysis.corners import detect_corners
from proctor_parser.analysis.lockup_wheelspin import lap_events
from proctor_parser.analysis.traction_circle import envelope, fraction_of_envelope
from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "driving_aspects"

_BASIS = (
    "every clean lap timed over the same stretches of road, against your own "
    "quicker passes through each one"
)
_CAVEAT = (
    "one session. The quickest pass through each zone came from different laps, "
    "and they may not all be possible together. A link between a habit and a "
    "zone time is a correlation over your laps, not a cause. The run from the "
    "start line to the first braking zone is a straight like the others."
)
_RACE_CAVEAT = (
    " This was a race: other cars change lines and speeds, and a disk file cannot "
    "see them."
)

_DEFAULT_TICK_RATE = 60
_MIN_LAPS = 4              # second-best needs a median above it to mean anything
_EARLY_BRAKE_MAD = 3.0     # an onset this many MADs early is one lap, not the zone
_LIFT = 0.10               # a throttle dip this deep that comes back is a lift
_QUICK_SHARE = 1.0 / 3.0

ZONES = ("braking", "rotation", "exit", "straight")

# The gates the web app's suggestion rules apply. They are policy, not
# measurement, but they travel here as numbers so the web app never carries its
# own copy (the equipment.ts rule): change one here and every screen follows.
COACH_GATES = {
    "strong_n": 6,             # laps a link needs before it can carry a tip
    "strong_p": 0.10,          # ...and how unlikely chance must be
    "one_corner_p": 0.02,      # a single-corner "one thing" needs this much
    "min_at_stake_s": 0.03,    # a zone giving away less is not worth a tip
    "one_thing_min_s": 0.10,   # the session's one thing must be worth this
    "brake_point_m": 3.0,
    "peak_brake_pts": 5.0,
    "pickup_m": 5.0,
    "corrections": 1.0,
    "line_m": 0.5,
    "dip_pts": 10.0,
    "coast_s": 0.05,
    "drift_rho": 0.5,
    "linked_min_laps_each_side": 2,
}


def _clean(lap: ParsedLap) -> bool:
    return (
        lap.is_valid
        and not lap.is_out_lap
        and not lap.is_anomalous
        and lap.lap_time_s is not None
    )


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    """Fastest valid non-anomalous lap, falling back to fastest valid (rule 4)."""
    valid = [l for l in session.laps if l.is_valid and l.lap_time_s is not None]
    if not valid:
        return None
    clean = [l for l in valid if not l.is_anomalous]
    return min(clean or valid, key=lambda l: l.lap_time_s)


def _insufficient(reason: str) -> dict:
    return {"basis": _BASIS, "insufficient_data": True, "reason": reason, "caveat": _CAVEAT}


# ─────────────────────────────────────────────────────────────────────────────
# One lap, read once
# ─────────────────────────────────────────────────────────────────────────────

class _Lap:
    """The channels of one clean lap that every zone reads, prepared once."""

    def __init__(self, lap: ParsedLap, rate: int, env):
        self.lap = lap
        self.number = int(lap.lap_number)
        self.rate = rate
        self.dist = zones.lap_distance(lap, rate)
        self.clock = zones.crossing_clock(lap, rate)
        moving = moving_mask(lap.raw["speed"])
        self.speed = lap.raw["speed"].astype(np.float64)
        self.brake = np.where(moving, lap.raw["brake_raw"].astype(np.float64), 0.0)
        self.throttle = lap.raw["throttle"].astype(np.float64)
        self.steer = lap.raw["steer"]
        lat_g = lap.raw["lat_accel"].astype(np.float64) / zones.G
        long_g = lap.raw["long_accel"].astype(np.float64) / zones.G
        self.abs_lat = np.abs(lat_g)
        self.env_frac = fraction_of_envelope(lat_g, long_g, env) if env is not None else None
        self.lockups = [e["start_pct"] for e in lap_events(lap, rate, "lockup")]
        self.spins = [e["start_pct"] for e in lap_events(lap, rate, "wheelspin")]

    def at(self, p: float) -> int:
        return zones.index_at(self.dist, p)


# ─────────────────────────────────────────────────────────────────────────────
# The session
# ─────────────────────────────────────────────────────────────────────────────

def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return _insufficient("no valid lap in this session to take corners from")
    clean = [lap for lap in session.laps if _clean(lap)]
    if len(clean) < _MIN_LAPS:
        return _insufficient(
            f"{len(clean)} clean lap(s); comparing a typical pass with your second-"
            f"quickest needs at least {_MIN_LAPS}"
        )

    corners = detect_corners(
        ref.grid["speed"], ref.grid["grid_pct"], ref.grid.get("lat_gps"), ref.grid.get("lon_gps"),
    )
    if not corners:
        return _insufficient("no corners detected on the reference lap's speed profile")

    rate = session.meta.tick_rate or _DEFAULT_TICK_RATE
    track_m = (session.meta.track_length_km or 0.0) * 1000.0 or None
    env = envelope(session.laps)
    laps = [_Lap(lap, rate, env) for lap in clean]
    order = {l.number: i for i, l in enumerate(laps)}

    bounds = _boundaries(corners, laps, rate)
    edges = [0.0]
    for b in bounds:
        edges += [b["brake_pct"], b["turn_in_pct"], b["apex_pct"], b["full_pct"]]
    edges.append(1.0)
    edges_arr = np.asarray(edges, dtype=np.float64)

    # Zone times per lap. edges = [0, O1, T1, A1, F1, ..., On, Tn, An, Fn, 1].
    times: dict[int, np.ndarray] = {}
    for l in laps:
        times[l.number] = np.diff(l.clock(edges_arr))

    frame = _line_frame(ref, clean)
    offsets = {l.number: _offsets(frame, l.lap) for l in laps} if frame is not None else {}
    grid_pct = ref.grid["grid_pct"].astype(np.float64)

    out_corners = []
    for i, (c, b) in enumerate(zip(corners, bounds)):
        k = 1 + 4 * i  # index of this corner's braking zone in the diffs
        per_zone = {
            "braking": {l.number: float(times[l.number][k]) for l in laps},
            "rotation": {l.number: float(times[l.number][k + 1]) for l in laps},
            "exit": {l.number: float(times[l.number][k + 2]) for l in laps},
            "straight": {l.number: float(times[l.number][k + 3]) for l in laps},
        }
        total = {
            n: per_zone["braking"][n] + per_zone["rotation"][n] + per_zone["exit"][n]
            for n in per_zone["braking"]
        }
        next_brake = bounds[i + 1]["brake_pct"] if i + 1 < len(bounds) else 1.0
        rows = {l.number: _measure(l, b, next_brake, track_m) for l in laps}
        for n, off in offsets.items():
            rows[n].update(_offsets_at(off, grid_pct, b))
        out_corners.append(
            _corner_block(c, b, next_brake, per_zone, total, rows, order)
        )

    lead = {l.number: float(times[l.number][0]) for l in laps}
    lead_block = _zone_block(lead, order, None)

    aspects = _aspects(out_corners, lead_block)
    lap_times = {l.number: float(l.lap.lap_time_s) for l in laps}
    ordered = sorted(lap_times.values())
    caveat = _CAVEAT + (_RACE_CAVEAT if "race" in (session.meta.session_type or "").lower() else "")

    payload = {
        "basis": _BASIS,
        "reference_lap": int(ref.lap_number),
        "laps_used": [l.number for l in laps],
        "lap_times_s": {str(n): round(t, 3) for n, t in lap_times.items()},
        "median_lap_s": round(float(np.median(ordered)), 3),
        "second_best_lap_s": round(ordered[1], 3),
        "best_lap_s": round(ordered[0], 3),
        # Typical lap against a lap you actually drove twice over...
        "actual_gap_s": round(float(np.median(ordered)) - ordered[1], 3),
        # ...and against your second-best pass through every zone, from any lap.
        "theoretical_gap_s": round(sum(a["at_stake_s"] for a in aspects.values()), 3),
        "aspects": aspects,
        "lead_in": lead_block,
        "corners": out_corners,
        "track_length_known": track_m is not None,
        "envelope_available": env is not None,
        "line_available": frame is not None,
        "thresholds": {
            "brake_on_pct": round(100 * zones.BRAKE_ON, 1),
            "brake_off_pct": round(100 * zones.BRAKE_OFF, 1),
            "turn_in_pct_of_peak_lat": round(100 * zones.TURN_IN_FRACTION, 1),
            "full_throttle_pct": round(100 * zones.FULL_THROTTLE, 1),
            "full_hold_s": zones.FULL_HOLD_S,
            "pickup_pct": round(100 * zones.PICKUP_THROTTLE, 1),
            "lift_pct": round(100 * _LIFT, 1),
            "early_brake_mads": _EARLY_BRAKE_MAD,
            "min_laps": _MIN_LAPS,
            "quick_share": round(_QUICK_SHARE, 3),
        },
        "coach_gates": dict(COACH_GATES),
        "caveat": caveat,
    }
    if track_m is None:
        payload["distance_note"] = (
            "the file does not state the track length, so distances in metres are "
            "not reported; times are unaffected"
        )
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# Where the zones are
# ─────────────────────────────────────────────────────────────────────────────

def _boundaries(corners: list[dict], laps: list[_Lap], rate: int) -> list[dict]:
    """Fixed lap fractions for every corner's zones, monotone by construction."""
    out: list[dict] = []
    prev_apex = 0.0
    for c in corners:
        apex = float(c["apex_pct"])
        onsets: list[tuple[int, float]] = []
        turn_ins: list[float] = []
        censored = False
        for l in laps:
            lo, hi = l.at(prev_apex), l.at(apex)
            app = zones.brake_application(l.brake, lo, hi, rate)
            if app is not None:
                onset = app[0]
                onsets.append((l.number, float(l.dist[onset])))
                if onset == lo and l.brake[lo] >= zones.BRAKE_OFF and prev_apex == 0.0:
                    censored = True
                start = onset
            else:
                start = zones.quietest_index(l.abs_lat, lo, hi)
            ti = zones.turn_in_index(l.abs_lat, start, hi)
            if ti is not None:
                turn_ins.append(float(l.dist[ti]))

        early: list[int] = []
        brake_pct = None
        if len(onsets) * 2 >= len(laps):
            vals = np.array([p for _, p in onsets])
            med = float(np.median(vals))
            mad = float(np.median(np.abs(vals - med)))
            floor = med - _EARLY_BRAKE_MAD * max(mad, 1e-4)
            early = [n for n, p in onsets if p < floor]
            brake_pct = float(min(p for _, p in onsets if p >= floor))

        turn_in = float(np.median(turn_ins)) if turn_ins else apex
        turn_in = min(max(turn_in, prev_apex), apex)
        brake_pct = turn_in if brake_pct is None else min(max(brake_pct, prev_apex), turn_in)
        out.append({
            "floor_pct": prev_apex,
            "brake_pct": brake_pct,
            "turn_in_pct": turn_in,
            "apex_pct": apex,
            "braked_laps": len(onsets),
            "early_brakers": early,
            "braking_truncated_at_line": censored,
        })
        prev_apex = apex

    # Full throttle needs the next corner's braking point as its ceiling.
    for i, b in enumerate(out):
        ceiling = out[i + 1]["brake_pct"] if i + 1 < len(out) else 1.0
        fulls = []
        for l in laps:
            fi = zones.full_throttle_index(l.throttle, l.at(b["apex_pct"]), l.at(ceiling), rate)
            if fi is not None:
                fulls.append(float(l.dist[fi]))
        full = float(np.median(fulls)) if len(fulls) * 2 >= len(laps) else ceiling
        b["full_pct"] = min(max(full, b["apex_pct"]), ceiling)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# One lap through one corner: the habits
# ─────────────────────────────────────────────────────────────────────────────

def _measure(l: _Lap, b: dict, next_brake: float, track_m: float | None) -> dict:
    O, T, A, F = b["brake_pct"], b["turn_in_pct"], b["apex_pct"], b["full_pct"]
    io, it, ia, iF, inext = l.at(O), l.at(T), l.at(A), l.at(F), l.at(next_brake)
    row: dict = {}

    def metres(p: float) -> float | None:
        return round((A - p) * track_m, 1) if track_m else None

    # Braking: where it started and how hard, from this lap's own application.
    # Searched from the previous apex, not the zone start: a lap that braked
    # earlier than the zone (an early braker set aside from the boundary) still
    # reports its own brake point.
    app = zones.brake_application(l.brake, l.at(b["floor_pct"]), ia, l.rate)
    if app is not None:
        onset, end = app
        row["brake_point_m"] = metres(float(l.dist[onset]))
        row["peak_brake_pct"] = round(100.0 * float(l.brake[onset : end + 1].max()), 1)

    # Turn-in to apex: how settled the hands were, how much grip was in use.
    if ia > it:
        row["corrections"] = zones.steering_reversals(l.steer[it : ia + 1])
        if l.env_frac is not None:
            frac = l.env_frac[it : ia + 1]
            frac = frac[np.isfinite(frac)]
            if frac.size:
                row["envelope_use_pct"] = round(100.0 * float(np.median(frac)), 1)
    lo_speed = l.speed[io : max(iF, io + 1) + 1]
    if lo_speed.size:
        row["min_speed_kmh"] = round(3.6 * float(lo_speed.min()), 1)

    # The exit: when the throttle came in, how long it took to be full, lifts.
    full_i = zones.full_throttle_index(l.throttle, ia, inext, l.rate)
    if full_i is not None:
        pick = zones.pickup_index(l.throttle, it, full_i)
        if track_m:
            row["pickup_m"] = round((float(l.dist[pick]) - A) * track_m, 1)
            row["full_m"] = round((float(l.dist[full_i]) - A) * track_m, 1)
        row["pickup_to_full_s"] = round((full_i - pick) / l.rate, 3)
        row["exit_lifts"] = zones.throttle_lifts(l.throttle[pick : full_i + 1], _LIFT)
    row["exit_speed_kmh"] = round(3.6 * float(l.speed[iF]), 1)

    # Slip events in this corner: lockups on the way in, wheelspin on the way out.
    row["lockup"] = any(O - 0.002 <= p <= A for p in l.lockups)
    row["wheelspin"] = any(A <= p <= next_brake for p in l.spins)
    return row


# ─────────────────────────────────────────────────────────────────────────────
# The line
# ─────────────────────────────────────────────────────────────────────────────

def _line_frame(ref: ParsedLap, clean: list[ParsedLap]):
    lat, lon = ref.grid.get("lat_gps"), ref.grid.get("lon_gps")
    if lat is None or lon is None or not (np.isfinite(lat).all() and np.isfinite(lon).all()):
        return None
    span = max(float(np.ptp(lat)), float(np.ptp(lon)))
    if span <= 1e-6:
        return None
    return line_offset.frame(lat, lon)


def _offsets(frame, lap: ParsedLap) -> np.ndarray | None:
    lat, lon = lap.grid.get("lat_gps"), lap.grid.get("lon_gps")
    if lat is None or lon is None:
        return None
    return line_offset.offsets(frame, lat, lon)


def _offsets_at(off: np.ndarray | None, grid_pct: np.ndarray, b: dict) -> dict:
    if off is None:
        return {}
    out = {}
    for key, p in (("offset_turn_in_m", b["turn_in_pct"]), ("offset_apex_m", b["apex_pct"]),
                   ("offset_exit_m", b["full_pct"])):
        i = min(int(np.searchsorted(grid_pct, p)), len(off) - 1)
        v = off[i]
        if np.isfinite(v):
            out[key] = round(float(v), 2)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Across the laps
# ─────────────────────────────────────────────────────────────────────────────

def _quick(times: dict[int, float]) -> list[int]:
    k = max(2, math.ceil(len(times) * _QUICK_SHARE))
    return [n for n, _ in sorted(times.items(), key=lambda kv: kv[1])[:k]]


def _link(xs: list[float], ys: list[float]) -> dict | None:
    sp = zones.spearman(xs, ys)
    if sp is None:
        return None
    rho, p = sp
    return {"rho": round(rho, 2), "p": round(p, 3), "n": len(xs)}


def _zone_block(times: dict[int, float], order: dict[int, int], total: dict[int, float] | None) -> dict:
    vals = sorted(times.values())
    typical = float(np.median(vals))
    best_lap = min(times, key=times.get)
    quick = _quick(times)
    laps = sorted(times, key=lambda n: order[n])
    block = {
        "typical_s": round(typical, 4),
        "best_s": round(vals[0], 4),
        "best_lap": int(best_lap),
        "second_best_s": round(vals[1], 4),
        "at_stake_s": round(max(0.0, typical - vals[1]), 4),
        "quick_laps": quick,
        "drift": _link([order[n] for n in laps], [times[n] for n in laps]),
        "per_lap": {str(n): round(times[n], 4) for n in laps},
    }
    if total is not None:
        # The quick passes through THIS zone, over the whole corner: a habit
        # that wins the zone and loses the corner is not a habit worth copying.
        block["quick_corner_total_s"] = round(float(np.median([total[n] for n in quick])), 4)
    return block


# Which zone each habit is read against.
_METRIC_ZONE = {
    "brake_point_m": "braking",
    "peak_brake_pct": "braking",
    "corrections": "rotation",
    "envelope_use_pct": "rotation",
    "min_speed_kmh": "rotation",
    "pickup_m": "exit",
    "full_m": "exit",
    "pickup_to_full_s": "exit",
    "exit_lifts": "exit",
    "exit_speed_kmh": "straight",
    "offset_turn_in_m": "total",
    "offset_apex_m": "total",
    "offset_exit_m": "total",
}


def _corner_block(c, b, next_brake, per_zone, total, rows, order) -> dict:
    zones_out = {z: _zone_block(per_zone[z], order, total) for z in ZONES}
    total_block = _zone_block(total, order, None)

    metrics: dict[str, dict] = {}
    for key, zone in _METRIC_ZONE.items():
        have = {n: r[key] for n, r in rows.items() if r.get(key) is not None}
        if len(have) < 3:
            continue
        ztimes = total if zone == "total" else per_zone[zone]
        quick = [n for n in _quick(ztimes) if n in have]
        laps = sorted(have, key=lambda n: order[n])
        metrics[key] = {
            "zone": zone,
            "typical": round(float(np.median(list(have.values()))), 3),
            "quick": round(float(np.median([have[n] for n in quick])), 3) if quick else None,
            "link": _link([have[n] for n in laps], [ztimes[n] for n in laps]),
            "per_lap": {str(n): have[n] for n in laps},
        }

    linked = {
        "lockup": _split(rows, "lockup", total),
        "wheelspin": _split(
            rows, "wheelspin",
            {n: per_zone["exit"][n] + per_zone["straight"][n] for n in total},
        ),
        "carry": _carry(rows, per_zone["straight"], order),
    }

    block = {
        "id": int(c["id"]),
        "start_pct": c["start_pct"],
        "apex_pct": c["apex_pct"],
        "end_pct": c["end_pct"],
        "bounds": {
            "brake_pct": round(b["brake_pct"], 4),
            "turn_in_pct": round(b["turn_in_pct"], 4),
            "apex_pct": round(b["apex_pct"], 4),
            "full_pct": round(b["full_pct"], 4),
            "next_brake_pct": round(next_brake, 4),
        },
        "braked_laps": b["braked_laps"],
        "early_brakers": b["early_brakers"],
        "braking_truncated_at_line": b["braking_truncated_at_line"],
        "zones": zones_out,
        "corner_total": total_block,
        "metrics": metrics,
        "linked": linked,
    }
    if "dir" in c:
        block["dir"] = c["dir"]
        block["radius_m"] = c.get("radius_m")
    return block


def _split(rows: dict, key: str, times: dict[int, float]) -> dict:
    with_ = [times[n] for n, r in rows.items() if r.get(key)]
    without = [times[n] for n, r in rows.items() if not r.get(key)]
    need = COACH_GATES["linked_min_laps_each_side"]
    if len(with_) < need or len(without) < need:
        return {
            "measured": False,
            "laps_with": len(with_),
            "laps_without": len(without),
            "reason": f"needs at least {need} laps with and {need} without",
        }
    return {
        "measured": True,
        "laps_with": len(with_),
        "laps_without": len(without),
        # Positive: the laps with the event were slower here.
        "delta_s": round(float(np.median(with_)) - float(np.median(without)), 4),
    }


def _carry(rows: dict, straight: dict[int, float], order: dict[int, int]) -> dict:
    laps = sorted((n for n, r in rows.items() if r.get("exit_speed_kmh") is not None), key=lambda n: order[n])
    if len(laps) < 3:
        return {"measured": False, "reason": "too few laps with an exit speed"}
    link = _link([rows[n]["exit_speed_kmh"] for n in laps], [straight[n] for n in laps])
    if link is None:
        return {"measured": False, "reason": "exit speed or straight time did not vary"}
    return {"measured": True, **link}


def _aspects(corners: list[dict], lead: dict) -> dict:
    out = {}
    for zone in ZONES:
        per = [
            {"id": c["id"], "at_stake_s": c["zones"][zone]["at_stake_s"]}
            for c in corners
        ]
        if zone == "straight":
            per.append({"id": 0, "at_stake_s": lead["at_stake_s"]})
        per.sort(key=lambda r: -r["at_stake_s"])
        out[zone] = {
            "at_stake_s": round(sum(r["at_stake_s"] for r in per), 4),
            "corners": per,
            "billed": zone != "straight",
        }
    return out
