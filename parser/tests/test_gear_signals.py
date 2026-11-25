"""Tests for the "you or your gear?" signals: the brake pedal's top end, the
throttle's range, and FFB clipping per corner.

The question each answers is whether a number is the driver's foot or the rig.
The golden Long Beach session has a brake ceiling of 89.8% -- a known-good
NUMBER, not a known verdict: a driver who never pressed harder than 89.8% and a
pedal that cannot report more than 89.8% both read 89.8. The shape of the stops
is what tells them apart, so both shapes are planted here.
"""

import numpy as np

from proctor_parser import parse_ibt
from proctor_parser.analysis import hardware, input_response
from tests.synthetic import build_ibt, make_core_channels

RATE = 60


def _stops(peaks, hold_ticks=30, gap=120, flat=False, jitter=0.004, seed=1):
    """A pedal trace with one stop per peak: ramp up, hold, ramp down."""
    rng = np.random.default_rng(seed)
    parts = []
    for pk in peaks:
        up = np.linspace(0.05, pk, 12)
        hold = np.full(hold_ticks, pk)
        if not flat:
            # A foot holding steady still moves by a few tenths of a point.
            hold = np.clip(pk - np.abs(rng.normal(0, jitter, hold_ticks)), 0, pk)
            hold[hold_ticks // 2] = pk
        down = np.linspace(pk, 0.05, 15)
        parts += [np.zeros(gap), up, hold, down]
    return np.concatenate(parts + [np.zeros(gap)])


def test_a_pedal_calibrated_short_flattens_every_stop_at_the_same_value():
    pedal = _stops([0.82] * 8, flat=True)
    shape = input_response._ceiling_shape(pedal, 0.82, None, RATE)
    assert shape["hard_stops"] == 8
    assert shape["flat_at_ceiling"] == 8
    assert shape["peak_spread_pct"] == 0.0
    assert shape["at_ceiling"] == 8
    assert shape["gear_rule"]["at_ceiling_share"] == 0.5


def test_a_foot_that_tops_out_at_898_is_not_a_calibration_limit():
    peaks = [0.72, 0.81, 0.898, 0.77, 0.85, 0.79, 0.88, 0.74]
    pedal = _stops(peaks)
    shape = input_response._ceiling_shape(pedal, 0.898, None, RATE)
    assert shape["hard_stops"] == 8
    assert shape["at_ceiling"] == 1
    assert shape["flat_at_ceiling"] == 0
    assert shape["peak_spread_pct"] > 5.0


def test_abs_on_the_plateau_is_counted_separately():
    pedal = _stops([0.95] * 6, flat=True)
    abs_active = (pedal >= 0.95).astype(float)
    shape = input_response._ceiling_shape(pedal, 0.95, abs_active, RATE)
    assert shape["flat_at_ceiling"] == 6
    assert shape["flat_with_abs"] == 6


def test_light_brushes_are_not_hard_stops():
    pedal = _stops([0.2, 0.3, 0.25])
    assert input_response._ceiling_shape(pedal, 0.3, None, RATE)["hard_stops"] == 0


def _throttle(floor=0.0, top=1.0, n_holds=6, lfb=False):
    parts = []
    for _ in range(n_holds):
        parts += [np.full(90, floor), np.linspace(floor, top, 20), np.full(120, top)]
    t = np.concatenate(parts)
    if lfb:
        # Left-foot braking: throttle held partly open into the stops.
        t[::7] = np.maximum(t[::7], 0.3)
    return t


def test_throttle_that_never_returns_to_zero_reads_a_floor():
    t = _throttle(floor=0.03)
    r = input_response._throttle_range(t, np.ones(t.size, bool), RATE)
    assert r["floor_pct"] >= 3.0 - 1e-6
    assert r["rule"]["floor_watch_pct"] == 1.0


def test_throttle_that_cannot_reach_full_flattens_below_it():
    t = _throttle(top=0.96)
    r = input_response._throttle_range(t, np.ones(t.size, bool), RATE)
    assert r["ceiling_pct"] == 96.0
    assert r["flat_out_holds"] == 6
    assert r["holds_flat_at_ceiling"] == 6


def test_left_foot_braking_does_not_lift_the_floor():
    t = _throttle(lfb=True)
    r = input_response._throttle_range(t, np.ones(t.size, bool), RATE)
    assert r["floor_pct"] == 0.0
    assert r["ceiling_pct"] == 100.0


def test_a_healthy_pedal_tops_out_at_100():
    t = _throttle()
    r = input_response._throttle_range(t, np.ones(t.size, bool), RATE)
    assert r["ceiling_pct"] == 100.0 and r["floor_pct"] == 0.0


def test_the_payloads_carry_the_new_blocks():
    ch = make_core_channels()
    s = parse_ibt(build_ibt(ch))[0]
    ir = input_response.compute(s)
    assert "ceiling_shape" in ir["brake"]
    assert ir["throttle"]["range"]["measured"] is True
    hw = hardware.compute(s)
    # Constant speed: no corners, so the list is present and empty, not missing.
    assert hw["ffb"]["by_corner"] == []
