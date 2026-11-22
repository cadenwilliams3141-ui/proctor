"""This session's track, as the driver drove it: corners, kinks and segments.

Everything is measured in METRES along the lap on a 2 m station grid, so the
same smoothing means the same thing at Long Beach and at the Nordschleife (the
old 1000-bin grid made a 15-bin window 48 m at one and 312 m at the other).

CORNERS come from the MEDIAN speed profile of the clean laps — one lap's
moment cannot invent or hide a corner — and must also turn the car: a speed
dip without at least 10 degrees of heading change is not a corner. Heading is
the direction of travel, Yaw plus the body slip angle atan2(VelocityY,
VelocityX), so it is the path, not where the nose points.

- A dip containing two opposite heading lobes (a chicane, an S) is ONE corner
  of kind "complex" with sub-apexes. Advice for half a chicane contradicts
  itself: gaining in the first part routinely costs the second.
- A heading change with no speed dip is a KINK. It gets no segment of its own;
  it is a place a lift would show up.
- The grid wraps, so a corner across the start/finish line is found.

SEGMENTS partition the lap with no gaps or overlaps. Each starts 30 m before
the earliest typical brake point for its corner (the 5th percentile across
clean laps) and runs through the corner, the exit and the whole following
straight to the next segment. So the time a poor exit costs down the straight
is billed to the corner that caused it, and the boundary sits where braking is
about to equalise speeds between laps, which keeps carry-over small.

Corner numbers are Proctor's own, counted from the start/finish line. They
are not the circuit's official turn names, and the payload says so.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from proctor_parser.analysis.common import is_clean
from proctor_parser.session import ParsedLap, ParsedSession
from proctor_parser.timing import LapClock, session_clocks

STATION_M = 2.0
SMOOTH_M = 25.0
CURV_SMOOTH_M = 20.0
MIN_PROMINENCE_MS = 3.0
MIN_PROMINENCE_FRAC = 0.05
MIN_CORNER_TURN_DEG = 10.0
LOBE_MIN_DEG = 12.0
LOBE_CURVATURE = 1.0 / 600.0
KINK_CURVATURE = 1.0 / 800.0
KINK_MIN_DEG = 8.0
MAX_PLAUSIBLE_RADIUS_M = 1500.0
BOUNDARY_LEAD_M = 30.0
MIN_SEGMENT_M = 120.0
BRAKE_ON = 0.05
BRAKE_HOLD_TICKS = 3
PUMP_GAP_S = 0.5
LIFT_THROTTLE = 0.9
LIFT_HOLD_S = 0.2


@dataclass
class CornerDef:
    id: int                  # 1-based, in lap order from the line
    apex_m: float
    valley: tuple[float, float]   # flanking speed peaks of the median profile
    kind: str                # "brake" | "lift" | "flat" — refined after onsets
    complex: bool
    dir: str | None          # "left" | "right"
    radius_m: float | None
    vmin_ms: float
    turn_deg: float
    sub_apexes: list[dict] = field(default_factory=list)
    seg_start_m: float = 0.0
    seg_end_m: float = 0.0   # may exceed length (wraps)

    @property
    def first_apex_m(self) -> float:
        """Where the braking INTO this corner ends. For a complex, its first
        part: the brief brake between the two halves of a chicane is not the
        brake point."""
        return self.sub_apexes[0]["apex_m"] if self.sub_apexes else self.apex_m

    @property
    def last_apex_m(self) -> float:
        return self.sub_apexes[-1]["apex_m"] if self.sub_apexes else self.apex_m


@dataclass
class StationProfile:
    lap: int
    v: np.ndarray            # m/s at each station
    heading: np.ndarray      # unwrapped path heading, rad
    throttle: np.ndarray
    brake: np.ndarray


@dataclass
class TrackModel:
    length_m: float
    length_source: str
    stations: np.ndarray
    clocks: dict[int, LapClock]
    profile_laps: list[int]
    median_v: np.ndarray
    curvature: np.ndarray    # 1/m, positive = left, median across laps
    corners: list[CornerDef]
    kinks: list[dict]
    onsets: dict[int, dict[int, dict]]   # corner id -> lap -> {"brake_m", "lift_m"}
    insufficient: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────

def circ_smooth(y: np.ndarray, window: int) -> np.ndarray:
    """Centred moving average on a ring."""
    n = len(y)
    if window <= 1 or n == 0:
        return np.asarray(y, dtype=np.float64).copy()
    window = min(window, n)
    pad = window // 2
    yy = np.concatenate([y[-pad:], y, y[: window - pad - 1]]) if pad else np.concatenate([y, y[: window - 1]])
    c = np.cumsum(np.insert(np.asarray(yy, dtype=np.float64), 0, 0.0))
    return (c[window:] - c[:-window])[:n] / window


def wrap_m(d: float, length: float) -> float:
    return d % length


def fwd_dist(a: float, b: float, length: float) -> float:
    """Distance travelling forward from a to b on the ring."""
    return (b - a) % length


def _monotonic(d: np.ndarray, *others: np.ndarray):
    keep = np.concatenate(([True], np.diff(d) > 0)) if len(d) > 1 else np.ones(len(d), bool)
    return (d[keep],) + tuple(o[keep] for o in others)


def lap_on_stations(lap: ParsedLap, clock: LapClock, stations: np.ndarray, key: str) -> np.ndarray:
    d, vals = _monotonic(clock.tick_d_m, np.asarray(lap.raw[key], dtype=np.float64))
    return np.interp(stations, d, vals)


def path_heading(lap: ParsedLap) -> np.ndarray:
    """Unwrapped direction of travel per tick: Yaw + body slip angle."""
    yaw = np.unwrap(np.asarray(lap.raw["yaw"], dtype=np.float64))
    vx = np.asarray(lap.raw["vel_x"], dtype=np.float64)
    vy = np.asarray(lap.raw["vel_y"], dtype=np.float64)
    beta = np.where(np.abs(vx) > 3.0, np.arctan2(vy, np.maximum(np.abs(vx), 1e-6)), 0.0)
    return yaw + beta


def _local_minima_ring(v: np.ndarray) -> list[int]:
    """Minima on a ring, tolerant of flat floors (the floor's centre is used)."""
    n = len(v)
    sign = np.sign(np.diff(np.concatenate([v, v[:1]])))
    nz = np.flatnonzero(sign != 0)
    if nz.size < 2:
        return []
    out = []
    m = len(nz)
    for a in range(m):
        i, j = nz[a], nz[(a + 1) % m]
        if sign[i] < 0 and sign[j] > 0:
            lo = (i + 1) % n
            span = (j - i) % n
            out.append(int((lo + (span - 1) // 2) % n) if span > 0 else int(lo))
    return sorted(set(out))


def _ring_max_between(v: np.ndarray, a: int, b: int) -> tuple[float, int]:
    """Max of v walking forward from a to b (exclusive of neither)."""
    n = len(v)
    idx = (a + np.arange((b - a) % n + 1)) % n
    k = int(np.argmax(v[idx]))
    return float(v[idx][k]), int(idx[k])


# ─────────────────────────────────────────────────────────────────────────────
# corners
# ─────────────────────────────────────────────────────────────────────────────

def _find_corners(v: np.ndarray, kappa: np.ndarray, stations: np.ndarray) -> list[CornerDef]:
    n = len(v)
    mins = _local_minima_ring(v)
    # Merge valleys separated by a hump smaller than the prominence threshold:
    # repeatedly drop the least prominent minimum until all pass.
    while len(mins) > 1:
        proms = []
        for k, i in enumerate(mins):
            prev_i, next_i = mins[k - 1], mins[(k + 1) % len(mins)]
            lmax, _ = _ring_max_between(v, prev_i, i)
            rmax, _ = _ring_max_between(v, i, next_i)
            flank = min(lmax, rmax)
            thr = max(MIN_PROMINENCE_MS, MIN_PROMINENCE_FRAC * flank)
            proms.append((flank - v[i]) / thr)
        worst = int(np.argmin(proms))
        if proms[worst] >= 1.0:
            break
        mins.pop(worst)
    if len(mins) == 1:
        i = mins[0]
        lmax = float(v.max())
        if lmax - v[i] < max(MIN_PROMINENCE_MS, MIN_PROMINENCE_FRAC * lmax):
            mins = []

    corners: list[CornerDef] = []
    for k, i in enumerate(mins):
        prev_i = mins[k - 1] if len(mins) > 1 else (i + 1) % n
        next_i = mins[(k + 1) % len(mins)] if len(mins) > 1 else (i - 1) % n
        _, lpk = _ring_max_between(v, prev_i, i)
        _, rpk = _ring_max_between(v, i, next_i)
        span = (rpk - lpk) % n
        idx = (lpk + np.arange(span + 1)) % n
        turn = float(np.sum(np.abs(kappa[idx])) * STATION_M)
        if np.degrees(turn) < MIN_CORNER_TURN_DEG:
            continue
        # Apex: centre of the floor within 0.3 m/s of the minimum.
        floor = idx[v[idx] <= v[i] + 0.3]
        apex_i = int(floor[len(floor) // 2]) if floor.size else i
        lobes = _lobes(kappa, idx)
        is_complex = len({lb["sign"] for lb in lobes}) > 1
        main = max(lobes, key=lambda lb: lb["deg"]) if lobes else None
        near = (apex_i + np.arange(-5, 6)) % n
        kap_apex = float(np.median(np.abs(kappa[near])))
        radius = 1.0 / kap_apex if kap_apex > 0 else None
        if radius is not None and radius > MAX_PLAUSIBLE_RADIUS_M:
            radius = None
        net = float(np.sum(kappa[idx]))
        direction = None
        if main is not None:
            direction = "left" if main["sign"] > 0 else "right"
        elif abs(net) > 0:
            direction = "left" if net > 0 else "right"
        corners.append(CornerDef(
            id=0, apex_m=float(stations[apex_i]),
            valley=(float(stations[lpk]), float(stations[rpk])),
            kind="brake", complex=is_complex, dir=direction,
            radius_m=None if radius is None else round(radius, 1),
            vmin_ms=float(v[apex_i]), turn_deg=float(np.degrees(turn)),
            sub_apexes=[{"apex_m": round(float(stations[lb["peak"]]), 1),
                         "dir": "left" if lb["sign"] > 0 else "right",
                         "deg": round(lb["deg"], 1)} for lb in lobes] if is_complex else [],
        ))
    corners.sort(key=lambda c: c.apex_m)
    for k, c in enumerate(corners, start=1):
        c.id = k
    return corners


def _lobes(kappa: np.ndarray, idx: np.ndarray) -> list[dict]:
    """Same-sign runs of real curvature inside a valley, each >= LOBE_MIN_DEG."""
    k = kappa[idx]
    sig = np.where(np.abs(k) > LOBE_CURVATURE, np.sign(k), 0)
    out = []
    i = 0
    while i < len(sig):
        if sig[i] == 0:
            i += 1
            continue
        j = i
        while j + 1 < len(sig) and sig[j + 1] == sig[i]:
            j += 1
        deg = float(np.degrees(np.sum(np.abs(k[i:j + 1])) * STATION_M))
        if deg >= LOBE_MIN_DEG:
            peak = int(idx[i + int(np.argmax(np.abs(k[i:j + 1])))])
            out.append({"sign": int(sig[i]), "deg": deg, "peak": peak})
        i = j + 1
    return out


def _find_kinks(kappa: np.ndarray, stations: np.ndarray, corners: list[CornerDef],
                length: float) -> list[dict]:
    n = len(kappa)
    curved = np.abs(kappa) > KINK_CURVATURE
    out = []
    i = 0
    visited = np.zeros(n, dtype=bool)
    while i < n:
        if not curved[i] or visited[i]:
            i += 1
            continue
        j = i
        while curved[(j + 1) % n] and not visited[(j + 1) % n] and (j + 1 - i) < n:
            j += 1
        run = (i + np.arange(j - i + 1)) % n
        visited[run] = True
        deg = float(np.degrees(np.sum(kappa[run]) * STATION_M))
        mid = float(stations[run[len(run) // 2]])
        # Inside a corner means near one of its apexes. The speed valley is
        # no guide: it runs to the next braking point, straights and all.
        apexes = [c.apex_m for c in corners] + [sa["apex_m"] for c in corners for sa in c.sub_apexes]
        inside = any(min(fwd_dist(a, mid, length), fwd_dist(mid, a, length)) < 100.0 for a in apexes)
        if abs(deg) >= KINK_MIN_DEG and not inside:
            out.append({"at_m": round(mid, 1), "dir": "left" if deg > 0 else "right",
                        "deg": round(abs(deg), 1)})
        i = j + 1
    return out


# ─────────────────────────────────────────────────────────────────────────────
# brake and lift onsets, per lap and corner
# ─────────────────────────────────────────────────────────────────────────────

def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) of True runs."""
    if mask.size == 0:
        return []
    m = np.concatenate(([False], mask, [False]))
    d = np.diff(m.astype(np.int8))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def brake_onset_index(brake: np.ndarray, t: np.ndarray, end: int) -> int | None:
    """Tick at which the braking that leads into `end` began.

    The last sustained application before `end`, with releases shorter than
    PUMP_GAP_S bridged — a pumped brake is one braking zone, not two."""
    on = brake[:end] >= BRAKE_ON
    runs = [r for r in _runs(on) if r[1] - r[0] >= BRAKE_HOLD_TICKS]
    if not runs:
        return None
    start = runs[-1][0]
    for a, b in reversed(runs[:-1]):
        if t[start] - t[b - 1] <= PUMP_GAP_S:
            start = a
        else:
            break
    return int(start)


def interp_cross(x: np.ndarray, y: np.ndarray, i: int, level: float) -> float:
    """x at which y crosses `level` between ticks i-1 and i."""
    if i <= 0 or i >= len(x):
        return float(x[min(max(i, 0), len(x) - 1)])
    y0, y1 = float(y[i - 1]), float(y[i])
    if y1 == y0:
        return float(x[i])
    f = min(1.0, max(0.0, (level - y0) / (y1 - y0)))
    return float(x[i - 1] + f * (x[i] - x[i - 1]))


def _window_ticks(lap: ParsedLap, clock: LapClock, lo_m: float, hi_m: float):
    """Tick indices of a lap with lo_m <= d < hi_m (track metres, no wrap)."""
    d = clock.tick_d_m
    return np.flatnonzero((d >= lo_m) & (d < hi_m))


def _onsets(session: ParsedSession, clocks: dict[int, LapClock], corners: list[CornerDef],
            length: float, laps: list[ParsedLap]) -> dict[int, dict[int, dict]]:
    """Brake and lift onsets per corner per lap, in track metres.

    The search window runs from the previous corner's apex to this apex. A
    window that crosses the line is searched on the lap that owns its apex,
    using the previous lap's tail."""
    rate = session.meta.tick_rate or 60
    by_lap = {lap.lap_number: lap for lap in session.laps}
    out: dict[int, dict[int, dict]] = {c.id: {} for c in corners}
    for ci, c in enumerate(corners):
        prev = corners[ci - 1] if len(corners) > 1 else None
        start_m = (prev.last_apex_m + 20.0) if prev else (c.apex_m - 0.5 * length)
        for lap in laps:
            pieces = _window(by_lap, clocks, lap.lap_number, start_m, c.first_apex_m, length)
            if pieces is None:
                continue
            d, t, brake, thr = pieces
            end = len(d)
            k = brake_onset_index(brake, t, end)
            row: dict = {}
            if k is not None:
                row["brake_m"] = wrap_m(interp_cross(d, brake, k, BRAKE_ON), length)
            # Lift: the last time the throttle came off full before the apex,
            # held off for LIFT_HOLD_S.
            off = thr < LIFT_THROTTLE
            hold = max(1, int(round(LIFT_HOLD_S * rate)))
            runs = [r for r in _runs(off) if r[1] - r[0] >= hold]
            if runs and runs[-1][0] > 0:
                row["lift_m"] = wrap_m(interp_cross(d, thr, int(runs[-1][0]), LIFT_THROTTLE), length)
            out[c.id][lap.lap_number] = row
    return out


def _window(by_lap: dict[int, ParsedLap], clocks: dict[int, LapClock], lap_no: int,
            lo_m: float, hi_m: float, length: float):
    """Ticks between lo_m and hi_m on the ring, ending on lap `lap_no`.

    Returns (d_unwrapped_m, t_s, brake_raw, throttle) or None. d runs
    continuously (a wrapped window's head carries d - length)."""
    lo = wrap_m(lo_m, length)
    hi = wrap_m(hi_m, length)
    lap = by_lap.get(lap_no)
    clock = clocks.get(lap_no)
    if lap is None or clock is None:
        return None
    if lo < hi:
        idx = _window_ticks(lap, clock, lo, hi)
        if idx.size < 3:
            return None
        return (clock.tick_d_m[idx], clock.tick_t_s[idx],
                np.asarray(lap.raw["brake_raw"], dtype=np.float64)[idx],
                np.asarray(lap.raw["throttle"], dtype=np.float64)[idx])
    prev = by_lap.get(lap_no - 1)
    pclock = clocks.get(lap_no - 1)
    tail_idx = _window_ticks(prev, pclock, lo, length) if prev is not None and pclock is not None else np.empty(0, int)
    head_idx = _window_ticks(lap, clock, 0.0, hi)
    if head_idx.size < 3:
        return None
    parts_d = [clock.tick_d_m[head_idx]]
    parts_t = [clock.tick_t_s[head_idx]]
    parts_b = [np.asarray(lap.raw["brake_raw"], dtype=np.float64)[head_idx]]
    parts_th = [np.asarray(lap.raw["throttle"], dtype=np.float64)[head_idx]]
    if tail_idx.size:
        offset_t = (pclock.lap_time_s or pclock.tick_t_s[-1])
        parts_d.insert(0, pclock.tick_d_m[tail_idx] - length)
        parts_t.insert(0, pclock.tick_t_s[tail_idx] - offset_t)
        parts_b.insert(0, np.asarray(prev.raw["brake_raw"], dtype=np.float64)[tail_idx])
        parts_th.insert(0, np.asarray(prev.raw["throttle"], dtype=np.float64)[tail_idx])
    return (np.concatenate(parts_d), np.concatenate(parts_t),
            np.concatenate(parts_b), np.concatenate(parts_th))


# ─────────────────────────────────────────────────────────────────────────────
# segments
# ─────────────────────────────────────────────────────────────────────────────

def _boundaries(corners: list[CornerDef], onsets: dict, median_v: np.ndarray,
                stations: np.ndarray, length: float, clean_laps: set[int]) -> None:
    """Set seg_start_m / seg_end_m on every corner, in place."""
    n = len(corners)
    for ci, c in enumerate(corners):
        prev = corners[ci - 1] if n > 1 else None
        rows = [r for lap, r in onsets[c.id].items() if lap in clean_laps] or list(onsets[c.id].values())
        brakes = [r["brake_m"] for r in rows if "brake_m" in r]
        lifts = [r["lift_m"] for r in rows if "lift_m" in r]
        # Positions are compared as distances BEFORE the apex, which is
        # continuous even when the window crosses the line.
        if len(brakes) >= max(1, len(rows) // 2):
            c.kind = "brake"
            before = np.array([fwd_dist(b, c.first_apex_m, length) for b in brakes])
            lead = float(np.percentile(before, 95)) + BOUNDARY_LEAD_M
        elif lifts:
            c.kind = "lift"
            before = np.array([fwd_dist(b, c.first_apex_m, length) for b in lifts])
            lead = float(np.percentile(before, 95)) + BOUNDARY_LEAD_M
        else:
            c.kind = "flat"
            if prev is not None:
                _, k = _ring_max_between(median_v, int(prev.apex_m / STATION_M),
                                         int(c.apex_m / STATION_M))
                lead = fwd_dist(float(stations[k]), c.apex_m, length)
            else:
                lead = 0.25 * length
        if prev is not None:
            gap = fwd_dist(prev.last_apex_m, c.first_apex_m, length)
            lead = min(lead, 0.5 * gap)
        lead = max(lead, 20.0)
        c.seg_start_m = wrap_m(c.first_apex_m - lead, length)
    for ci, c in enumerate(corners):
        nxt = corners[(ci + 1) % n]
        span = fwd_dist(c.seg_start_m, nxt.seg_start_m, length) if n > 1 else length
        c.seg_end_m = c.seg_start_m + span


def _merge_short(corners: list[CornerDef], length: float) -> list[CornerDef]:
    """Fold a segment shorter than MIN_SEGMENT_M into the corner before it."""
    changed = True
    while changed and len(corners) > 1:
        changed = False
        for ci, c in enumerate(corners):
            if c.seg_end_m - c.seg_start_m < MIN_SEGMENT_M:
                prev = corners[ci - 1]
                prev.complex = True
                prev.sub_apexes = (prev.sub_apexes or [{"apex_m": round(prev.apex_m, 1),
                                                        "dir": prev.dir, "deg": round(prev.turn_deg, 1)}])
                prev.sub_apexes.append({"apex_m": round(c.apex_m, 1), "dir": c.dir,
                                        "deg": round(c.turn_deg, 1)})
                if c.vmin_ms < prev.vmin_ms:
                    prev.vmin_ms = c.vmin_ms
                prev.seg_end_m = prev.seg_start_m + fwd_dist(prev.seg_start_m, c.seg_end_m, length)
                prev.turn_deg += c.turn_deg
                corners.pop(ci)
                changed = True
                break
    for k, c in enumerate(corners, start=1):
        c.id = k
    return corners


# ─────────────────────────────────────────────────────────────────────────────
# entry point
# ─────────────────────────────────────────────────────────────────────────────

def build_track_model(session: ParsedSession) -> TrackModel:
    clocks, length, source = session_clocks(session)
    stations = np.arange(STATION_M / 2, length, STATION_M)
    valid = [lap for lap in session.laps
             if lap.is_valid and lap.lap_number in clocks and clocks[lap.lap_number].complete]
    clean = [lap for lap in valid if is_clean(lap)]
    pool = clean if len(clean) >= 2 else valid
    empty = TrackModel(length, source, stations, clocks, [], np.empty(0), np.empty(0), [], [], {})
    if not pool:
        empty.insufficient = "no valid lap with both start/finish crossings to build the track from"
        return empty

    vs, kaps = [], []
    for lap in pool:
        c = clocks[lap.lap_number]
        vs.append(lap_on_stations(lap, c, stations, "speed"))
        d, h = _monotonic(c.tick_d_m, path_heading(lap))
        hs = np.interp(stations, d, h)
        kaps.append(np.gradient(hs, STATION_M))
    median_v = np.median(np.vstack(vs), axis=0)
    v_s = circ_smooth(median_v, int(round(SMOOTH_M / STATION_M)))
    kappa = circ_smooth(np.median(np.vstack(kaps), axis=0), int(round(CURV_SMOOTH_M / STATION_M)))

    corners = _find_corners(v_s, kappa, stations)
    if not corners:
        empty.median_v, empty.curvature = median_v, kappa
        empty.profile_laps = [lap.lap_number for lap in pool]
        empty.insufficient = "no corner found: the speed trace never dips and turns the car"
        return empty
    onsets = _onsets(session, clocks, corners, length, valid)
    _boundaries(corners, onsets, v_s, stations, length, {lap.lap_number for lap in clean})
    before = len(corners)
    corners = _merge_short(corners, length)
    if len(corners) != before:
        onsets = _onsets(session, clocks, corners, length, valid)
        _boundaries(corners, onsets, v_s, stations, length, {lap.lap_number for lap in clean})
    kinks = _find_kinks(kappa, stations, corners, length)
    return TrackModel(
        length_m=length, length_source=source, stations=stations, clocks=clocks,
        profile_laps=[lap.lap_number for lap in pool], median_v=median_v,
        curvature=kappa, corners=corners, kinks=kinks, onsets=onsets,
    )
