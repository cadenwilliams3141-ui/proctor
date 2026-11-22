"""The watcher: what happened, tick by tick, on every pass through every corner.

Each detector reads measured channels only. Where a threshold has a physical
meaning it is absolute (a wheel turning 15% slower than the car is a wheel
locking, whatever the car); where it does not, it comes from the driver's OWN
passes through the same corner (a slide is body slip beyond what this driver
normally carries HERE).

Every event is tied to a lap, a place on the track, a corner and a phase of
that corner. A kind that never happened is reported as "none observed" — a
finding — and a kind whose channel the file does not carry is reported as
"not checkable", never as zero.

Copy describes the car ("turned less per degree of lock than your other passes
here"), never intent.
"""

from __future__ import annotations

import warnings

import numpy as np

from proctor_parser.phases import (
    EXCLUDE, HELD_UP, OFF_TRACK, TOW, Run, _runs,
)
from proctor_parser.track_model import CornerDef, TrackModel, fwd_dist

KINDS = (
    "lockup", "wheelspin", "oversteer", "understeer", "coasting",
    "brake_pumping", "throttle_hesitation", "slow_shift", "over_rev",
    "off_track", "kerb_strike", "heavy_abs", "tow", "possible_traffic",
)
# Kinds that are the driver's own driving: these get a time link. The others
# are reasons a pass is left out of the statistics, and are counted only.
DRIVING_KINDS = (
    "lockup", "wheelspin", "oversteer", "understeer", "coasting",
    "brake_pumping", "throttle_hesitation", "slow_shift", "over_rev",
    "kerb_strike", "heavy_abs",
)
FIELDS = ["lap", "at_m", "corner", "phase", "kind", "sev", "dur_ms", "a", "b"]
WHEELS = ("lf_speed", "rf_speed", "lr_speed", "rr_speed")
EVENT_CAP = 400

LOCKUP_SLIP = -0.15
WHEELSPIN_SLIP = 0.12
MIN_WHEEL_SPEED = 10.0
HOLD_TICKS = 3
SLIDE_MARGIN_DEG = 1.5
SLIDE_FLOOR_DEG = 3.0
SLIDE_TICKS = 6
COUNTER_TICKS = 5
COUNTER_YAW = 0.15
COUNTER_STEER = 0.05
UNDER_RATIO = 0.85
UNDER_STEER = 1.10
UNDER_STATIONS = 5
COAST_S = 0.3
PUMP_WINDOW_S = 0.5
HESITATE_DROP = 0.30
HESITATE_WINDOW_S = 1.5
SLOW_SHIFT_MIN_S = 0.15
SLOW_SHIFT_FACTOR = 3.0
HEAVY_ABS_SHARE = 0.5
HEAVY_ABS_MIN_S = 0.3
KERB_MATERIALS = (11, 12, 13, 14)
# Past the redline the sim quotes, with room for the limiter: only a genuine
# over-rev on a downshift is reported.
OVER_REV_MARGIN = 1.03
KERB_SPIKE_G = 1.0
G = 9.81


def landmarks(runs: list[Run]) -> dict[str, float | None]:
    """Typical positions in a corner, from the usable passes: brake point,
    turn-in, apex (slowest point) and full throttle, in segment metres."""
    use = [r for r in runs if r.usable] or runs
    out = {}
    for key in ("brake_on", "turn_in", "v_min_at", "full"):
        vals = [r.metrics.get(key) for r in use if r.metrics.get(key) is not None]
        out[key] = float(np.median(vals)) if vals else None
    return out


def phase_of(u: float, lm: dict[str, float | None]) -> str:
    order = [("approach", lm.get("brake_on")), ("braking", lm.get("turn_in")),
             ("entry", lm.get("v_min_at")), ("mid", lm.get("full"))]
    for name, edge in order:
        if edge is not None and u < edge:
            return name
    full = lm.get("full")
    if full is not None and u < full + 150.0:
        return "exit"
    return "straight"


def _steer_yaw_sign(all_runs: list[Run]) -> float:
    """Whether positive steering produces positive yaw rate in this file.
    Measured, not assumed — sign conventions differ between sources."""
    num = []
    for r in all_runs:
        s, y = r.ch["steer"], r.ch["yaw_rate"]
        m = (np.abs(y) > 0.1) & (np.abs(s) > 0.05)
        if m.any():
            num.append(np.sign(s[m] * y[m]))
    if not num:
        return 1.0
    med = float(np.median(np.concatenate(num)))
    return -1.0 if med < 0 else 1.0


class _Collector:
    def __init__(self, model: TrackModel):
        self.model = model
        self.rows: list[list] = []

    def add(self, run: Run, corner: CornerDef, lm, i: int, kind: str, sev: float,
            dur_ms: float, a=None, b=None) -> None:
        u = float(run.u[min(i, len(run.u) - 1)])
        at = (corner.seg_start_m + u) % self.model.length_m
        self.rows.append([
            int(run.lap), round(at, 1), int(corner.id), phase_of(u, lm), kind,
            round(float(sev), 3), int(round(dur_ms)),
            None if a is None else (round(float(a), 3) if isinstance(a, float) else a),
            None if b is None else (round(float(b), 3) if isinstance(b, float) else b),
        ])


def _held(mask: np.ndarray, hold: int) -> list[tuple[int, int]]:
    return [(a, b) for a, b in _runs(mask) if b - a >= hold]


def detect(model: TrackModel, runs_by_corner: dict[int, list[Run]], *,
           tick_rate: int, redline: float | None) -> dict:
    rate = tick_rate or 60
    col = _Collector(model)
    all_runs = [r for rs in runs_by_corner.values() for r in rs]
    unavailable: dict[str, str] = {}
    if not all_runs:
        return {"rows": [], "unavailable": unavailable, "laps": [], "kinds_checked": []}

    sign = _steer_yaw_sign(all_runs)
    has_surface = all("track_surface" in r.ch for r in all_runs)
    has_material = all("track_surface_material" in r.ch for r in all_runs)
    if not has_surface:
        unavailable["off_track"] = "PlayerTrackSurface is not in this file"
    if not has_material:
        unavailable["kerb_strike"] = "PlayerTrackSurfaceMaterial is not in this file"
    if redline is None or redline <= 0:
        unavailable["over_rev"] = "the session info carries no redline for this car"

    # Session-wide neutral durations, for "slow shift" relative to this driver.
    neutral_s = []
    for r in all_runs:
        g = r.ch["gear"]
        for a, b in _runs((np.round(g) == 0) & (r.ch["speed"] > MIN_WHEEL_SPEED)):
            neutral_s.append((b - a) / rate)
    shift_limit = max(SLOW_SHIFT_MIN_S, SLOW_SHIFT_FACTOR * float(np.median(neutral_s))) if neutral_s else None

    corners = {c.id: c for c in model.corners}
    for cid, runs in runs_by_corner.items():
        c = corners[cid]
        lm = landmarks(runs)
        usable = [r for r in runs if r.usable] or runs
        # Per-corner slip baseline from this driver's own passes.
        betas = np.concatenate([
            np.degrees(np.abs(np.arctan2(r.ch["vel_y"], np.maximum(np.abs(r.ch["vel_x"]), 1.0))))[r.ch["speed"] > 15]
            for r in usable
        ]) if usable else np.empty(0)
        slide_thr = max(SLIDE_FLOOR_DEG, float(np.percentile(betas, 95)) + SLIDE_MARGIN_DEG) if betas.size else None
        under = _understeer_baseline(usable, sign)

        for r in runs:
            ch, v = r.ch, r.ch["speed"]
            moving = v > MIN_WHEEL_SPEED
            brake, thr = ch["brake_raw"], ch["throttle"]

            # Lockup and wheelspin: any wheel against the car's speed.
            for wi, wk in enumerate(WHEELS):
                if wk not in ch:
                    continue
                slip = np.where(moving, ch[wk] / np.maximum(v, 1.0) - 1.0, 0.0)
                for a, b in _held(moving & (brake > 0.1) & (slip < LOCKUP_SLIP), HOLD_TICKS):
                    col.add(r, c, lm, a, "lockup", float(slip[a:b].min()), (b - a) * 1000 / rate, wi, float(brake[a]))
                for a, b in _held(moving & (thr > 0.5) & (brake < 0.05) & (slip > WHEELSPIN_SLIP), HOLD_TICKS):
                    col.add(r, c, lm, a, "wheelspin", float(slip[a:b].max()), (b - a) * 1000 / rate, wi, float(thr[a]))

            # Oversteer: slip beyond this driver's norm here, or countersteer.
            beta = np.degrees(np.abs(np.arctan2(ch["vel_y"], np.maximum(np.abs(ch["vel_x"]), 1.0))))
            fast = v > 15
            found = False
            if slide_thr is not None:
                for a, b in _held(fast & (beta > slide_thr), SLIDE_TICKS):
                    col.add(r, c, lm, a, "oversteer", float(beta[a:b].max()), (b - a) * 1000 / rate, "slip", slide_thr)
                    found = True
            counter = fast & (ch["steer"] * ch["yaw_rate"] * sign < 0) & (np.abs(ch["yaw_rate"]) > COUNTER_YAW) & (np.abs(ch["steer"]) > COUNTER_STEER)
            if not found:
                for a, b in _held(counter, COUNTER_TICKS):
                    col.add(r, c, lm, a, "oversteer", float(beta[a:b].max()), (b - a) * 1000 / rate, "countersteer", None)

            # Understeer: turning less per degree of lock than usual here, with more lock.
            if under is not None:
                _understeer(col, r, c, lm, under, sign)

            # Coasting: neither pedal, moving.
            hold = max(1, int(round(COAST_S * rate)))
            for a, b in _held(moving & (brake < 0.05) & (thr < 0.10), hold):
                col.add(r, c, lm, a, "coasting", (b - a) / rate, (b - a) * 1000 / rate)

            _brake_pumping(col, r, c, lm, rate)
            _hesitation(col, r, c, lm, rate)

            g = np.round(ch["gear"])
            if shift_limit is not None:
                for a, b in _runs((g == 0) & moving):
                    if (b - a) / rate > shift_limit:
                        col.add(r, c, lm, a, "slow_shift", (b - a) / rate, (b - a) * 1000 / rate, shift_limit)
            if "over_rev" not in unavailable:
                # Gearboxes pass through neutral (3 -> 0 -> 4): a downshift is
                # the last ENGAGED gear going down, never a step to neutral.
                engaged = _engaged(g)
                down = np.flatnonzero(np.diff(engaged) < 0) + 1
                window = int(0.5 * rate)
                over = ch["rpm"] > OVER_REV_MARGIN * redline
                for d in down:
                    seg = over[d:d + window]
                    hot = [(a, b) for a, b in _runs(seg) if b - a >= 2]
                    if hot:
                        a, b = hot[0]
                        col.add(r, c, lm, d + a, "over_rev", float(ch["rpm"][d + a:d + b].max()), (b - a) * 1000 / rate, redline)

            if has_surface:
                for a, b in _held(ch["track_surface"] == 0, HOLD_TICKS):
                    col.add(r, c, lm, a, "off_track", (b - a) / rate, (b - a) * 1000 / rate)
            if has_material:
                vert = ch["vert_accel"]
                spike = np.abs(vert - np.median(vert)) > KERB_SPIKE_G * G
                on_kerb = np.isin(np.round(ch["track_surface_material"]), KERB_MATERIALS)
                for a, b in _runs(spike & on_kerb):
                    col.add(r, c, lm, a, "kerb_strike", float(np.abs(vert[a:b] - np.median(vert)).max() / G), (b - a) * 1000 / rate)

            if "abs_active" in ch:
                on = moving & (brake > 0.05)
                n_on = int(np.count_nonzero(on))
                n_abs = int(np.count_nonzero(on & (ch["abs_active"] > 0.5)))
                if n_on and n_abs / n_on >= HEAVY_ABS_SHARE and n_abs / rate >= HEAVY_ABS_MIN_S:
                    first = int(np.flatnonzero(on & (ch["abs_active"] > 0.5))[0])
                    col.add(r, c, lm, first, "heavy_abs", n_abs / n_on, n_abs * 1000 / rate)

            if r.flags & TOW:
                col.add(r, c, lm, len(r.u) - 1, "tow", 1.0, 0)
            if r.flags & HELD_UP:
                col.add(r, c, lm, len(r.u) // 2, "possible_traffic", 1.0, 0)

    laps = sorted({r.lap for r in all_runs})
    return {"rows": col.rows, "unavailable": unavailable, "laps": laps,
            "kinds_checked": [k for k in KINDS if k not in unavailable]}


def _engaged(gear: np.ndarray) -> np.ndarray:
    """Gear with neutral ticks carrying the last engaged gear forward."""
    g = np.asarray(gear, dtype=np.float64).copy()
    idx = np.where(g > 0, np.arange(len(g)), 0)
    np.maximum.accumulate(idx, out=idx)
    filled = g[idx]
    filled[(idx == 0) & (g <= 0)] = 0
    return filled


def _understeer_baseline(runs: list[Run], sign: float):
    if len(runs) < 4:
        return None
    n = min(len(r.stations["u"]) for r in runs)
    steer = np.vstack([r.stations["steer"][:n] for r in runs])
    yaw = np.vstack([r.stations["yaw_rate"][:n] for r in runs]) * sign
    v = np.vstack([r.stations["speed"][:n] for r in runs])
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # straights have no ratio
        ratio = np.where((np.abs(steer) > 0.05) & (v > 10), yaw / steer, np.nan)
        med_ratio = np.nanmedian(ratio, axis=0) if np.isfinite(ratio).any() else None
    if med_ratio is None:
        return None
    return {"n": n, "ratio": med_ratio, "steer": np.median(np.abs(steer), axis=0)}


def _understeer(col: _Collector, r: Run, c: CornerDef, lm, base, sign: float) -> None:
    n = base["n"]
    s = r.stations
    steer = s["steer"][:n]
    with np.errstate(all="ignore"):
        ratio = np.where((np.abs(steer) > 0.05) & (s["speed"][:n] > 10), s["yaw_rate"][:n] * sign / steer, np.nan)
        hot = (np.isfinite(ratio) & np.isfinite(base["ratio"]) & (base["ratio"] > 0)
               & (ratio < UNDER_RATIO * base["ratio"]) & (np.abs(steer) > UNDER_STEER * base["steer"]))
    for a, b in _runs(hot):
        if b - a >= UNDER_STATIONS:
            i = int(np.searchsorted(r.u, s["u"][a]))
            sev = float(1.0 - np.nanmin(ratio[a:b] / base["ratio"][a:b]))
            dur = float(s["t"][b - 1] - s["t"][a]) * 1000
            col.add(r, c, lm, i, "understeer", sev, dur)


def _brake_pumping(col: _Collector, r: Run, c: CornerDef, lm, rate: int) -> None:
    brake = r.ch["brake_raw"]
    bo = r.metrics.get("brake_on")
    if bo is None:
        return
    first_apex = fwd_dist(c.seg_start_m, c.first_apex_m, col.model.length_m)
    i0 = int(np.searchsorted(r.u, bo))
    i1 = int(np.searchsorted(r.u, first_apex))
    seg = brake[i0:i1]
    if seg.size < 6:
        return
    runmax = np.maximum.accumulate(seg)
    low = (runmax >= 0.3) & (seg < np.maximum(0.05, 0.3 * runmax))
    win = int(PUMP_WINDOW_S * rate)
    for a, b in _runs(low):
        back = seg[b:b + win]
        if back.size and np.any(back >= 0.5 * runmax[a]):
            col.add(r, c, lm, i0 + a, "brake_pumping", float(runmax[a] - seg[a:b].min()), (b - a) * 1000 / rate)


def _hesitation(col: _Collector, r: Run, c: CornerDef, lm, rate: int) -> None:
    thr, brake = r.ch["throttle"], r.ch["brake_raw"]
    at = r.metrics.get("v_min_at")
    if at is None:
        return
    # Not before the corner's LAST apex: the lift between the two halves of a
    # chicane is the chicane, not a hesitation.
    last_apex = fwd_dist(c.seg_start_m, c.last_apex_m, col.model.length_m)
    i0 = int(np.searchsorted(r.u, max(at, last_apex)))
    reach = np.flatnonzero(thr[i0:] >= 0.5)
    if reach.size == 0:
        return
    s0 = i0 + int(reach[0])
    s1 = min(len(thr), s0 + int(HESITATE_WINDOW_S * rate))
    seg = thr[s0:s1]
    runmax = np.maximum.accumulate(seg)
    drop = (seg <= runmax - HESITATE_DROP) & (brake[s0:s1] < 0.05)
    for a, b in _runs(drop):
        if b - a >= HOLD_TICKS:
            col.add(r, c, lm, s0 + a, "throttle_hesitation", float(runmax[a] - seg[a:b].min()), (b - a) * 1000 / rate)
            break


def summarise(model: TrackModel, runs_by_corner: dict[int, list[Run]], found: dict) -> dict:
    """The watch payload: events, counts, and the time each kind went with."""
    rows = found["rows"]
    capped = len(rows) > EVENT_CAP
    if capped:
        # Keep the most severe of each kind, round-robin, so one noisy kind
        # cannot crowd out the rest.
        by_kind: dict[str, list] = {}
        for row in rows:
            by_kind.setdefault(row[4], []).append(row)
        for k in by_kind:
            by_kind[k].sort(key=lambda r: -abs(r[5]))
        kept = []
        while len(kept) < EVENT_CAP and any(by_kind.values()):
            for k in list(by_kind):
                if by_kind[k]:
                    kept.append(by_kind[k].pop(0))
        stored = sorted(kept, key=lambda r: (r[0], r[1]))
    else:
        stored = sorted(rows, key=lambda r: (r[0], r[1]))

    counts: dict[str, int] = {}
    matrix: dict[str, dict[str, int]] = {}
    per_lap: dict[str, dict[str, int]] = {}
    for row in rows:
        lap, _, cid, _, kind = row[:5]
        counts[kind] = counts.get(kind, 0) + 1
        matrix.setdefault(str(cid), {}).setdefault(kind, 0)
        matrix[str(cid)][kind] += 1
        per_lap.setdefault(str(lap), {}).setdefault(kind, 0)
        per_lap[str(lap)][kind] += 1

    links = []
    with_event: dict[tuple[int, str], set[int]] = {}
    for row in rows:
        with_event.setdefault((row[2], row[4]), set()).add(row[0])
    for (cid, kind), laps in sorted(with_event.items()):
        if kind not in DRIVING_KINDS:
            continue
        usable = [r for r in runs_by_corner.get(cid, []) if r.usable]
        yes = [r.time_s for r in usable if r.lap in laps]
        no = [r.time_s for r in usable if r.lap not in laps]
        if len(yes) >= 2 and len(no) >= 3:
            links.append({
                "corner": int(cid), "kind": kind, "n_with": len(yes), "n_without": len(no),
                "median_delta_s": round(float(np.median(yes) - np.median(no)), 3),
            })

    checked = found["kinds_checked"]
    return {
        "fields": FIELDS,
        "events": stored,
        "capped": capped,
        "counts": counts,
        "matrix": matrix,
        "per_lap": per_lap,
        "links": links,
        "none_observed": [k for k in checked if k not in counts],
        "unavailable": found["unavailable"],
        "laps_watched": found["laps"],
    }
