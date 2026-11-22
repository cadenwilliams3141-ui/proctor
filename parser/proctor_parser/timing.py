"""Exact elapsed time against distance, per lap — the clock every corner time uses.

WHY NOT INTEGRATE 1/SPEED. The old corner deltas integrated ds/v over the
resampled distance grid. LapDistPct measures distance along the track's own
centreline, while Speed is the car's speed along the path it actually drove,
which is longer on a wide line and shorter on a tight one. The integral is
therefore wrong by an amount that depends on the line, and rescaling the lap
to its recorded time only spreads that error across every corner.

The time base was never lost: every tick has a time. So the time at which the
car reached a given distance is read off directly, by interpolating tick time
against tick distance. Between two ticks 16.7 ms apart the car moves about a
metre at racing speed, and linear interpolation over a metre is accurate to
well under a millisecond — segment times resolve far finer than the tick.

The lap's ends are pinned to the start/finish crossings the parser
interpolated (ParsedLap.start_crossing_s / end_crossing_s), so the segments of
a lap sum to its crossing-to-crossing time exactly.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

DEFAULT_TRACK_LENGTH_M = 4000.0

# Ticks at either end of a lap that may still carry the previous/next lap's
# LapDistPct when the Lap counter and the wrap disagree by a tick or two.
_EDGE_TICKS = 15


@dataclass(frozen=True)
class LapClock:
    """Monotonic (distance, time) pairs for one lap.

    d_m:  metres from the start/finish line, strictly increasing.
    t_s:  seconds since the lap's start crossing (or its first tick, when the
          lap has no start crossing), same length as d_m.
    tick_d_m / tick_t_s: the same for EVERY tick of the lap (not deduplicated),
          index-aligned with lap.raw, for per-tick consumers.
    complete: True when both crossings are known, so d_m spans the whole lap.
    """

    d_m: np.ndarray
    t_s: np.ndarray
    tick_d_m: np.ndarray
    tick_t_s: np.ndarray
    length_m: float
    complete: bool

    @property
    def lap_time_s(self) -> float | None:
        return float(self.t_s[-1]) if self.complete else None

    def time_at(self, d_m: float | np.ndarray) -> np.ndarray | float:
        """Seconds since the start crossing at which the car reached `d_m`.

        Outside the lap's driven span the ends are held, so callers that care
        must check `covers` first."""
        return np.interp(d_m, self.d_m, self.t_s)

    def covers(self, d0: float, d1: float) -> bool:
        return bool(self.d_m[0] <= d0 + 1e-9 and self.d_m[-1] >= d1 - 1e-9)

    def segment_time(self, d0: float, d1: float) -> float | None:
        """Seconds spent between d0 and d1 (d0 < d1, both inside this lap)."""
        if d1 <= d0 or not self.covers(d0, d1):
            return None
        return float(self.time_at(d1) - self.time_at(d0))


def tick_seconds(lap: ParsedLap, tick_rate: int) -> np.ndarray:
    """Seconds at each tick relative to the lap's first tick."""
    n = len(lap.raw["dist"])
    st = lap.raw.get("session_time")
    if st is not None and len(st) == n and n > 1:
        st = np.asarray(st, dtype=np.float64)
        steps = np.diff(st)
        if np.all(np.isfinite(st)) and np.all(steps > 0):
            return st - st[0]
    return np.arange(n, dtype=np.float64) / float(tick_rate or 60)


def track_length_m(session: ParsedSession) -> tuple[float, str]:
    """The track's length in metres, and where it came from.

    LapDist / LapDistPct is the sim's own length to the metre, and is the
    same on every tick, so its median over mid-lap ticks is used when the
    channel is present. Otherwise the YAML length (rounded to 10 m) — an
    error that is identical on every lap and so cancels in any comparison
    between laps. Otherwise a stated default.
    """
    ratios = []
    for lap in session.laps:
        dm = lap.raw.get("dist_m")
        if dm is None:
            continue
        pct = np.asarray(lap.raw["dist"], dtype=np.float64)
        dm = np.asarray(dm, dtype=np.float64)
        mid = (pct > 0.2) & (pct < 0.8) & np.isfinite(dm)
        if mid.any():
            ratios.append(dm[mid] / pct[mid])
    if ratios:
        r = float(np.median(np.concatenate(ratios)))
        if np.isfinite(r) and r > 100.0:
            return r, "LapDist"
    km = session.meta.track_length_km
    if km is not None and km > 0:
        return float(km) * 1000.0, "track length from session info"
    return DEFAULT_TRACK_LENGTH_M, "assumed (no track length in file)"


def unwrapped_pct(lap: ParsedLap) -> np.ndarray:
    """LapDistPct for every tick, with the edges unwrapped and forced
    non-decreasing.

    A lap whose first ticks still read ~0.99 (the Lap counter changed a tick
    before the distance wrapped) would otherwise pin a running maximum at
    0.99 for the whole lap. Those head ticks are moved to just below zero, and
    tail ticks that already read ~0.01 to just above one.
    """
    d = np.asarray(lap.raw["dist"], dtype=np.float64).copy()
    n = len(d)
    if n < 2:
        return d
    # Only an actual wrap (a fall of more than half a lap between two ticks)
    # moves anything, so an out lap that starts at 0.7 or a partial lap that
    # ends at 0.3 is left exactly as recorded.
    wraps = np.flatnonzero(np.diff(d) < -0.5) + 1  # first tick after each wrap
    # A wrap is a head wrap or a tail wrap, never both: on a lap short enough
    # for the two edge windows to overlap, the lap's midpoint decides.
    mid = n // 2
    head_wraps = wraps[(wraps <= _EDGE_TICKS) & (wraps < mid)]
    if head_wraps.size:
        d[: int(head_wraps[-1])] -= 1.0
    tail_wraps = wraps[(wraps >= n - _EDGE_TICKS) & (wraps >= mid)]
    if tail_wraps.size:
        d[int(tail_wraps[0]):] += 1.0
    return np.maximum.accumulate(d)


def lap_clock(lap: ParsedLap, length_m: float, tick_rate: int) -> LapClock:
    """Build the distance→time clock for one lap."""
    pct = unwrapped_pct(lap)
    t = tick_seconds(lap, tick_rate)
    t0 = lap.start_crossing_s if lap.start_crossing_s is not None else 0.0
    t = t - t0

    tick_d = pct * length_m
    tick_t = t.copy()

    d = tick_d
    tt = t
    complete = lap.start_crossing_s is not None and lap.end_crossing_s is not None
    if lap.start_crossing_s is not None:
        keep = d > 0.0
        d = np.concatenate(([0.0], d[keep]))
        tt = np.concatenate(([0.0], tt[keep]))
    if lap.end_crossing_s is not None:
        keep = d < length_m
        d = np.concatenate((d[keep], [length_m]))
        tt = np.concatenate((tt[keep], [lap.end_crossing_s - t0]))

    # Strictly increasing distance for interpolation. Where the car did not
    # move between ticks, the FIRST tick at that distance is kept: the time a
    # distance was reached is the time of arrival.
    if len(d) > 1:
        keep = np.concatenate(([True], np.diff(d) > 0))
        d, tt = d[keep], tt[keep]
    return LapClock(
        d_m=d, t_s=tt, tick_d_m=tick_d, tick_t_s=tick_t,
        length_m=float(length_m), complete=bool(complete),
    )


def session_clocks(session: ParsedSession) -> tuple[dict[int, LapClock], float, str]:
    """Clocks for every lap, keyed by lap_number, plus the track length used."""
    length, source = track_length_m(session)
    rate = session.meta.tick_rate or 60
    clocks = {
        lap.lap_number: lap_clock(lap, length, rate)
        for lap in session.laps
        if len(lap.raw.get("dist", ())) > 1
    }
    return clocks, length, source


def timing_check(session: ParsedSession) -> dict:
    """How the parser's exact lap times compare with the tick count and,
    when the sim published one, the sim's own lap time."""
    rows = []
    for lap in session.laps:
        exact = lap.lap_time_exact_s
        if exact is None or lap.lap_time_s is None:
            continue
        row = {"lap": int(lap.lap_number),
               "exact_vs_tick_ms": round((exact - lap.lap_time_s) * 1000.0, 2)}
        if lap.sim_lap_time_s is not None:
            row["exact_vs_sim_ms"] = round((exact - lap.sim_lap_time_s) * 1000.0, 2)
        rows.append(row)
    if not rows:
        return {"available": False,
                "reason": "no lap had both start/finish crossings to time between"}
    vs_tick = [abs(r["exact_vs_tick_ms"]) for r in rows]
    out = {
        "available": True,
        "laps_checked": len(rows),
        "max_abs_exact_vs_tick_ms": round(max(vs_tick), 2),
    }
    vs_sim = [abs(r["exact_vs_sim_ms"]) for r in rows if "exact_vs_sim_ms" in r]
    if vs_sim:
        out["sim_laps_checked"] = len(vs_sim)
        out["max_abs_exact_vs_sim_ms"] = round(max(vs_sim), 2)
        out["sim_agrees"] = max(vs_sim) <= 5.0
    else:
        out["sim_check"] = "LapLastLapTime not in this file; no sim cross-check"
    return out
