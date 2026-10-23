"""Trail braking into each corner, against the driver's own best entry (module 19).

Trail braking is the overlap between the end of braking and the start of
cornering: the brake comes off as the steering goes on, so the tyres are asked
for combined grip through the transition instead of all of one and then all of
the other. This module measures that overlap on every clean lap, for every
corner the reference lap carved, and finds the lap whose ENTRY was quickest.

THE TARGET IS THE DRIVER'S OWN BEST. Nothing here says how a corner should be
taken; that would be a guess about intent the file never recorded (Decisions:
"Plain English means specific, not prescriptive"). What it can say is how this
driver's quickest entry to a corner differed from their typical one, and
whether, this session, a longer trail went with a quicker entry. General
technique lives in the web app's labelled technique notes, keyed off these
findings, never in this payload.

Every threshold is relative to the driver's own data where it can be:
  turn-in   the first tick where |lateral g| reaches 30% of THAT lap's own
            peak in the corner -- so it works the same in any car
  dip       combined g as a fraction of the driver's own g-g envelope
            (traction_circle.envelope), not of a tyre model

What the factors can honestly be, given the file:
  elevation   grade under the braking zone, from Alt (analysis/grade.py)
  downforce   vertical load at brake onset against at turn-in, from VertAccel,
              which also carries kerbs and crests -- a context reading
  car         characterised by the data (ABS present, load measured), never
              by a per-car table (Decisions: self-envelope over physics models)
  tyre temp   left-front surface middle only; the other three are not carried
  brake temp  no channel exists; stated absent, never estimated

Brake-vs-BrakeRaw logic is not used here (BrakeRaw is the pedal); every tick is
still filtered by moving_mask so a stationary car cannot read as braking.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.analysis.grade import grade_per_tick
from proctor_parser.analysis.traction_circle import envelope, fraction_of_envelope
from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "trail_braking"

_BASIS = "each corner's entry against your own laps this session; turn-in and the envelope come from your own data"
_CAVEAT = (
    "one session. The brake thresholds (10% on, 5% off) and the turn-in rule (30% "
    "of the lap's own peak lateral g) are heuristics; a link between trail and "
    "entry time is a correlation over your laps, not a cause"
)
_BRAKE_TEMP_REASON = (
    "the .ibt carries no brake-temperature channel, only line pressure; nothing "
    "is estimated in its place"
)

_G = 9.81
_DEFAULT_TICK_RATE = 60
# Braking for a corner starts before the corner's speed-recovery start point,
# which is where detect_corners begins the window. The same lead-in the web app
# uses to attribute braking-zone events to their corner.
_LEAD_IN = 0.035
_ONSET = 0.10           # BrakeRaw at or above this: the brake is on
_OFF = 0.05             # below this: the brake is off
_TURN_IN_FRACTION = 0.30
_MIN_PEAK_LAT_G = 0.15  # below this the "corner" was not one on this lap
_RESTAB = 0.05          # a re-application of at least 5 points of pedal
_THROTTLE_ON = 0.05
_DIP_PCTILE = 10        # robust minimum of the transition, not one noisy tick
_MIN_TICKS = 6
_MIN_LAPS_FOR_LINK = 5
_LINK_RHO = 0.5
_LOAD_HALF_WINDOW = 3   # ticks either side of an event for a vertical-load read


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
    return {
        "basis": _BASIS,
        "insufficient_data": True,
        "reason": reason,
        "brake_temperature": {"available": False, "reason": _BRAKE_TEMP_REASON},
        "caveat": _CAVEAT,
    }


def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return _insufficient("no valid lap in this session to take corners from")
    laps = [lap for lap in session.laps if _clean(lap)]
    if not laps:
        return _insufficient("no clean lap in this session to measure an entry on")

    # Same call corner_sections makes, so the ids match the corners on screen.
    corners = detect_corners(ref.grid["speed"], ref.grid["grid_pct"])
    if not corners:
        return _insufficient("no corners detected on the reference lap's speed profile")

    rate = session.meta.tick_rate or _DEFAULT_TICK_RATE
    track_m = (session.meta.track_length_km or 0.0) * 1000.0
    env = envelope(session.laps)

    out_corners: list[dict] = []
    for i, c in enumerate(corners):
        floor = corners[i - 1]["apex_pct"] if i > 0 else 0.0
        lo = max(floor, c["start_pct"] - _LEAD_IN, 0.0)
        rows = []
        for lap in laps:
            row = _measure(lap, c, lo, rate, env, track_m)
            if row is not None:
                rows.append(row)
        out_corners.append(_summarise(c, rows))

    payload = {
        "basis": _BASIS,
        "reference_lap": int(ref.lap_number),
        "laps_used": [int(l.lap_number) for l in laps],
        "corners": out_corners,
        "summary": _session_summary(out_corners),
        # The rules the numbers above were read with, as numbers, so the web
        # app can state them without carrying its own copy that could drift.
        "thresholds": {
            "brake_on_pct": round(100 * _ONSET, 1),
            "brake_off_pct": round(100 * _OFF, 1),
            "turn_in_pct_of_peak_lat": round(100 * _TURN_IN_FRACTION, 1),
            "restab_pct": round(100 * _RESTAB, 1),
        },
        "lf_temp_available": all("lf_temp_m" in l.raw for l in laps),
        "envelope_available": env is not None,
        "brake_temperature": {"available": False, "reason": _BRAKE_TEMP_REASON},
        "caveat": _CAVEAT,
    }
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# One lap through one corner
# ─────────────────────────────────────────────────────────────────────────────

def _measure(
    lap: ParsedLap,
    c: dict,
    lo: float,
    rate: int,
    env: tuple[np.ndarray, np.ndarray] | None,
    track_m: float,
) -> dict | None:
    """The entry to corner `c` on `lap`, or None if this lap cannot be read there."""
    dist = lap.raw["dist"].astype(np.float64)
    moving = moving_mask(lap.raw["speed"])
    win = np.flatnonzero((dist >= lo) & (dist <= c["end_pct"]))
    if win.size < _MIN_TICKS or not moving[win].all():
        return None
    a, z = int(win[0]), int(win[-1])
    apex = a + int(np.searchsorted(dist[a : z + 1], c["apex_pct"]))
    start = a + int(np.searchsorted(dist[a : z + 1], c["start_pct"]))
    if apex - a < _MIN_TICKS or apex > z:
        return None

    speed = lap.raw["speed"].astype(np.float64)
    brake = lap.raw["brake_raw"].astype(np.float64)
    throttle = lap.raw["throttle"].astype(np.float64)
    lat_g = lap.raw["lat_accel"].astype(np.float64) / _G
    long_g = lap.raw["long_accel"].astype(np.float64) / _G

    row: dict = {
        "lap": int(lap.lap_number),
        "entry_time_s": round((apex - start) / rate, 3),
        "min_speed_ms": round(float(speed[start : apex + 1].min()), 2),
    }

    on = np.flatnonzero(brake[a : apex + 1] >= _ONSET)
    if on.size == 0:
        row["braked"] = False
        return row
    onset = a + int(on[0])
    peak = onset + int(np.argmax(brake[onset : apex + 1]))

    abs_lat = np.abs(lat_g)
    peak_lat = float(abs_lat[onset : apex + 1].max())
    if peak_lat < _MIN_PEAK_LAT_G:
        row["braked"] = True
        row["turn_in_found"] = False
        return row
    turn_in = onset + int(np.flatnonzero(abs_lat[onset : apex + 1] >= _TURN_IN_FRACTION * peak_lat)[0])

    off = np.flatnonzero(brake[peak : z + 1] < _OFF)
    release = peak + int(off[0]) if off.size else None

    row.update({
        "braked": True,
        "turn_in_found": True,
        "brake_at_turn_in_pct": round(100.0 * float(brake[turn_in]), 1),
        "peak_brake_pct": round(100.0 * float(brake[peak]), 1),
        "released_in_corner": release is not None,
    })
    if release is not None:
        row["trail_s"] = round((release - turn_in) / rate, 3)
        row["release_s"] = round((release - peak) / rate, 3)
        row["restabs"] = _restabs(brake[peak : release + 1])
        row["coast_s"] = round(_coast_ticks(brake, throttle, release, z) / rate, 3)
        trail_ticks = slice(turn_in, release) if release > turn_in else None
    else:
        row["restabs"] = _restabs(brake[peak : z + 1])
        trail_ticks = slice(turn_in, z + 1)

    abs_active = lap.raw.get("abs_active")
    if abs_active is not None and trail_ticks is not None:
        seg = abs_active[trail_ticks].astype(bool)
        if seg.size:
            row["abs_in_trail_pct"] = round(100.0 * float(seg.mean()), 1)

    # The dip: from the hardest braking to the hardest cornering, how much of
    # the driver's own envelope the car was using at its lowest point.
    lat_peak_i = peak + int(np.argmax(abs_lat[peak : apex + 1]))
    if env is not None and lat_peak_i - peak >= 2:
        frac = fraction_of_envelope(lat_g[peak : lat_peak_i + 1], long_g[peak : lat_peak_i + 1], env)
        frac = frac[np.isfinite(frac)]
        if frac.size:
            row["transition_min_pct"] = round(100.0 * float(np.percentile(frac, _DIP_PCTILE)), 1)

    # Context, per lap: the road, the load, the left-front tyre.
    grade = grade_per_tick(lap, track_m)
    if grade is not None:
        g = grade[onset : max(turn_in, onset + 1) + 1]
        g = g[np.isfinite(g)]
        if g.size:
            row["grade_pct"] = round(100.0 * float(np.median(g)), 2)
    if "vert_accel" in lap.raw:
        vert = np.abs(lap.raw["vert_accel"].astype(np.float64)) / _G
        row["load_g_onset"] = _around(vert, onset)
        row["load_g_turn_in"] = _around(vert, turn_in)
    if "lf_temp_m" in lap.raw:
        row["lf_temp_middle_c"] = round(float(lap.raw["lf_temp_m"][turn_in]), 1)
    return row


def _restabs(release_phase: np.ndarray) -> int:
    """Re-applications during the release: the pedal rising 5+ points off its running low."""
    count = 0
    low = float(release_phase[0]) if release_phase.size else 0.0
    for v in release_phase[1:]:
        v = float(v)
        if v - low >= _RESTAB:
            count += 1
            low = v
        else:
            low = min(low, v)
    return count


def _coast_ticks(brake: np.ndarray, throttle: np.ndarray, release: int, end: int) -> int:
    """Ticks after the release with neither pedal applied, until the throttle comes in."""
    seg_t = throttle[release : end + 1]
    on = np.flatnonzero(seg_t >= _THROTTLE_ON)
    stop = release + (int(on[0]) if on.size else seg_t.size)
    gap = (brake[release:stop] < _OFF) & (throttle[release:stop] < _THROTTLE_ON)
    return int(np.count_nonzero(gap))


def _around(values: np.ndarray, i: int) -> float | None:
    seg = values[max(0, i - _LOAD_HALF_WINDOW) : i + _LOAD_HALF_WINDOW + 1]
    seg = seg[np.isfinite(seg)]
    return round(float(np.median(seg)), 3) if seg.size else None


# ─────────────────────────────────────────────────────────────────────────────
# One corner across the laps
# ─────────────────────────────────────────────────────────────────────────────

_MEDIAN_KEYS = (
    "brake_at_turn_in_pct", "trail_s", "release_s", "coast_s",
    "transition_min_pct", "abs_in_trail_pct", "entry_time_s",
)
_ROW_KEYS = (
    "lap", "entry_time_s", "brake_at_turn_in_pct", "trail_s", "release_s",
    "coast_s", "restabs", "transition_min_pct", "abs_in_trail_pct",
)


def _median(rows: list[dict], key: str) -> float | None:
    vals = [r[key] for r in rows if r.get(key) is not None]
    return round(float(np.median(vals)), 3) if vals else None


def _summarise(c: dict, rows: list[dict]) -> dict:
    block: dict = {
        "id": c["id"],
        "start_pct": c["start_pct"],
        "apex_pct": c["apex_pct"],
        "end_pct": c["end_pct"],
        "laps_measured": len(rows),
    }
    braked = [r for r in rows if r.get("braked") and r.get("turn_in_found")]
    block["braked_laps"] = len(braked)
    if not rows:
        block["measured"] = False
        block["reason"] = "no clean lap could be read through this corner"
        return block
    if not braked:
        block["measured"] = False
        block["reason"] = (
            "taken without braking on every clean lap"
            if not any(r.get("braked") for r in rows)
            else "the brake came on but the car never turned enough to call a turn-in"
        )
        return block

    block["measured"] = True
    block["median"] = {k: _median(braked, k) for k in _MEDIAN_KEYS}
    block["median"]["restabs"] = _median(braked, "restabs")
    block["released_before_turn_in_laps"] = sum(
        1 for r in braked if r.get("trail_s") is not None and r["trail_s"] < 0
    )
    block["held_past_apex_laps"] = sum(1 for r in braked if not r.get("released_in_corner"))

    best = min(braked, key=lambda r: r["entry_time_s"])
    median_entry = block["median"]["entry_time_s"]
    block["best_entry"] = {
        **{k: best.get(k) for k in _ROW_KEYS},
        "gain_vs_median_s": (
            round(median_entry - best["entry_time_s"], 3) if median_entry is not None else None
        ),
    }
    block["trail_vs_entry"] = _link(braked)
    block["context"] = {
        "grade_pct": _median(braked, "grade_pct"),
        "load_g_onset": _median(braked, "load_g_onset"),
        "load_g_turn_in": _median(braked, "load_g_turn_in"),
        "lf_temp_middle_c": _median(braked, "lf_temp_middle_c"),
    }
    on, ti = block["context"]["load_g_onset"], block["context"]["load_g_turn_in"]
    block["context"]["load_drop_g"] = round(on - ti, 3) if on is not None and ti is not None else None
    block["per_lap"] = [{k: r.get(k) for k in _ROW_KEYS} for r in braked]
    return block


def _ranks(x: np.ndarray) -> np.ndarray:
    """Average ranks, so tied values do not invent an order."""
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x), dtype=np.float64)
    ranks[order] = np.arange(len(x), dtype=np.float64)
    for v in np.unique(x):
        tie = x == v
        ranks[tie] = ranks[tie].mean()
    return ranks


def _link(rows: list[dict]) -> dict:
    """Spearman correlation between trail length and entry time over these laps."""
    pairs = [(r["trail_s"], r["entry_time_s"]) for r in rows if r.get("trail_s") is not None]
    n = len(pairs)
    if n < _MIN_LAPS_FOR_LINK:
        return {
            "measured": False,
            "laps": n,
            "reason": f"only {n} laps with a measured trail; a link needs at least {_MIN_LAPS_FOR_LINK}",
        }
    trail = np.array([p[0] for p in pairs], dtype=np.float64)
    entry = np.array([p[1] for p in pairs], dtype=np.float64)
    rt, re = _ranks(trail), _ranks(entry)
    if rt.std() == 0 or re.std() == 0:
        return {
            "measured": True,
            "laps": n,
            "rho": None,
            "link": "none",
            "reason": "the trail or the entry time did not vary across these laps",
        }
    rho = float(np.corrcoef(rt, re)[0, 1])
    # Negative rho: a longer trail went with a SHORTER (quicker) entry.
    link = (
        "longer_trail_faster" if rho <= -_LINK_RHO
        else "longer_trail_slower" if rho >= _LINK_RHO
        else "none"
    )
    return {"measured": True, "laps": n, "rho": round(rho, 2), "link": link}


def _session_summary(corners: list[dict]) -> dict:
    measured = [c for c in corners if c.get("measured")]
    if not measured:
        return {"corners_measured": 0}
    before = [
        c["id"] for c in measured
        if c["median"].get("trail_s") is not None and c["median"]["trail_s"] < 0
    ]
    dips = [c for c in measured if c["median"].get("transition_min_pct") is not None]
    deepest = min(dips, key=lambda c: c["median"]["transition_min_pct"]) if dips else None
    restab = [c["id"] for c in measured if (c["median"].get("restabs") or 0) >= 1]
    linked = [c["id"] for c in measured if c["trail_vs_entry"].get("link") == "longer_trail_faster"]
    return {
        "corners_measured": len(measured),
        "released_before_turn_in": before,
        "deepest_dip": (
            {"id": deepest["id"], "transition_min_pct": deepest["median"]["transition_min_pct"]}
            if deepest else None
        ),
        "restab_corners": restab,
        "longer_trail_faster_corners": linked,
        "median_brake_at_turn_in_pct": _median(
            [c["median"] for c in measured], "brake_at_turn_in_pct"
        ),
    }
