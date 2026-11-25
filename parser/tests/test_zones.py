"""Tests for the shared zone rules (analysis/zones.py) and the line-offset helper."""

import numpy as np
import pytest

from proctor_parser.analysis import line_offset, zones
from proctor_parser.session import ParsedLap


def _lap(dist: np.ndarray) -> ParsedLap:
    return ParsedLap(
        lap_number=1, lap_time_s=len(dist) / 60, is_valid=True, is_out_lap=False,
        incident_delta=0, is_anomalous=False, raw={"dist": dist}, grid={},
    )


def test_crossing_clock_partitions_the_recorded_lap_time_exactly():
    rng = np.random.default_rng(3)
    steps = rng.uniform(0.5, 1.5, 3000)
    dist = np.cumsum(steps) / steps.sum() * 0.9995
    dist[0] = 0.9998  # the first tick still reads the previous lap
    clock = zones.crossing_clock(_lap(dist), 60)
    bounds = np.array([0.0, 0.1, 0.1, 0.37, 0.5, 0.92, 1.0])
    t = clock(bounds)
    assert np.all(np.diff(t) >= 0)
    assert float(np.sum(np.diff(t))) == pytest.approx(3000 / 60, abs=1e-9)


def test_crossing_clock_interpolates_between_ticks():
    dist = np.linspace(0, 1, 601)[:-1]  # 600 ticks, 10 s
    clock = zones.crossing_clock(_lap(dist), 60)
    assert float(clock(0.5)) == pytest.approx(5.0, abs=1e-6)
    assert float(clock(0.25)) == pytest.approx(2.5, abs=1e-6)


def test_brake_application_picks_the_main_stop_and_walks_back_over_it():
    rate = 60
    b = np.zeros(600)
    b[50:55] = 0.12           # a brush of the pedal on the straight
    b[200:260] = 0.8          # the stop
    b[262:270] = 0.3          # a wobble in the release, within the merge gap
    b[400:405] = 0.2          # a mid-corner tap
    onset, end = zones.brake_application(b, 0, 599, rate)
    assert onset == 200
    assert end == 269


def test_turn_in_is_thirty_percent_of_the_laps_own_peak():
    lat = np.concatenate([np.zeros(100), np.linspace(0, 2.0, 100), np.full(50, 2.0)])
    i = zones.turn_in_index(lat, 0, len(lat) - 1)
    assert lat[i] >= 0.6 and lat[i - 1] < 0.6
    assert zones.turn_in_index(np.full(50, 0.1), 0, 49) is None


def test_full_throttle_needs_the_hold():
    rate = 60
    t = np.zeros(300)
    t[50:60] = 1.0             # a stab, not held
    t[100:] = 1.0
    assert zones.full_throttle_index(t, 0, 299, rate) == 100
    assert zones.pickup_index(np.r_[np.zeros(80), np.linspace(0.05, 1, 20), np.ones(200)], 0, 100) == 80


def test_throttle_lifts_count_a_dip_that_recovers():
    t = np.array([0.2, 0.5, 0.8, 0.6, 0.9, 1.0, 0.95, 1.0])
    assert zones.throttle_lifts(t, 0.10) == 1


def test_spearman_p_matches_the_t_approximation():
    rho, p = zones.spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 3, 2, 4, 6, 5, 7, 9, 8, 10])
    assert rho == pytest.approx(1 - 6 * 6 / (10 * 99), abs=1e-9)  # three adjacent swaps: Σd² = 6
    assert p < 0.001
    assert zones.spearman([1, 1, 1, 1], [1, 2, 3, 4]) is None
    assert zones._p_two_sided(0.5, 5) == pytest.approx(0.391, abs=1e-3)


def test_line_offset_is_positive_to_the_left_of_travel():
    # Reference heading north along a meridian; a lap 5 m to the west is LEFT.
    lat = np.linspace(33.80, 33.81, 1000)
    lon = np.full(1000, -84.27)
    f = line_offset.frame(lat, lon)
    west = lon - 5.0 / (line_offset.M_PER_DEG * np.cos(np.radians(33.805)))
    off = line_offset.offsets(f, lat, west)
    assert np.nanmedian(off) == pytest.approx(5.0, abs=0.05)
    assert line_offset.offsets(f, lat[:10], lon[:10]) is None
