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

from app.track_boundary import (  # noqa: E402
    _offsets_in_frame,
    _plausible,
    _usable,
    _widen,
    merge_session,
)

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


class TestPlausible:
    """The second gate, after the absolute one.

    `_offsets_in_frame` rejects anything past 60 m, which catches a dropout but
    not a tow: 35 m across the infield is well inside it. Since the merge below
    only ever widens, whatever gets through here is permanent.
    """

    def test_a_spike_that_cleared_the_absolute_gate_is_still_dropped(self):
        offsets = [6.0] * 400
        offsets[200] = 35.0
        assert _plausible(offsets, "left")[200] is None
        assert _plausible(offsets, "left")[199] == 6.0

    def test_a_road_that_genuinely_widens_survives(self):
        offsets = [6.0] * 400
        for i in range(150, 210):
            offsets[i] = 15.0
        assert _plausible(offsets, "left")[180] == 15.0

    def test_a_narrow_reading_survives(self):
        # The stored boundary is a lower bound; a timid bin is a real reading.
        offsets = [6.0] * 400
        offsets[200] = 0.5
        assert _plausible(offsets, "left")[200] == 0.5

    def test_gaps_stay_gaps_and_the_length_is_kept(self):
        offsets: list[float | None] = [6.0] * 400
        offsets[10] = None
        out = _plausible(offsets, "left")
        assert out[10] is None
        assert len(out) == 400


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


class FakeConn:
    """A connection that records SQL and replays one canned SELECT.

    Enough to drive merge_session's branching without a database, so this suite
    still runs on a laptop or in CI where there is no Postgres.
    """

    def __init__(self, existing=None):
        self.existing = existing
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql, params=None):
        self.calls.append((" ".join(sql.split()), params or ()))
        conn = self

        class Result:
            def fetchone(self_inner):
                return conn.existing

        return Result()

    def sql_of(self, verb: str) -> tuple[str, tuple] | None:
        return next((c for c in self.calls if c[0].startswith(verb)), None)


def _edges_payload(offset_m: float = 5.0, laps: int = 10) -> dict:
    n = 4
    payload = _payload_at(33.0, -84.0, [offset_m] * n)
    payload.update({
        "centre_x_m": [0.0] * n,
        "centre_y_m": [0.0] * n,
        "normal_x": [0.0] * n,
        "normal_y": [1.0] * n,
        "left_m": [offset_m] * n,
        "right_m": [-offset_m] * n,
        "laps_used": list(range(1, laps + 1)),
    })
    return payload


def _stored_row(files: list[int]):
    n = 4
    return (
        33.0, -84.0,                       # origin
        [0.0] * n, [0.0] * n,              # centre
        [0.0] * n, [1.0] * n,              # normal
        [4.0] * n, [-4.0] * n,             # stored edges
        files,                             # contributing_files
    )


class TestContributionCounters:
    """Re-ingesting a file must not inflate how much driving a boundary claims.

    Re-ingest is routine — new analysis modules land and every session is
    replayed — and the EDGES are naturally idempotent under it, because max/min
    of the same data does not move. The counts are not, and they are shown to
    the driver as "measured over N laps here".
    """

    def test_a_new_file_is_counted(self):
        conn = FakeConn(existing=_stored_row([7]))
        merge_session(conn, "caden", 9, "Testland", 4.4, _edges_payload(laps=12))
        _, params = conn.sql_of("UPDATE")
        # (left, right, session_increment, lap_increment, files, user, track)
        assert params[2] == 1
        assert params[3] == 12
        assert params[4] == [7, 9]

    def test_the_same_file_again_is_not_counted_twice(self):
        conn = FakeConn(existing=_stored_row([7, 9]))
        merge_session(conn, "caden", 9, "Testland", 4.4, _edges_payload(laps=12))
        _, params = conn.sql_of("UPDATE")
        assert params[2] == 0
        assert params[3] == 0
        assert params[4] == [7, 9]

    def test_geometry_still_merges_on_a_repeat(self):
        # The counts freeze, the edges do not: a re-parse may have improved
        # them, and a wider measurement must still be taken.
        conn = FakeConn(existing=_stored_row([9]))
        merge_session(conn, "caden", 9, "Testland", 4.4, _edges_payload(offset_m=6.0))
        _, params = conn.sql_of("UPDATE")
        assert params[0] == pytest.approx([6.0] * 4, abs=0.02)

    def test_a_timid_repeat_never_narrows_the_road(self):
        conn = FakeConn(existing=_stored_row([9]))
        merge_session(conn, "caden", 9, "Testland", 4.4, _edges_payload(offset_m=1.0))
        _, params = conn.sql_of("UPDATE")
        assert params[0] == pytest.approx([4.0] * 4, abs=0.02)

    def test_the_first_file_at_a_track_seeds_the_list(self):
        conn = FakeConn(existing=None)
        merge_session(conn, "caden", 3, "Testland", 4.4, _edges_payload(laps=8))
        _, params = conn.sql_of("INSERT")
        assert params[-1] == [3]      # contributing_files
        assert params[-2] == 8        # laps_contributed

    def test_nothing_is_written_without_a_track_name(self):
        conn = FakeConn(existing=None)
        merge_session(conn, "caden", 1, None, 4.4, _edges_payload())
        assert conn.calls == []

    def test_nothing_is_written_when_the_module_could_not_run(self):
        conn = FakeConn(existing=None)
        merge_session(conn, "caden", 1, "Testland", 4.4,
                      {"insufficient_data": True, "reason": "no surface channel"})
        assert conn.calls == []

    def test_a_grid_length_mismatch_leaves_the_boundary_alone(self):
        # Two layouts sharing a track name would misalign every bin.
        conn = FakeConn(existing=_stored_row([1]))
        payload = _edges_payload()
        payload["grid_pct"] = [0.0] * 9
        merge_session(conn, "caden", 2, "Testland", 4.4, payload)
        assert conn.sql_of("UPDATE") is None
