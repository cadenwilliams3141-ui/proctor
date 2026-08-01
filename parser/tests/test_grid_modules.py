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
# corner geometry — radius and turn direction of the driven line
# --------------------------------------------------------------------------- #

def _circuit_gps(pct, arcs, track_m=4000.0, lat0=33.0, lon0=-84.0):
    """Lat/Lon for a path that is straight except for the given arcs.

    Each arc is (center_pct, half_width_pct, radius_m, +1 left / -1 right).
    Curvature is integrated to a heading and then to a position, so the arcs
    come out at exactly the radius asked for — which is what makes the fitted
    radius checkable against a known answer.
    """
    n = len(pct)
    ds = track_m / n
    kappa = np.zeros(n)
    for center, half, radius, sign in arcs:
        kappa[np.abs(pct - center) < half] = sign / radius

    theta = np.cumsum(kappa * ds)
    x = np.cumsum(np.cos(theta) * ds)
    y = np.cumsum(np.sin(theta) * ds)
    lat = lat0 + y / 111320.0
    lon = lon0 + x / (111320.0 * np.cos(np.radians(lat0)))
    return lat, lon


def test_corner_geometry_fits_a_known_radius_and_direction():
    speed, pct = _dip_profile(depth_min=20.0, center=0.5, half=0.08)
    # The ARC is narrower than the speed dip on purpose: a corner window runs
    # from the braking point to where speed recovers, so it spills onto the
    # straights either side. The fit has to stay inside the bend anyway.
    lat, lon = _circuit_gps(pct, arcs=[(0.5, 0.03, 180.0, +1)])

    corner = detect_corners(speed, pct, lat, lon)[0]
    assert corner["radius_m"] == pytest.approx(180, rel=0.05)
    assert corner["dir"] == "left"


def test_corner_geometry_reads_a_right_hander_as_right():
    speed, pct = _dip_profile(depth_min=18.0, center=0.5, half=0.08)
    lat, lon = _circuit_gps(pct, arcs=[(0.5, 0.03, 95.0, -1)])

    corner = detect_corners(speed, pct, lat, lon)[0]
    assert corner["radius_m"] == pytest.approx(95, rel=0.05)
    assert corner["dir"] == "right"


def test_corner_geometry_absent_when_no_gps_is_supplied():
    speed, pct = _dip_profile(depth_min=20.0)
    corner = detect_corners(speed, pct)[0]
    # Not null — ABSENT. A caller that did not ask for geometry is not handed a
    # pair of nulls it has to interpret.
    assert "radius_m" not in corner
    assert "dir" not in corner


def test_corner_geometry_is_null_when_the_apex_sits_on_a_straight():
    """A speed dip on straight road is not a corner, and says so."""
    speed, pct = _dip_profile(depth_min=20.0, center=0.5, half=0.08)
    lat, lon = _circuit_gps(pct, arcs=[])  # dead straight throughout

    corner = detect_corners(speed, pct, lat, lon)[0]
    assert corner["radius_m"] is None
    assert corner["dir"] is None


def test_corner_geometry_rejects_an_implausible_radius():
    """Beyond the plausibility cap the fit reports nothing, not a huge number."""
    speed, pct = _dip_profile(depth_min=20.0, center=0.5, half=0.08)
    lat, lon = _circuit_gps(pct, arcs=[(0.5, 0.03, 5000.0, +1)])

    corner = detect_corners(speed, pct, lat, lon)[0]
    assert corner["radius_m"] is None
    assert corner["dir"] is None


def test_corner_sections_carries_the_geometry():
    """The payload the UI reads gets radius and direction, not just windows."""
    session = _synthetic_session()
    ref = min(
        (l for l in session.laps if l.is_valid and not l.is_anomalous),
        key=lambda l: l.lap_time_s,
    )
    speed, pct = _dip_profile(depth_min=20.0, center=0.5, half=0.08)
    lat, lon = _circuit_gps(pct, arcs=[(0.5, 0.03, 140.0, -1)])
    ref.grid["speed"] = speed
    ref.grid["lat_gps"] = lat
    ref.grid["lon_gps"] = lon

    payload = corner_sections.compute(session)
    corner = payload["corners"][0]
    assert corner["radius_m"] == pytest.approx(140, rel=0.05)
    assert corner["dir"] == "right"
    json.dumps(payload)


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
