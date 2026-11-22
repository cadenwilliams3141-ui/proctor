"""Every pass through every corner, measured at full rate in metres.

A RUN is one lap's pass through one segment (brake zone, corner, exit, and
the straight after it). Its metrics are read off the 60 Hz ticks and placed
between ticks by interpolation, so a brake point is resolved to well under a
metre even though ticks are a metre apart at speed.

Thresholds are absolute where the input has an absolute meaning (5% of brake
pedal is a press; 95% throttle is full) and relative to the run's OWN peak
where it does not (turn-in is 20% of the steering this pass used here — a
hairpin and a sweeper do not share a steering angle).

Every run carries flags saying whether it is fit to stand for the driver's
normal driving in that corner — off track, an incident, a tow down the
straight, a car in the way — judged per corner, not per lap, so one moment in
Turn 3 does not throw away a lap's good pass through Turn 7.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedLap, ParsedSession
from proctor_parser.timing import LapClock
from proctor_parser.track_model import (
    BRAKE_ON, BRAKE_HOLD_TICKS, CornerDef, TrackModel, _runs, brake_onset_index,
    fwd_dist, interp_cross,
)

# Run-quality flags (bitmask, stored per run in the payload).
OFF_TRACK = 1
INCIDENT = 2
TOW = 4
POST_INCIDENT = 8
PIT = 16
JUMP = 32
HELD_UP = 64
# Runs carrying any of these never enter the coach's statistics.
EXCLUDE = OFF_TRACK | INCIDENT | TOW | POST_INCIDENT | PIT | JUMP | HELD_UP
FLAG_NAMES = {
    OFF_TRACK: "off_track", INCIDENT: "incident", TOW: "tow",
    POST_INCIDENT: "after_incident", PIT: "pit", JUMP: "distance_jump",
    HELD_UP: "possible_traffic",
}

STATION_M = 2.0
TURN_IN_FRACTION = 0.20
THROTTLE_PICKUP = 0.10
PICKUP_HOLD_S = 0.10
THROTTLE_FULL = 0.95
FULL_HOLD_S = 0.30
COAST_BRAKE = 0.05
COAST_THROTTLE = 0.10
COAST_MIN_SPEED = 10.0
RELIFT_DROP = 0.20
EXIT_PROBE_M = 100.0
HELD_FLAT_SHARE = 0.80
HELD_MIN_STATIONS = 5
TOW_MIN_S = 2.0
TOW_MIN_RESID = 0.2          # m/s^2 (~0.02 g)
TOW_MIN_SPEED = 25.0
TOW_GAP_STATIONS = 4           # a gear change's worth of stations

TICK_KEYS = (
    "speed", "throttle", "brake_raw", "steer", "gear", "rpm", "lat_accel",
    "long_accel", "vert_accel", "yaw_rate", "vel_x", "vel_y",
    "lf_speed", "rf_speed", "lr_speed", "rr_speed", "abs_active", "incidents",
)
OPTIONAL_TICK_KEYS = ("track_surface", "track_surface_material")
STATION_KEYS = ("speed", "throttle", "brake_raw", "steer", "yaw_rate", "long_accel", "gear")


@dataclass
class Run:
    corner: int
    lap: int
    seg_len: float
    u: np.ndarray                 # tick distance from the segment start, m
    t: np.ndarray                 # tick seconds from the segment start
    ch: dict[str, np.ndarray]
    time_s: float
    time_at: object               # callable u -> seconds since segment start
    metrics: dict[str, float | None] = field(default_factory=dict)
    flags: int = 0
    stations: dict[str, np.ndarray] = field(default_factory=dict)
    lap_index: int = 0            # chronological order of the lap in the session

    @property
    def usable(self) -> bool:
        return not (self.flags & EXCLUDE)


# ─────────────────────────────────────────────────────────────────────────────
# building runs
# ─────────────────────────────────────────────────────────────────────────────

def _ticks(lap: ParsedLap, clock: LapClock, lo: float, hi: float):
    idx = np.flatnonzero((clock.tick_d_m >= lo) & (clock.tick_d_m < hi))
    return idx


def _gather(lap: ParsedLap, idx: np.ndarray) -> dict[str, np.ndarray]:
    out = {k: np.asarray(lap.raw[k], dtype=np.float64)[idx] for k in TICK_KEYS if k in lap.raw}
    for k in OPTIONAL_TICK_KEYS:
        if k in lap.raw:
            out[k] = np.asarray(lap.raw[k], dtype=np.float64)[idx]
    return out


def build_run(model: TrackModel, corner: CornerDef, lap: ParsedLap,
              next_lap: ParsedLap | None) -> Run | None:
    L = model.length_m
    b0, b1 = corner.seg_start_m, corner.seg_end_m
    seg_len = b1 - b0
    ck = model.clocks.get(lap.lap_number)
    if ck is None or not ck.complete:
        return None
    wraps = b1 > L + 1e-9
    if not wraps:
        if not ck.covers(b0, b1):
            return None
        t0 = float(ck.time_at(b0))
        t1 = float(ck.time_at(b1))
        idx = _ticks(lap, ck, b0, b1)
        u = ck.tick_d_m[idx] - b0
        t = ck.tick_t_s[idx] - t0
        ch = _gather(lap, idx)

        def time_at(uu, ck=ck, b0=b0, t0=t0):
            return np.interp(b0 + np.asarray(uu), ck.d_m, ck.t_s) - t0
    else:
        if next_lap is None:
            return None
        cn = model.clocks.get(next_lap.lap_number)
        head_end = b1 - L
        if cn is None or not cn.covers(0.0, head_end) or not ck.covers(b0, L):
            return None
        lap_t = float(ck.lap_time_s)
        t0 = float(ck.time_at(b0))
        t1 = lap_t + float(cn.time_at(head_end))
        i1 = _ticks(lap, ck, b0, L + 1.0)
        i2 = _ticks(next_lap, cn, 0.0, head_end)
        u = np.concatenate([ck.tick_d_m[i1] - b0, cn.tick_d_m[i2] + (L - b0)])
        t = np.concatenate([ck.tick_t_s[i1] - t0, cn.tick_t_s[i2] + lap_t - t0])
        a, bb = _gather(lap, i1), _gather(next_lap, i2)
        ch = {k: np.concatenate([a[k], bb[k]]) for k in a if k in bb}

        def time_at(uu, ck=ck, cn=cn, b0=b0, t0=t0, lap_t=lap_t, L=L):
            d = b0 + np.asarray(uu, dtype=np.float64)
            first = np.interp(np.minimum(d, L), ck.d_m, ck.t_s)
            second = lap_t + np.interp(np.maximum(d - L, 0.0), cn.d_m, cn.t_s)
            return np.where(d <= L, first, second) - t0
    if u.size < 10:
        return None
    # Monotonic distance for every per-tick lookup below.
    keep = np.concatenate(([True], np.diff(u) > 0))
    u, t = u[keep], t[keep]
    ch = {k: v[keep] for k, v in ch.items()}
    run = Run(corner=corner.id, lap=lap.lap_number, seg_len=seg_len, u=u, t=t, ch=ch,
              time_s=t1 - t0, time_at=time_at)
    if wraps and next_lap is not None and next_lap.is_out_lap:
        run.flags |= PIT
    return run


# ─────────────────────────────────────────────────────────────────────────────
# metrics
# ─────────────────────────────────────────────────────────────────────────────

def _first_held(mask: np.ndarray, start: int, hold: int) -> int | None:
    """First index >= start where mask is True for `hold` consecutive ticks."""
    if start >= len(mask):
        return None
    m = mask[start:]
    for a, b in _runs(m):
        if b - a >= hold:
            return int(start + a)
    return None


def _speed_at(u: np.ndarray, v: np.ndarray, at: float) -> float | None:
    if at < u[0] - 1.0 or at > u[-1] + 1.0:
        return None
    return float(np.interp(at, u, v))


def _reversals(x: np.ndarray, thr: float) -> int:
    """Direction changes of x, each larger than thr (hysteresis)."""
    if x.size < 3:
        return 0
    count = 0
    direction = 0
    ref = x[0]
    for v in x[1:]:
        if direction >= 0 and v < ref - thr:
            if direction > 0:
                count += 1
            direction, ref = -1, v
        elif direction <= 0 and v > ref + thr:
            if direction < 0:
                count += 1
            direction, ref = 1, v
        elif (direction > 0 and v > ref) or (direction < 0 and v < ref):
            ref = v
    return count


def measure(run: Run, corner: CornerDef, model: TrackModel, rate: int) -> None:
    L = model.length_m
    u, t, ch = run.u, run.t, run.ch
    v = ch["speed"]
    brake = ch["brake_raw"]
    thr = ch["throttle"]
    steer = np.abs(ch["steer"])
    b0 = corner.seg_start_m
    first_apex = fwd_dist(b0, corner.first_apex_m, L)
    last_apex = fwd_dist(b0, corner.last_apex_m, L)
    m: dict[str, float | None] = {}
    m["time_s"] = run.time_s
    m["v_entry"] = float(v[0])
    m["v_eos"] = float(v[-1])

    end_i = int(np.searchsorted(u, first_apex))
    k = brake_onset_index(brake, t, max(end_i, 1))
    m["brake_on"] = interp_cross(u, brake, k, BRAKE_ON) if k is not None else None
    release_i = None
    if k is not None:
        # The main braking zone ends at the FIRST apex. In a chicane, the
        # brief brake between the two halves is not part of it — letting it
        # compete for "peak" makes release and pickup flip between the two
        # halves from pass to pass, a measurement artefact that can then
        # correlate with lap time by accident.
        trail_room = 0.0 if corner.sub_apexes else 40.0
        stop = max(int(np.searchsorted(u, first_apex + trail_room)), k + 1)
        seg = brake[k:stop]
        pk = int(np.argmax(seg)) + k
        peak = float(brake[pk])
        m["brake_peak"] = peak
        reach = np.flatnonzero(brake[k:pk + 1] >= 0.9 * peak)
        dt = float(t[k + int(reach[0])] - t[k]) if reach.size else 0.0
        m["brake_attack"] = (0.9 * peak / dt) if dt > 1e-3 else None
        hold = BRAKE_HOLD_TICKS
        rel = _first_held(brake < BRAKE_ON, pk, hold)
        if rel is not None:
            release_i = rel
            m["release"] = interp_cross(u, brake, rel, BRAKE_ON)
        else:
            m["release"] = None
        on = (brake >= BRAKE_ON) & moving_mask(v)
        if "abs_active" in ch:
            m["abs_ms"] = float(np.count_nonzero(on & (ch["abs_active"] > 0.5)) * 1000.0 / rate)
    else:
        m["brake_peak"] = m["brake_attack"] = m["release"] = None
        m["abs_ms"] = 0.0 if "abs_active" in ch else None

    # Turn-in, relative to this run's own steering through the (first part of) the corner.
    lo_i = k if k is not None else 0
    hi_i = max(int(np.searchsorted(u, first_apex + 20.0)), lo_i + 1)
    peak_steer = float(steer[lo_i:hi_i].max()) if hi_i > lo_i else 0.0
    turnin_i = None
    if peak_steer > 0.02:
        idx = np.flatnonzero(steer[lo_i:hi_i] >= TURN_IN_FRACTION * peak_steer)
        if idx.size:
            turnin_i = lo_i + int(idx[0])
            m["turn_in"] = interp_cross(u, steer, turnin_i, TURN_IN_FRACTION * peak_steer)
    m.setdefault("turn_in", None)
    m["trail"] = (max(0.0, m["release"] - m["turn_in"])
                  if m.get("release") is not None and m["turn_in"] is not None else None)

    # Minimum speed, around the apex (or apexes).
    w = (u >= first_apex - 120.0) & (u <= last_apex + 120.0)
    if w.any():
        vw = v[w]
        floor = np.flatnonzero(vw <= vw.min() + 0.2)
        uw = u[w]
        m["v_min"] = float(vw.min())
        m["v_min_at"] = float(uw[floor[len(floor) // 2]])
        vmin_i = int(np.flatnonzero(w)[floor[len(floor) // 2]])
    else:
        m["v_min"] = m["v_min_at"] = None
        vmin_i = end_i

    # Throttle: pickup after the brakes come off, then full throttle.
    after = release_i if release_i is not None else (turnin_i if turnin_i is not None else 0)
    hold_p = max(1, int(round(PICKUP_HOLD_S * rate)))
    hold_f = max(1, int(round(FULL_HOLD_S * rate)))
    pick = _first_held(thr >= THROTTLE_PICKUP, after, hold_p)
    m["pickup"] = interp_cross(u, thr, pick, THROTTLE_PICKUP) if pick is not None else None
    # Full throttle on the way OUT: after the last apex of a complex (so the
    # burst between a chicane's halves does not count), and up to a second
    # before the slowest point of a simple corner.
    if corner.sub_apexes:
        full_from = int(np.searchsorted(u, last_apex))
    else:
        full_from = min(vmin_i, len(u) - 1) - int(rate)
    full = _first_held(thr >= THROTTLE_FULL, max(after, full_from), hold_f)
    m["full"] = interp_cross(u, thr, full, THROTTLE_FULL) if full is not None else None

    # Coasting: neither pedal, moving, from segment start up to full throttle.
    stop_i = full if full is not None else len(u)
    coast = (brake[:stop_i] < COAST_BRAKE) & (thr[:stop_i] < COAST_THROTTLE) & (v[:stop_i] > COAST_MIN_SPEED)
    du = np.diff(u[:stop_i + 1]) if stop_i < len(u) else np.diff(np.append(u, u[-1]))
    m["coast"] = float(np.sum(du[: coast.size][coast])) if coast.size else 0.0

    # Steering corrections between turn-in and full throttle.
    if turnin_i is not None:
        hi = full if full is not None else min(len(u), vmin_i + int(2 * rate))
        m["corrections"] = float(_reversals(ch["steer"][turnin_i:hi], max(0.02, 0.03 * peak_steer)))
    else:
        m["corrections"] = None

    # Throttle re-lifts between pickup and full.
    if pick is not None:
        hi = full if full is not None else len(u)
        seg = thr[pick:hi]
        runmax = np.maximum.accumulate(seg) if seg.size else seg
        dropped = (runmax >= 0.3) & (seg <= runmax - RELIFT_DROP)
        m["relifts"] = float(sum(1 for a, b in _runs(dropped) if b - a >= 3))
    else:
        m["relifts"] = None

    exit_at = last_apex + min(EXIT_PROBE_M, 0.5 * max(run.seg_len - last_apex, 0.0))
    m["v_exit"] = _speed_at(u, v, exit_at)
    run.metrics = m

    # Station resampling (run frame) for population comparisons.
    st = np.arange(STATION_M / 2, run.seg_len, STATION_M)
    run.stations = {"u": st}
    for key in STATION_KEYS:
        if key in ch:
            run.stations[key] = np.interp(st, u, ch[key])
    run.stations["t"] = np.asarray(run.time_at(st), dtype=np.float64)

    # Per-run flags that need only this run.
    if "track_surface" in ch:
        off = ch["track_surface"] == 0
        if any(b - a >= 3 for a, b in _runs(off)):
            run.flags |= OFF_TRACK
    inc = ch.get("incidents")
    if inc is not None and inc.size and float(inc[-1] - inc[0]) > 0:
        run.flags |= INCIDENT
    if u.size > 2:
        du = np.diff(u)
        dt = np.diff(t)
        expect = v[1:] * dt
        if np.any(np.abs(du - expect) > np.maximum(5.0, 0.5 * expect)):
            run.flags |= JUMP


# ─────────────────────────────────────────────────────────────────────────────
# population flags: possible traffic, tows, after an incident
# ─────────────────────────────────────────────────────────────────────────────

def _flag_held_up(runs: list[Run]) -> None:
    """A lift or brake where at least 80% of the other passes were flat out,
    after which this pass goes back to flat out. Proctor cannot see other cars;
    this is the shape a car in the way leaves, and nothing more is claimed.

    Flat out on both sides is what separates it from the driver's own habits:
    an early brake point is followed by more braking, never by full throttle,
    and a late throttle pickup is never preceded by full throttle."""
    if len(runs) < 4:
        return
    n_st = min(len(r.stations["u"]) for r in runs)
    flat = np.vstack([
        (r.stations["throttle"][:n_st] >= THROTTLE_FULL) & (r.stations["brake_raw"][:n_st] < BRAKE_ON)
        for r in runs
    ])
    for i, r in enumerate(runs):
        others = np.delete(flat, i, axis=0)
        share = others.mean(axis=0)
        not_flat = ~flat[i] & (share >= HELD_FLAT_SHARE)
        for a, b in _runs(not_flat):
            if b - a < HELD_MIN_STATIONS:
                continue
            # Flat out before AND after: a lift from full throttle and back.
            # Picking the throttle up late on the exit is never flat before,
            # and is the driver's own doing — it must stay in the statistics.
            was_flat = a >= HELD_MIN_STATIONS and bool(flat[i, a - HELD_MIN_STATIONS:a].all())
            if was_flat and b < n_st and flat[i, b]:
                r.flags |= HELD_UP
                break


def _flag_tows(all_runs: list[Run]) -> None:
    """Straight-line acceleration above what this session's car managed at
    the same speed, in the same gear, at the same place — a tow's signature.

    model(v, gear): the session's own median full-throttle acceleration per
    gear and 2 m/s speed bin. Subtracting it removes drag and gearing; then
    subtracting the per-station median of that residual across laps removes
    the hills, which are the same on every lap."""
    pts = []
    for r in all_runs:
        s = r.stations
        if "gear" not in s or "long_accel" not in s:
            continue
        ok = (s["throttle"] >= 0.98) & (s["brake_raw"] < 0.02) & (s["speed"] > TOW_MIN_SPEED) & (s["gear"] > 0.5)
        pts.append((s["gear"][ok].round(), s["speed"][ok], s["long_accel"][ok]))
    if not pts:
        return
    g = np.concatenate([p[0] for p in pts])
    v = np.concatenate([p[1] for p in pts])
    a = np.concatenate([p[2] for p in pts])
    model: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for gear in np.unique(g):
        sel = g == gear
        bins = np.floor(v[sel] / 2.0)
        centres, meds = [], []
        for b in np.unique(bins):
            mm = bins == b
            if np.count_nonzero(mm) >= 10:
                centres.append((b + 0.5) * 2.0)
                meds.append(float(np.median(a[sel][mm])))
        if len(centres) >= 2:
            model[int(gear)] = (np.array(centres), np.array(meds))
    if not model:
        return

    by_corner: dict[int, list[Run]] = {}
    for r in all_runs:
        by_corner.setdefault(r.corner, []).append(r)
    for runs in by_corner.values():
        if len(runs) < 4:
            continue
        n_st = min(len(r.stations["u"]) for r in runs)
        resid = np.full((len(runs), n_st), np.nan)
        for i, r in enumerate(runs):
            s = r.stations
            ok = ((s["throttle"][:n_st] >= 0.98) & (s["brake_raw"][:n_st] < 0.02)
                  & (s["speed"][:n_st] > TOW_MIN_SPEED))
            for gear, (cv, cm) in model.items():
                sel = ok & (np.round(s["gear"][:n_st]) == gear)
                if sel.any():
                    resid[i, sel] = s["long_accel"][:n_st][sel] - np.interp(s["speed"][:n_st][sel], cv, cm)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN stations are expected
            centre = np.nanmedian(resid, axis=0)
        excess = resid - centre
        allx = excess[np.isfinite(excess)]
        if allx.size < 20:
            continue
        thr = max(TOW_MIN_RESID, 3.0 * 1.4826 * float(np.median(np.abs(allx - np.median(allx)))))
        for i, r in enumerate(runs):
            st_t = r.stations["t"][:n_st]
            for a_, b_ in _bridged_runs(np.isfinite(excess[i]), max_gap=TOW_GAP_STATIONS):
                if float(st_t[b_ - 1] - st_t[a_]) < TOW_MIN_S:
                    continue
                vals = excess[i, a_:b_]
                vals = vals[np.isfinite(vals)]
                if vals.size >= 5 and float(np.median(vals)) > thr:
                    r.flags |= TOW
                    break


def _bridged_runs(mask: np.ndarray, max_gap: int) -> list[tuple[int, int]]:
    """True runs of `mask`, with False gaps of up to max_gap bridged. A
    straight is one straight even though every gear change interrupts the
    full-throttle stations for a moment."""
    runs = _runs(mask)
    if not runs:
        return []
    out = [list(runs[0])]
    for a, b in runs[1:]:
        if a - out[-1][1] <= max_gap:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def _flag_after_incident(runs_by_lap_corner: dict[tuple[int, int], Run], n_corners: int,
                         order: list[tuple[int, int]]) -> None:
    """The two segments after an incident are not normal driving either."""
    for i, key in enumerate(order):
        r = runs_by_lap_corner.get(key)
        if r is None or not (r.flags & INCIDENT):
            continue
        for k in (1, 2):
            if i + k < len(order):
                nxt = runs_by_lap_corner.get(order[i + k])
                if nxt is not None:
                    nxt.flags |= POST_INCIDENT


# ─────────────────────────────────────────────────────────────────────────────
# entry point
# ─────────────────────────────────────────────────────────────────────────────

def build_runs(session: ParsedSession, model: TrackModel) -> dict[int, list[Run]]:
    """Runs per corner id, in lap order. Only valid laps contribute runs."""
    rate = session.meta.tick_rate or 60
    laps = session.laps
    by_no = {lap.lap_number: lap for lap in laps}
    chron = {lap.lap_number: i for i, lap in enumerate(laps)}
    out: dict[int, list[Run]] = {c.id: [] for c in model.corners}
    keyed: dict[tuple[int, int], Run] = {}
    for lap in laps:
        if not lap.is_valid:
            continue
        nxt = by_no.get(lap.lap_number + 1)
        for c in model.corners:
            r = build_run(model, c, lap, nxt)
            if r is None:
                continue
            r.lap_index = chron[lap.lap_number]
            measure(r, c, model, rate)
            out[c.id].append(r)
            keyed[(lap.lap_number, c.id)] = r
    for runs in out.values():
        _flag_held_up(runs)
    _flag_tows([r for runs in out.values() for r in runs])
    order = [(lap.lap_number, c.id) for lap in laps for c in model.corners]
    _flag_after_incident(keyed, len(model.corners), order)
    return out
