"""Tests for the OSM/boundary comparison harness.

The tool's entire value is that its separation figure can be believed, in both
directions: it has to report agreement when two datasets really do line up, and
it has to report metres when they do not. A comparison that flatters its inputs
would send someone off to build an overlay that draws clean laps running wide.

So the geometry is tested against cases with a known answer — a shape offset by
an exact distance, a segment a vertex-only measure would get wrong, a circuit
that is simply absent — rather than against whatever OSM happens to return.
"""
from __future__ import annotations

import math
import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tools.compare_osm_boundary import (  # noqa: E402
    M_PER_DEG,
    fit_translation,
    compare,
    point_polyline_distance,
    summarise,
    to_geographic,
    to_local,
    verdict,
    ways_from,
    width_comparison,
)

ORIGIN_LAT, ORIGIN_LON = 33.807222, -83.809722   # Road Atlanta, near enough


# ── the projection ───────────────────────────────────────────────────────────

def test_projection_round_trips():
    """Anything compared against a boundary arrives through this."""
    lat = ORIGIN_LAT + np.array([0.0, 0.001, -0.002, 0.0005])
    lon = ORIGIN_LON + np.array([0.0, -0.0015, 0.003, 0.0001])
    x, y = to_local(lat, lon, ORIGIN_LAT, ORIGIN_LON)
    back_lat, back_lon = to_geographic(x, y, ORIGIN_LAT, ORIGIN_LON)
    assert np.allclose(back_lat, lat, atol=1e-12)
    assert np.allclose(back_lon, lon, atol=1e-12)


def test_projection_scale_is_metres():
    """One thousandth of a degree of latitude is ~111.32 m, by definition."""
    _, y = to_local([ORIGIN_LAT + 0.001], [ORIGIN_LON], ORIGIN_LAT, ORIGIN_LON)
    assert y[0] == pytest.approx(M_PER_DEG * 0.001, rel=1e-9)


def test_projection_uses_the_boundary_frame_not_its_own():
    """The offset must SURVIVE projection, or the tool cannot measure anything.

    Re-centring incoming geometry on its own mean would slide the two datasets
    together and report agreement that was manufactured in the projection.
    """
    lat = np.full(8, ORIGIN_LAT + 0.0009)      # ~100 m north of the origin
    lon = np.full(8, ORIGIN_LON)
    _, y = to_local(lat, lon, ORIGIN_LAT, ORIGIN_LON)
    assert float(np.mean(y)) == pytest.approx(100.19, abs=0.5)
    assert float(np.std(y)) == pytest.approx(0.0, abs=1e-9)


# ── point-to-polyline ────────────────────────────────────────────────────────

def test_distance_to_a_parallel_line_is_the_offset():
    px = np.linspace(0, 100, 21)
    py = np.full(21, 5.0)
    d = point_polyline_distance(px, py, np.array([0.0, 100.0]), np.array([0.0, 0.0]))
    assert np.allclose(d, 5.0, atol=1e-9)


def test_distance_measures_to_segments_not_vertices():
    """The case that decides whether the tool is honest about straights.

    OSM draws a straight with two nodes; telemetry records it with a thousand.
    A vertex-only measure would call the midpoint 50 m from the road when it is
    sitting exactly on it — reporting the two datasets' sampling as error.
    """
    d = point_polyline_distance(
        np.array([50.0]), np.array([0.0]),
        np.array([0.0, 100.0]), np.array([0.0, 0.0]),
    )
    assert d[0] == pytest.approx(0.0, abs=1e-9)


def test_distance_clamps_past_the_end_of_a_segment():
    """A point beyond the end is measured to the endpoint, not to the infinite line."""
    d = point_polyline_distance(
        np.array([130.0]), np.array([0.0]),
        np.array([0.0, 100.0]), np.array([0.0, 0.0]),
    )
    assert d[0] == pytest.approx(30.0, abs=1e-9)


def test_distance_survives_duplicate_nodes():
    """OSM ways do contain repeated coordinates; a zero-length segment must not
    divide by zero and poison the whole comparison with NaN."""
    d = point_polyline_distance(
        np.array([0.0]), np.array([3.0]),
        np.array([0.0, 0.0, 10.0]), np.array([0.0, 0.0, 0.0]),
    )
    assert np.isfinite(d[0]) and d[0] == pytest.approx(3.0, abs=1e-9)


def test_distance_is_infinite_without_a_line():
    d = point_polyline_distance(np.array([0.0]), np.array([0.0]),
                                np.array([1.0]), np.array([1.0]))
    assert not np.isfinite(d[0])


# ── translation diagnostic ───────────────────────────────────────────────────

def test_fit_translation_recovers_a_known_shift():
    """A planted shift must come back whole.

    One step of matched pairs returns HALF of it on a closed loop, because
    nearest-point matching only sees the component across the curve. This is the
    test that catches that; it failed at 2.0 against the single-step version.
    """
    x, y = _ring(400.0)
    dx, dy = fit_translation(x, y, [(np.append(x, x[0]) + 4.0, np.append(y, y[0]))])
    assert dx == pytest.approx(4.0, abs=0.05)
    assert dy == pytest.approx(0.0, abs=0.05)


def test_fit_translation_does_not_invent_a_shift_for_a_shape_difference():
    """Iterating must not let a translation soak up a difference in shape."""
    x, y = _ring(400.0)
    dx, dy = fit_translation(x, y, [(x, y * 1.04)])
    assert math.hypot(dx, dy) < 1.0


# ── the comparison, end to end ───────────────────────────────────────────────

def _ring(radius_m: float, n: int = 240):
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    return radius_m * np.cos(t), radius_m * np.sin(t)


def _boundary(x, y, left=4.0, right=-4.0) -> dict:
    n = x.size
    norm = np.hypot(x, y)
    return {
        "track_name": "Testland",
        "origin_lat": ORIGIN_LAT,
        "origin_lon": ORIGIN_LON,
        "track_length_km": 4.0,
        "grid_pct": np.linspace(0, 1, n, endpoint=False),
        "centre_x": x, "centre_y": y,
        "normal_x": x / norm, "normal_y": y / norm,
        "left_m": np.full(n, left), "right_m": np.full(n, right),
        "sessions_contributed": 1, "laps_contributed": 9,
    }


def _way_from_local(x, y, way_id=1, tags=None) -> dict:
    lat, lon = to_geographic(x, y, ORIGIN_LAT, ORIGIN_LON)
    return {"id": way_id, "tags": tags or {"highway": "raceway"}, "lat": lat, "lon": lon}


def test_identical_geometry_reports_agreement():
    x, y = _ring(400.0)
    b = _boundary(x, y)
    # Closed loop: repeat the first node, as a mapped circuit does.
    result = compare(b, [_way_from_local(np.append(x, x[0]), np.append(y, y[0]))])
    assert result["matched"] is True
    assert result["raw_separation"]["median_m"] < 0.05
    assert verdict(result).startswith("AGREES")


def test_a_four_metre_offset_is_reported_as_four_metres():
    """The case the whole tool exists for: it must NOT flatter a bad overlay.

    THE MEDIAN IS NOT THE SHIFT, and the arithmetic matters for reading a real
    run. Shift a closed loop by n metres and the perpendicular separation runs
    n*|cos t| around it — n where the shift is across the road, nothing where it
    is along it. The median of |cos t| is sin(pi/4), so a 4 m shift reads 2.83 m
    median and 4 m max. Anyone reading the median as "how far out OSM is" will
    understate it by 30%; the MAX is the figure that bounds how wrong a drawn
    lap could be. (The first version of this test asserted the median was ~4 and
    failed against correct code.)
    """
    x, y = _ring(400.0)
    b = _boundary(x, y)
    result = compare(b, [_way_from_local(np.append(x, x[0]) + 4.0,
                                         np.append(y, y[0]))])
    assert result["matched"] is True
    assert result["raw_separation"]["median_m"] == pytest.approx(
        4.0 * math.sin(math.pi / 4), abs=0.05
    )
    assert result["raw_separation"]["max_m"] == pytest.approx(4.0, abs=0.05)
    # A pure translation must be recognised AS one, and must not be quietly
    # removed from the headline number.
    assert result["translation_only"]["shift_magnitude_m"] == pytest.approx(4.0, abs=0.2)
    assert result["translation_only"]["residual"]["median_m"] < 0.5
    assert verdict(result).startswith("SHIFTED")


def test_a_distant_circuit_is_not_matched():
    """A kart track down the road is a different road, and says so."""
    x, y = _ring(400.0)
    b = _boundary(x, y)
    far_x, far_y = _ring(120.0)
    result = compare(b, [_way_from_local(far_x + 5000.0, far_y)])
    assert result["matched"] is False
    assert "not in OpenStreetMap" in result["reason"]
    assert verdict(result).startswith("NO MATCH")
    # Everything found is still reported rather than dropped.
    assert len(result["ways_considered"]) == 1


def test_a_shape_disagreement_is_not_absorbed_by_the_shift():
    """A genuinely different shape must survive the translation diagnostic."""
    x, y = _ring(400.0)
    b = _boundary(x, y)
    wrong_x, wrong_y = _ring(400.0)
    wrong_y = wrong_y * 1.04                       # squashed: same centroid
    result = compare(b, [_way_from_local(wrong_x, wrong_y)])
    assert result["matched"] is True
    assert result["translation_only"]["shift_magnitude_m"] < 1.0
    assert result["translation_only"]["residual"]["median_m"] > 3.0


# ── width ────────────────────────────────────────────────────────────────────

def test_width_reports_absence_of_the_tag_rather_than_a_number():
    x, y = _ring(400.0)
    b = _boundary(x, y)
    result = compare(b, [_way_from_local(np.append(x, x[0]), np.append(y, y[0]))])
    w = width_comparison(b, result)
    assert w["road_you_used"]["median_m"] == pytest.approx(8.0, abs=0.01)
    assert w["osm_width_tag_m"] is None
    assert w["osm_has_surface_polygon"] is False
    assert w["band_exceeds_tag"] is None      # not False — nothing to compare against


def test_a_band_wider_than_the_tag_is_flagged():
    """You cannot drive wider than the road, so this indicts the tag or the fit."""
    x, y = _ring(400.0)
    b = _boundary(x, y, left=9.0, right=-9.0)     # an 18 m band
    way = _way_from_local(np.append(x, x[0]), np.append(y, y[0]),
                          tags={"highway": "raceway", "width": "12"})
    result = compare(b, [way])
    w = width_comparison(b, result)
    assert w["osm_width_tag_m"] == [12.0]
    assert w["band_exceeds_tag"] is True


# ── parsing ──────────────────────────────────────────────────────────────────

def test_ways_from_skips_geometryless_elements():
    osm = {"elements": [
        {"type": "way", "id": 1, "tags": {}, "geometry": [{"lat": 1.0, "lon": 2.0}]},
        {"type": "node", "id": 2, "lat": 1.0, "lon": 2.0},
        {"type": "way", "id": 3, "tags": {"highway": "raceway"},
         "geometry": [{"lat": 1.0, "lon": 2.0}, {"lat": 1.1, "lon": 2.1}]},
    ]}
    ways = ways_from(osm)
    assert [w["id"] for w in ways] == [3]


def test_summarise_states_when_there_is_nothing_to_summarise():
    assert summarise(np.array([np.inf, np.nan]))["measured"] is False
