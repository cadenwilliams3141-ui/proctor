"""Phase 0 foundations: one reference-lap rule, exact lap timing, and the
measurement fixes that came with them."""

import json

import numpy as np

from proctor_parser import parse_ibt
from proctor_parser.analysis import grip, stint, track_width
from proctor_parser.analysis.common import clean_laps, directional_peak, reference_lap
from proctor_parser.laps import resample_to_grid
from proctor_parser.session import ParsedLap
from proctor_parser.timing import lap_clock, session_clocks, timing_check, unwrapped_pct
from tests.synthetic import build_ibt, make_core_channels

G = 9.81


def _session(**kw):
    return parse_ibt(build_ibt(make_core_channels(**kw)))[0]


# ── one reference lap ────────────────────────────────────────────────────────

def test_reference_lap_is_fastest_clean_then_fastest_valid():
    s = _session()
    ref = reference_lap(s)
    assert ref is not None
    clean = clean_laps(s)
    assert ref in clean
    assert ref.lap_time_s == min(l.lap_time_s for l in clean)
    # With every lap made anomalous, the rule falls back to fastest valid.
    for lap in s.laps:
        lap.is_anomalous = True
    ref2 = reference_lap(s)
    assert ref2 is not None and ref2.is_valid


def test_reference_lap_is_none_without_valid_laps():
    s = _session()
    for lap in s.laps:
        lap.is_valid = False
    assert reference_lap(s) is None


# ── per-lap peaks over in-state ticks ────────────────────────────────────────

def _brief_braking_session():
    """Braking for 1% of each lap at a known 20 m/s^2 (2.04 g)."""
    tpl = 4000
    ch = make_core_channels(n_laps=6, ticks_per_lap=tpl, slow_lap=None, incident_lap=None)
    in_lap = np.arange(len(ch["Speed"])) % tpl
    braking = (in_lap >= 100) & (in_lap < 140)
    moving = ch["Speed"] > 5
    ch["BrakeRaw"] = np.where(braking & moving, 0.8, 0.0)
    ch["Brake"] = np.where(moving, ch["BrakeRaw"], 1.0)
    ch["Throttle"] = np.where(braking, 0.0, 1.0)
    ch["LongAccel"] = np.where(braking, -20.0, 0.5)
    return parse_ibt(build_ibt(ch))[0]


def test_per_lap_braking_peak_is_not_diluted_by_the_rest_of_the_lap():
    s = _brief_braking_session()
    laps = [row for row in grip.compute(s)["laps"] if row["clean"]]
    assert laps
    for row in laps:
        # The old whole-lap percentile read ~0.0 g here: 99% of ticks are not braking.
        assert row["peak_braking_g"] is not None
        assert abs(row["peak_braking_g"] - 20.0 / G) < 0.05, row


def test_stint_braking_peak_is_not_diluted():
    s = _brief_braking_session()
    rows = [r for r in stint.compute(s)["laps"] if r.get("clean")]
    assert rows
    for r in rows:
        assert r["peak_braking_g"] is not None
        assert abs(r["peak_braking_g"] - 20.0 / G) < 0.05, r


def test_directional_peak_reports_none_rather_than_zero_when_too_few_ticks():
    v = np.zeros(1000)
    v[:5] = 1.5
    peak, n, why = directional_peak(v)
    assert peak is None and n == 5 and why


# ── unmeasured is null, not zero ─────────────────────────────────────────────

def test_track_width_writes_unmeasured_samples_as_null():
    out = track_width._nullable(np.array([1.234, np.nan, -0.5]))
    assert out == [1.23, None, -0.5]
    json.dumps(out)


# ── discrete channels on the grid ────────────────────────────────────────────

def test_gear_and_abs_are_resampled_by_nearest_tick_not_interpolated():
    d = np.linspace(0.0, 0.999, 997)
    gear = np.where(d < 0.5, 3.0, 4.0)
    abs_on = np.where((d > 0.2) & (d < 0.21), 1.0, 0.0)
    g = resample_to_grid(d, {"gear": gear, "abs_active": abs_on, "speed": d * 10})
    assert set(np.unique(g["gear"]).tolist()) <= {3.0, 4.0}
    assert set(np.unique(g["abs_active"]).tolist()) <= {0.0, 1.0}
    # Continuous channels still interpolate.
    assert len(np.unique(g["speed"])) > 900


# ── exact lap timing ─────────────────────────────────────────────────────────

def test_crossing_times_and_exact_lap_time_on_whole_tick_crossings():
    s = _session()
    for lap in s.laps:
        if not lap.is_valid:
            continue
        assert lap.start_crossing_s is not None and lap.end_crossing_s is not None
        # make_core_channels wraps exactly on the Lap change, so the exact
        # time equals the tick count here.
        assert abs(lap.lap_time_exact_s - lap.lap_time_s) < 1e-6


def test_session_time_is_the_clock_when_present_and_a_dropped_tick_counts():
    tpl = 720
    ch = make_core_channels(ticks_per_lap=tpl)
    n = len(ch["Speed"])
    t = np.arange(n) / 60.0
    # Drop one tick's worth of time in the middle of lap 2: the sim stalled.
    lap2_mid = 2 * tpl + tpl // 2
    t[lap2_mid:] += 1.0 / 60.0
    ch["SessionTime"] = 1000.0 + t
    s = parse_ibt(build_ibt(ch))[0]
    lap2 = next(l for l in s.laps if l.lap_number == 2)
    lap1 = next(l for l in s.laps if l.lap_number == 1)
    assert abs(lap1.lap_time_exact_s - lap1.lap_time_s) < 1e-3
    assert abs(lap2.lap_time_exact_s - (lap2.lap_time_s + 1.0 / 60.0)) < 1e-3
    # lap_time_s keeps its tick-count definition (protects the golden pace value).
    assert lap2.lap_time_s == tpl / 60.0


def test_mid_tick_crossing_is_interpolated():
    """The line falls 30% of the way between two ticks."""
    tpl = 600
    ch = make_core_channels(ticks_per_lap=tpl)
    n = len(ch["Speed"])
    # Shift distance so every wrap lands between ticks.
    step = 1.0 / tpl
    in_lap = np.arange(n) % tpl
    ch["LapDistPct"] = (in_lap * step + 0.7 * step) % 1.0
    s = parse_ibt(build_ibt(ch))[0]
    lap = next(l for l in s.laps if l.is_valid)
    # The wrap from (tpl-1+0.7)/tpl ... is inside lap k's first tick interval.
    assert lap.start_crossing_s is not None
    assert abs(lap.lap_time_exact_s - tpl / 60.0) < 1e-4


def test_lap_clock_segments_sum_to_the_lap_time():
    s = _session()
    clocks, length, source = session_clocks(s)
    assert source == "track length from session info"
    for lap in s.laps:
        if not lap.is_valid:
            continue
        c = clocks[lap.lap_number]
        assert c.complete
        cuts = np.linspace(0, length, 9)
        parts = [c.segment_time(a, b) for a, b in zip(cuts[:-1], cuts[1:])]
        assert all(p is not None and p > 0 for p in parts)
        assert abs(sum(parts) - lap.lap_time_exact_s) < 1e-9


def test_unwrap_moves_only_ticks_on_the_wrong_side_of_a_real_wrap():
    def lap_with(dist):
        n = len(dist)
        return ParsedLap(1, None, True, False, 0, False,
                         raw={"dist": np.asarray(dist, dtype=np.float64)}, grid={})

    head = lap_with([0.998, 0.999, 0.001, 0.2, 0.6, 0.9])
    u = unwrapped_pct(head)
    assert u[0] < 0 and u[1] < 0 and u[2] == 0.001
    assert np.all(np.diff(u) >= 0)

    # A partial lap that simply ends at 0.3 must NOT be pushed past 1.
    partial = lap_with([0.0, 0.1, 0.2, 0.3])
    assert np.allclose(unwrapped_pct(partial), [0.0, 0.1, 0.2, 0.3])

    # An out lap that starts at 0.7 is left alone.
    out = lap_with([0.7, 0.8, 0.9, 0.99])
    assert np.allclose(unwrapped_pct(out), [0.7, 0.8, 0.9, 0.99])


def test_timing_check_is_json_and_says_when_the_sim_check_is_unavailable():
    out = timing_check(_session())
    json.dumps(out)
    assert out["available"] is True
    assert "sim_check" in out


def test_lap_clock_first_arrival_wins_while_stationary():
    s = _session()
    out_lap = s.laps[0]  # starts stationary on pit road
    c = lap_clock(out_lap, 4000.0, 60)
    assert np.all(np.diff(c.d_m) > 0)
