"""Tests for corner_context (module 12): per-corner channel context.

The default synthetic profile is constant-speed, so corner detection finds no
corners and the payload must still be well-formed and JSON-serializable. Where a
corner is needed the reference lap's grid speed is given a dip in place, exactly
as the grid-module tests do.
"""

import json

import numpy as np

from proctor_parser import parse_ibt
from proctor_parser.analysis import corner_context
from tests.synthetic import build_ibt, make_core_channels

GRID_N = 1000


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


def _dip_profile(depth_min=20.0, base=50.0, center=0.5, half=0.08):
    pct = (np.arange(GRID_N) + 0.5) / GRID_N
    speed = np.full(GRID_N, base)
    region = np.abs(pct - center) < half
    x = (pct[region] - center) / half
    speed[region] = base - (base - depth_min) * 0.5 * (1.0 + np.cos(np.pi * x))
    return speed.astype(np.float32)


def test_corner_context_constant_speed_has_no_corners():
    payload = corner_context.compute(_session())
    assert payload["corners"] == []
    assert "finding" in payload
    assert json.loads(json.dumps(payload))


def test_corner_context_reports_channels_and_lf_temp_per_corner():
    session = _session(slow_lap=3, incident_lap=5)
    ref = min(
        (l for l in session.laps if l.is_valid and not l.is_anomalous),
        key=lambda l: l.lap_time_s,
    )
    ref.grid["speed"] = _dip_profile(depth_min=20.0)

    payload = corner_context.compute(session)
    assert len(payload["corners"]) >= 1
    c = payload["corners"][0]
    for key in (
        "min_speed_ms", "entry_speed_ms", "exit_speed_ms",
        "peak_abs_steer_rad", "peak_lat_g", "peak_brake_g", "peak_accel_g",
    ):
        assert isinstance(c[key], (int, float))
    # LF temps are carried on the synthetic (constant 80/85/90).
    temp = c["lf_tire_temp"]
    assert temp["available"] is True
    assert (temp["left_c"], temp["middle_c"], temp["right_c"]) == (80.0, 85.0, 90.0)
    assert temp["spread_c"] == 10.0
    assert json.loads(json.dumps(payload))


def test_corner_context_insufficient_without_valid_laps():
    session = _session()
    for lap in session.laps:
        lap.is_valid = False
    payload = corner_context.compute(session)
    assert payload["insufficient_data"] is True
    assert "reason" in payload
    assert json.loads(json.dumps(payload))
