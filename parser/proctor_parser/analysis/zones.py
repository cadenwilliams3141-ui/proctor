"""Shared rules for carving a lap into the parts of driving (helper, no METRIC_KEY).

Several modules ask the same questions of a lap -- where did the braking for this
corner start, where did the car turn in, when did the lap cross this point of the
track -- and every time two modules answered one of those questions separately,
the answers drifted. So the rules live here once, the way `corners.py` holds
corner detection once, and the modules that need them import them.

Every threshold here is a fraction of the pedal travel or of the lap's OWN peak
lateral g. None of it is a per-car number.

  brake on      BrakeRaw at or above BRAKE_ON   (the pedal, never the applied
                channel -- the sim forces Brake=1.0 at a standstill)
  brake off     BrakeRaw below BRAKE_OFF
  turn-in       the first tick where |lateral g| reaches TURN_IN_FRACTION of
                that lap's own peak through the corner
  full throttle Throttle at or above FULL_THROTTLE, held FULL_HOLD_S

`crossing_clock` is what makes zone times close exactly: it returns, for any
fraction of the lap, the time the lap crossed it, interpolated between ticks.
Zone times are differences of crossing times, so they telescope -- the sum of a
lap's zones IS its recorded lap time (n_ticks / tick_rate), to rounding.
"""

from __future__ import annotations

import math
from typing import Callable

import numpy as np

from proctor_parser.session import ParsedLap

G = 9.81

BRAKE_ON = 0.10
BRAKE_OFF = 0.05
TURN_IN_FRACTION = 0.30
MIN_PEAK_LAT_G = 0.15
FULL_THROTTLE = 0.90
FULL_HOLD_S = 0.5
PICKUP_THROTTLE = 0.05

# Two brake applications closer together than this are one stop with a wobble
# in it, not two stops: a re-stab during the release is part of the braking.
_MERGE_GAP_S = 0.25

# A steering-velocity reversal only counts when the wheel actually moved this
# much between ticks; below it the "reversal" is sensor jitter, not input.
REVERSAL_MIN_RAD_PER_TICK = 0.005


# ─────────────────────────────────────────────────────────────────────────────
# When a lap crossed a point of the track
# ─────────────────────────────────────────────────────────────────────────────

def lap_distance(lap: ParsedLap, tick_rate: int) -> np.ndarray:
    """LapDistPct for `lap`, cleaned so it only ever moves forward.

    LapDistPct can still read ~1.0 for the first tick or two after the line;
    those are the previous lap and are read as 0. A running maximum removes the
    odd backwards step.
    """
    d = lap.raw["dist"].astype(np.float64).copy()
    head = min(d.size, max(1, int(tick_rate)))
    first = d[:head]
    first[first > 0.5] = 0.0
    return np.maximum.accumulate(d)


def crossing_clock(lap: ParsedLap, tick_rate: int) -> Callable[[np.ndarray | float], np.ndarray]:
    """Seconds into `lap` at which it crossed each lap fraction p (0..1).

    p <= 0 is the start of the lap (0 s) and p >= 1 its end (n_ticks / rate,
    which is exactly how `lap_time_s` is defined), so a set of boundaries that
    starts at 0 and ends at 1 partitions the recorded lap time with nothing
    lost to resampling.
    """
    d = lap_distance(lap, tick_rate)
    n = d.size
    # Strictly increasing for interpolation; the nudge is far below one tick.
    d = d + np.arange(n) * 1e-12
    t = np.arange(n, dtype=np.float64) / tick_rate
    end = n / tick_rate

    def at(p):
        p = np.asarray(p, dtype=np.float64)
        out = np.interp(p, d, t)
        out = np.where(p <= 0.0, 0.0, out)
        return np.where(p >= 1.0, end, out)

    return at


def index_at(dist: np.ndarray, p: float) -> int:
    """First tick at or past lap fraction p, on a distance from `lap_distance`."""
    i = int(np.searchsorted(dist, p))
    return min(max(i, 0), dist.size - 1)


# ─────────────────────────────────────────────────────────────────────────────
# The braking for a corner, and the turn-in
# ─────────────────────────────────────────────────────────────────────────────

def brake_application(brake: np.ndarray, lo: int, hi: int, tick_rate: int) -> tuple[int, int] | None:
    """The main brake application between ticks lo..hi, as (onset, end).

    Every run of pedal above BRAKE_OFF that reaches BRAKE_ON is a candidate;
    runs separated by less than _MERGE_GAP_S are one application. The main one
    is the one that did the most braking (largest pedal integral), so a brush of
    the pedal on the straight or a mid-corner tap does not pass for the stop.
    The onset is where that application first left BRAKE_OFF -- found by walking
    back over the whole application, not by the first tick inside a window,
    which would cut short a stop already under way when the window opened.
    """
    if hi <= lo:
        return None
    seg = brake[lo : hi + 1]
    on = seg >= BRAKE_OFF
    if not on.any():
        return None
    idx = np.flatnonzero(on)
    splits = np.flatnonzero(np.diff(idx) > 1) + 1
    runs = [(int(r[0]), int(r[-1])) for r in np.split(idx, splits)]
    gap = max(1, int(round(_MERGE_GAP_S * tick_rate)))
    merged: list[list[int]] = []
    for s, e in runs:
        if merged and s - merged[-1][1] <= gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    best = None
    best_mass = 0.0
    for s, e in merged:
        part = seg[s : e + 1]
        if float(part.max()) < BRAKE_ON:
            continue
        mass = float(part.sum())
        if mass > best_mass:
            best, best_mass = (s, e), mass
    if best is None:
        return None
    s, e = best
    # Walk back past lo when the application was already on as the window
    # opened: the caller decides whether that is allowed (see `floor`).
    return lo + s, lo + e


def turn_in_index(abs_lat_g: np.ndarray, lo: int, hi: int) -> int | None:
    """First tick in lo..hi where |lateral g| reaches TURN_IN_FRACTION of its peak there."""
    if hi <= lo:
        return None
    seg = abs_lat_g[lo : hi + 1]
    peak = float(seg.max())
    if peak < MIN_PEAK_LAT_G:
        return None
    return lo + int(np.flatnonzero(seg >= TURN_IN_FRACTION * peak)[0])


def quietest_index(abs_lat_g: np.ndarray, lo: int, hi: int) -> int:
    """Where the car was straightest between lo and hi -- the start of an unbraked corner."""
    if hi <= lo:
        return lo
    return lo + int(np.argmin(abs_lat_g[lo : hi + 1]))


def full_throttle_index(throttle: np.ndarray, lo: int, hi: int, tick_rate: int) -> int | None:
    """First tick in lo..hi where the throttle is at FULL_THROTTLE and stays there FULL_HOLD_S."""
    hold = max(1, int(round(FULL_HOLD_S * tick_rate)))
    if hi - lo + 1 < hold:
        return None
    full = (throttle[lo : hi + 1] >= FULL_THROTTLE).astype(np.int64)
    run = np.convolve(full, np.ones(hold, dtype=np.int64), mode="valid")
    hits = np.flatnonzero(run == hold)
    return lo + int(hits[0]) if hits.size else None


def pickup_index(throttle: np.ndarray, lo: int, full_i: int) -> int:
    """Start of the throttle application that reached full at `full_i`, walking back."""
    i = full_i
    while i > lo and throttle[i - 1] >= PICKUP_THROTTLE:
        i -= 1
    return i


def throttle_lifts(throttle: np.ndarray, lift: float) -> int:
    """Times the throttle fell `lift` or more below its running high and came back up."""
    count = 0
    high = float(throttle[0]) if throttle.size else 0.0
    dipped = False
    for v in throttle[1:]:
        v = float(v)
        if v >= high:
            if dipped:
                count += 1
                dipped = False
            high = v
        elif high - v >= lift:
            dipped = True
    return count


def steering_reversals(steer: np.ndarray) -> int:
    """Meaningful steering-velocity sign changes in a stretch of steering trace."""
    if steer.size < 3:
        return 0
    # No cast: the arithmetic stays in the channel's own dtype, as it always was.
    vel = np.diff(steer)
    sign = np.sign(vel)
    flips = (sign[:-1] * sign[1:] < 0) & (np.abs(vel[1:]) > REVERSAL_MIN_RAD_PER_TICK)
    return int(np.count_nonzero(flips))


# ─────────────────────────────────────────────────────────────────────────────
# A link between two things across laps, with how likely chance is to explain it
# ─────────────────────────────────────────────────────────────────────────────

def ranks(x: np.ndarray) -> np.ndarray:
    """Average ranks, so tied values do not invent an order."""
    order = np.argsort(x, kind="mergesort")
    r = np.empty(len(x), dtype=np.float64)
    r[order] = np.arange(len(x), dtype=np.float64)
    for v in np.unique(x):
        tie = x == v
        r[tie] = r[tie].mean()
    return r


def spearman(x, y) -> tuple[float, float] | None:
    """Spearman's rho and its two-sided p (t approximation), or None if either never varied.

    The p matters: rho = 0.5 over five laps happens by chance about one time in
    five, and a session has a dozen corners and a dozen things to correlate in
    each -- without it, chance alone would hand the driver a confident tip.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = x.size
    if n < 3:
        return None
    rx, ry = ranks(x), ranks(y)
    if rx.std() == 0 or ry.std() == 0:
        return None
    rho = float(np.corrcoef(rx, ry)[0, 1])
    return rho, _p_two_sided(rho, n)


def _p_two_sided(rho: float, n: int) -> float:
    df = n - 2
    if df <= 0:
        return 1.0
    if abs(rho) >= 1.0:
        return 0.0
    t2 = rho * rho * df / (1.0 - rho * rho)
    # P(|T| > t) for Student's t = I_{df/(df+t^2)}(df/2, 1/2).
    return float(min(1.0, max(0.0, _betai(df / 2.0, 0.5, df / (df + t2)))))


def _betai(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b) (continued fraction)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    ln_front = (
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        + a * math.log(x) + b * math.log(1.0 - x)
    )
    front = math.exp(ln_front)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def _betacf(a: float, b: float, x: float) -> float:
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 200):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-12:
            break
    return h
