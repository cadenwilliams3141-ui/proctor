"""Tests for the per-track boundary merge.

The DB call is the easy part. What needs proving is the arithmetic around it:
that a second session's edges are re-measured in the FIRST session's frame
before they are compared, and that merging only ever widens a boundary.
"""

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.track_boundary import _offsets_in_frame, _usable, _widen  # noqa: E402

M_PER_DEG = 111320.0


def _payload_at(lat0: float, lon0: float, offsets_m: list[float | None]) -> dict:
    """A track_edges-shaped payload whose left edge sits `offsets_m` to the left
    of a due-east centreline running through (lat0, lon0)."""
    scale_x = M_PER_DEG * math.cos(math.radians(lat0))
    lats, lons = [], []
    for off in offsets_m:
        if off is None:
            lats.append(None)
            lons.append(None)
            continue
        # Centreline runs east, so "left of travel" is north.
        lats.append(lat0 + off / M_PER_DEG)
        lons.append(lon0)
    return {
        "origin": {"lat": lat0, "lon": lon0},
        "grid_pct": [0.0] * len(offsets_m),
        "left_lat": lats,
        "left_lon": lons,
        "right_lat": lats,
        "right_lon": lons,
    }


def _frame(n: int):
    """A stored frame: centreline at the origin, normal pointing north (left)."""
    return [0.0] * n, [0.0] * n, [0.0] * n, [1.0] * n


class TestOffsetsInFrame:
    def test_measures_a_sessions_edges_against_the_stored_centreline(self):
        payload = _payload_at(33.0, -84.0, [5.0, 3.0, -2.0])
        cx, cy, nx, ny = _frame(3)
        out = _offsets_in_frame(payload, (33.0, -84.0), cx, cy, nx, ny, "left")
        assert out == pytest.approx([5.0, 3.0, -2.0], abs=0.02)

    def test_a_second_session_with_a_different_origin_still_lands_correctly(self):
        """The whole reason edges travel as lat/lon rather than as offsets."""
        # Same physical points, but this session's own origin is 40 m north.
        far = 33.0 + 40.0 / M_PER_DEG
        payload = _payload_at(33.0, -84.0, [5.0, 3.0])
        payload["origin"] = {"lat": far, "lon": -84.0}

        cx, cy, nx, ny = _frame(2)
        # Measured in the STORED frame (origin 33.0), not the session's own.
        out = _offsets_in_frame(payload, (33.0, -84.0), cx, cy, nx, ny, "left")
        assert out == pytest.approx([5.0, 3.0], abs=0.02)

    def test_unmeasured_bins_stay_unmeasured(self):
        payload = _payload_at(33.0, -84.0, [5.0, None, 2.0])
        cx, cy, nx, ny = _frame(3)
        out = _offsets_in_frame(payload, (33.0, -84.0), cx, cy, nx, ny, "left")
        assert out[1] is None

    def test_an_implausible_offset_is_dropped_not_stored(self):
        # 500 m from the centreline is a GPS dropout or another layout, not a
        # track edge. It must not be allowed to blow the boundary open.
        payload = _payload_at(33.0, -84.0, [500.0, 4.0])
        cx, cy, nx, ny = _frame(2)
        out = _offsets_in_frame(payload, (33.0, -84.0), cx, cy, nx, ny, "left")
        assert out[0] is None
        assert out[1] == pytest.approx(4.0, abs=0.02)


class TestWiden:
    def test_left_only_ever_moves_further_left(self):
        assert _widen([3.0, 5.0], [4.0, 2.0], "left") == [4.0, 5.0]

    def test_right_only_ever_moves_further_right(self):
        assert _widen([-3.0, -5.0], [-4.0, -2.0], "right") == [-4.0, -5.0]

    def test_a_new_measurement_fills_a_gap(self):
        assert _widen([None, 5.0], [4.0, None], "left") == [4.0, 5.0]

    def test_two_gaps_stay_a_gap(self):
        assert _widen([None], [None], "left") == [None]

    def test_a_timid_session_never_narrows_a_known_edge(self):
        # The point of the merge: a lap down the middle is not evidence that the
        # road got smaller.
        assert _widen([6.0, 6.0], [0.5, 0.5], "left") == [6.0, 6.0]

    def test_a_longer_incoming_array_is_not_truncated(self):
        assert _widen([1.0], [2.0, 3.0], "left") == [2.0, 3.0]


class TestUsable:
    @pytest.mark.parametrize("payload", [
        None,
        {},
        {"insufficient_data": True, "reason": "no surface channel"},
        {"error": "boom"},
        {"grid_pct": [0.0]},                       # no origin
        {"origin": {"lat": 1, "lon": 2}},          # no grid
    ])
    def test_refuses_anything_it_cannot_merge(self, payload):
        assert _usable(payload) is False

    def test_accepts_a_real_payload(self):
        assert _usable(_payload_at(33.0, -84.0, [1.0])) is True
