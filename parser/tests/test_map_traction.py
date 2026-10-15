"""Tests for the track_map (module 2) and traction_circle (module 6) analyses."""

import json

import numpy as np
import pytest

from proctor_parser import GRID_POINTS, parse_ibt
from proctor_parser.analysis import track_map, traction_circle
from tests.synthetic import build_ibt, make_core_channels


@pytest.fixture
def session():
    return parse_ibt(build_ibt(make_core_channels()))[0]


# --- track_map -------------------------------------------------------------

def test_track_map_arrays_length_and_centered(session):
    payload = track_map.compute(session)
    assert "insufficient_data" not in payload
    x = np.array(payload["x_m"])
    y = np.array(payload["y_m"])
    assert len(x) == GRID_POINTS
    assert len(y) == GRID_POINTS
    assert len(payload["grid_pct"]) == GRID_POINTS
    # Projection is about the lap centroid, so the cloud is centred on 0.
    assert abs(float(np.mean(x))) < 1.0
    assert abs(float(np.mean(y))) < 1.0


def test_track_map_projection_scale(session):
    payload = track_map.compute(session)
    y = np.array(payload["y_m"])
    # Synthetic Lat = 33 + dist*0.01, so the y span ≈ 0.01 deg * 111320 m/deg.
    expected = 0.01 * 111320.0
    y_span = float(y.max() - y.min())
    assert abs(y_span - expected) / expected < 0.05
    assert payload["projection"] == "local_equirectangular_meters"
    assert isinstance(payload["source_lap"], int)


def test_track_map_carries_its_projection_anchor(session):
    """The map must say WHERE it is, not just what shape it is.

    lat_mean/lon_mean were computed to project the lap and then dropped, which
    left x_m/y_m as offsets about an origin nobody recorded. This asserts the
    round trip, because that is the only thing the anchor is for: projecting
    forward and inverting must land back on the GPS the file actually carried.
    """
    payload = track_map.compute(session)
    lat0 = payload["origin_lat"]
    lon0 = payload["origin_lon"]
    mpd = payload["meters_per_degree"]

    # The anchor is a real place on Earth, not a placeholder.
    assert -90.0 <= lat0 <= 90.0
    assert -180.0 <= lon0 <= 180.0

    ref = next(l for l in session.laps if l.lap_number == payload["source_lap"])
    lat = np.asarray(ref.grid["lat_gps"], dtype=float)
    lon = np.asarray(ref.grid["lon_gps"], dtype=float)

    x = np.array(payload["x_m"])
    y = np.array(payload["y_m"])
    back_lat = lat0 + y / mpd
    back_lon = lon0 + x / (mpd * np.cos(np.radians(lat0)))

    # Within the rounding the payload applies (x_m/y_m to the centimetre).
    assert np.max(np.abs(back_lat - lat)) < 1e-6
    assert np.max(np.abs(back_lon - lon)) < 1e-6


def test_track_map_json_serializable(session):
    json.dumps(track_map.compute(session))


def test_track_map_insufficient_without_gps(session):
    # Zero out GPS everywhere: the map collapses and must refuse honestly.
    for lap in session.laps:
        lap.grid["lat_gps"] = np.zeros_like(lap.grid["lat_gps"])
        lap.grid["lon_gps"] = np.zeros_like(lap.grid["lon_gps"])
    payload = track_map.compute(session)
    assert payload["insufficient_data"] is True
    json.dumps(payload)


# --- traction_circle -------------------------------------------------------

def test_traction_envelope_has_36_entries(session):
    payload = traction_circle.compute(session)
    assert "insufficient_data" not in payload
    assert len(payload["envelope"]) == 36
    centers = [e["angle_deg"] for e in payload["envelope"]]
    assert centers == [round(i * 10 + 5, 1) for i in range(36)]


def test_traction_populated_bins_have_nonzero_radius(session):
    # LatAccel=sin(dist*2π)*15, LongAccel ±20/5 → a real g-g cloud.
    payload = traction_circle.compute(session)
    populated = [e["g"] for e in payload["envelope"] if e["g"] is not None]
    assert populated, "at least some bins populated"
    assert all(g > 0 for g in populated)


def test_traction_every_valid_lap_utilization_in_range(session):
    payload = traction_circle.compute(session)
    valid_nums = {str(l.lap_number) for l in session.laps if l.is_valid}
    assert valid_nums, "synthetic session has valid laps"
    for num in valid_nums:
        util = payload["laps"][num]["utilization_pct"]
        assert util is not None, num
        assert 0.0 <= util <= 100.0, (num, util)


def test_traction_scatter_capped_and_json(session):
    payload = traction_circle.compute(session)
    assert len(payload["scatter"]) <= 3000
    assert all(len(pt) == 2 for pt in payload["scatter"])
    json.dumps(payload)


def test_traction_insufficient_on_zero_accel(session):
    # Degenerate: null out the raw acceleration channels the module reads.
    for lap in session.laps:
        lap.raw["lat_accel"] = np.zeros_like(lap.raw["lat_accel"])
        lap.raw["long_accel"] = np.zeros_like(lap.raw["long_accel"])
    payload = traction_circle.compute(session)
    assert payload["insufficient_data"] is True
    json.dumps(payload)
