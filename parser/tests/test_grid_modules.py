"""Tests for the grid-based analysis modules: corners, delta_time,
input_overlay, corner_sections.

Inputs are built from the synthetic .ibt helper. The default synthetic profile
is constant-speed, so corner detection legitimately finds zero corners there —
every payload must stay well-formed and JSON-serializable in that case too.
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import corner_sections, delta_time, input_overlay
from proctor_parser.analysis.corners import detect_corners
from tests.synthetic import build_ibt, make_core_channels

GRID_N = 1000


def _synthetic_session():
    sessions = parse_ibt(build_ibt(make_core_channels(slow_lap=3, incident_lap=5)))
    assert len(sessions) == 1
    return sessions[0]


def _dip_profile(depth_min=20.0, base=50.0, center=0.5, half=0.08):
    """Constant `base` m/s with one smooth cosine dip down to `depth_min`."""
    pct = (np.arange(GRID_N) + 0.5) / GRID_N
    speed = np.full(GRID_N, base)
    region = np.abs(pct - center) < half
    x = (pct[region] - center) / half            # -1..1 across the dip
    bump = 0.5 * (1.0 + np.cos(np.pi * x))        # 1 at centre, 0 at edges
    speed[region] = base - (base - depth_min) * bump
    return speed.astype(np.float32), pct.astype(np.float32)


# --------------------------------------------------------------------------- #
# corner detection
# --------------------------------------------------------------------------- #

def test_detect_corners_finds_clear_dip():
    speed, pct = _dip_profile(depth_min=20.0)
    corners = detect_corners(speed, pct)
    assert len(corners) >= 1
    corner = corners[0]
    assert corner["start_pct"] < corner["apex_pct"] < corner["end_pct"]
    assert corner["min_speed_ms"] == pytest.approx(20.0, abs=2.0)
    assert corner["apex_pct"] == pytest.approx(0.5, abs=0.05)
    assert corner["id"] == 1


def test_detect_corners_constant_speed_is_empty():
    speed = np.full(GRID_N, 50.0, dtype=np.float32)
    pct = ((np.arange(GRID_N) + 0.5) / GRID_N).astype(np.float32)
    assert detect_corners(speed, pct) == []


# --------------------------------------------------------------------------- #
# delta_time
# --------------------------------------------------------------------------- #

def test_delta_time_reference_excludes_anomalous_laps():
    session = _synthetic_session()
    payload = delta_time.compute(session)
    # Lap 3 is slow-anomalous, lap 5 incident-anomalous → reference is clean.
    assert payload["reference_lap"] in (1, 2, 4)


def test_delta_time_slow_lap_is_positive_and_large():
    session = _synthetic_session()
    payload = delta_time.compute(session)
    slow = payload["laps"]["3"]
    assert slow["is_valid"] is True
    assert slow["final_delta_s"] > 1.0
    assert len(slow["delta_curve_s"]) == GRID_N
    # curve is the running integral, so its last point is the final delta
    assert slow["delta_curve_s"][-1] == pytest.approx(slow["final_delta_s"], abs=1e-3)


# --------------------------------------------------------------------------- #
# all three payloads survive JSON, including the zero-corner default profile
# --------------------------------------------------------------------------- #

def test_payloads_json_serializable_with_zero_corners():
    session = _synthetic_session()
    dt = delta_time.compute(session)
    io = input_overlay.compute(session)
    cs = corner_sections.compute(session)

    # Default synthetic is constant-speed: detection finds no corners, and the
    # corner-shaped payloads must degrade gracefully rather than crash.
    assert io["corners_used"] == []
    assert cs["corners"] == []
    assert io["laps"]  # still reports per-lap input diffs

    for payload in (dt, io, cs):
        json.dumps(payload)  # raises TypeError on any numpy scalar/array leak


def test_input_and_section_payloads_with_real_corners():
    """Feed a reference lap that actually has a corner and confirm structure."""
    session = _synthetic_session()
    ref = min(
        (l for l in session.laps if l.is_valid and not l.is_anomalous),
        key=lambda l: l.lap_time_s,
    )
    # Carve a dip into the reference lap's grid speed so corners are detected.
    speed, _ = _dip_profile(depth_min=20.0)
    ref.grid["speed"] = speed

    io = input_overlay.compute(session)
    cs = corner_sections.compute(session)
    assert len(io["corners_used"]) >= 1
    assert len(cs["corners"]) >= 1
    for corner in cs["corners"]:
        assert len(corner["sections"]) == 4
        assert [s["s"] for s in corner["sections"]] == [1, 2, 3, 4]
    # brake_onset_shifts carries one entry per corner (float or explicit null)
    for lap_summary in io["laps"].values():
        assert set(lap_summary["brake_onset_shifts"]) == {
            str(c["id"]) for c in io["corners_used"]
        }
    json.dumps(io)
    json.dumps(cs)


# --------------------------------------------------------------------------- #
# insufficient-data path
# --------------------------------------------------------------------------- #

def test_insufficient_data_when_no_valid_laps():
    session = _synthetic_session()
    for lap in session.laps:
        lap.is_valid = False

    for module in (delta_time, input_overlay, corner_sections):
        payload = module.compute(session)
        assert payload["insufficient_data"] is True
        assert "reason" in payload
        json.dumps(payload)
