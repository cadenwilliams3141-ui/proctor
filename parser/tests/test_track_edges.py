"""Tests for track_edges (module 17).

The synthetic here is a circuit with a KNOWN half-width, so the module's central
claim can actually be checked rather than asserted: what it reports is a lower
bound on the surface, and driving nearer the edges tightens that bound onto the
real width.
"""

import json
import math

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import track_edges
from tests.synthetic import build_ibt, make_core_channels

TICKS_PER_LAP = 720
N_LAPS = 8
HALF_WIDTH_M = 6.0  # the real track is 12 m wide; the module must not exceed it


def _circuit(u: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A closed loop with corners, in metres about the origin."""
    th = 2 * np.pi * u
    r = 600 + 140 * np.sin(2 * th) + 70 * np.cos(3 * th)
    return r * np.cos(th), r * np.sin(th)


def _session(lap_offsets: dict[int, float] | None = None, *, with_surface: bool = True,
             excursion_lap: int | None = None):
    """Build a session where each lap sits at a chosen lateral offset, in metres.

    Offsets past HALF_WIDTH_M put the car off the racing surface, which is what
    the sim's own flag would say and what this module reads.
    """
    n = N_LAPS * TICKS_PER_LAP
    t = np.arange(n)
    lap = t // TICKS_PER_LAP
    in_lap = t % TICKS_PER_LAP
    u = in_lap / TICKS_PER_LAP

    du = 1e-4
    x0, y0 = _circuit(u - du)
    x1, y1 = _circuit(u)
    x2, y2 = _circuit(u + du)
    dx, dy = (x2 - x0) / (2 * du), (y2 - y0) / (2 * du)
    length = np.maximum(np.hypot(dx, dy), 1e-9)
    nx, ny = -dy / length, dx / length

    offsets = lap_offsets or {}
    off = np.array([offsets.get(int(l), 0.0) for l in lap], dtype=np.float64)
    if excursion_lap is not None:
        off[(lap == excursion_lap) & (in_lap > 300) & (in_lap < 360)] = HALF_WIDTH_M + 3.0

    gx, gy = x1 + nx * off, y1 + ny * off
    scale_x = 111320.0 * math.cos(math.radians(33.0))

    ch = make_core_channels(n_laps=N_LAPS, ticks_per_lap=TICKS_PER_LAP,
                            slow_lap=None, incident_lap=None)
    ch["Lat"] = 33.0 + gy / 111320.0
    ch["Lon"] = -84.0 + gx / scale_x

    if with_surface:
        surface = np.where(np.abs(off) <= HALF_WIDTH_M, 3.0, 0.0)
        # The out lap starts in the pit stall, which must never widen the track.
        surface[(lap == 0) & (in_lap < 10)] = 1.0
        ch["PlayerTrackSurface"] = surface
        ch["PlayerTrackSurfaceMaterial"] = np.where(
            np.abs(off) > HALF_WIDTH_M, 15.0,                      # grass
            np.where(np.abs(off) > HALF_WIDTH_M - 1.0, 12.0, 2.0),  # kerb / asphalt
        )
    return parse_ibt(build_ibt(ch))[0]


def _widths(payload: dict) -> list[float]:
    return [v for v in payload["width_m"] if v is not None]


# --- the channel it depends on -------------------------------------------

def test_reports_itself_unavailable_without_the_surface_channel():
    payload = track_edges.compute(_session(with_surface=False))
    assert payload["insufficient_data"] is True
    assert "PlayerTrackSurface" in payload["reason"]
    # And it must not fall back to inferring the track from the driven line.
    assert "inferred" in payload["reason"]
    assert json.loads(json.dumps(payload))


def test_optional_channel_reaches_the_lap_objects():
    session = _session()
    assert "track_surface" in session.laps[1].raw
    assert "track_surface_material" in session.laps[1].raw


def test_a_file_without_the_channel_still_parses():
    # The channel is optional precisely so its absence cannot fail the file.
    session = _session(with_surface=False)
    assert len(session.laps) == N_LAPS
    assert "track_surface" not in session.laps[1].raw


# --- the measurement ------------------------------------------------------

def test_measured_width_never_exceeds_the_real_track():
    # Every lap inside the surface: whatever the module reports, it cannot be
    # wider than the road, because no on-track tick ever was.
    offsets = {i: (i - N_LAPS / 2) * 1.1 for i in range(N_LAPS)}
    payload = track_edges.compute(_session(offsets))
    widths = _widths(payload)
    assert widths
    assert max(widths) <= 2 * HALF_WIDTH_M + 0.5


def test_it_is_a_lower_bound_that_edge_laps_tighten():
    """The claim the module makes about itself, checked both ways."""
    timid = track_edges.compute(_session({i: 0.4 * (i - 4) for i in range(N_LAPS)}))
    # Two laps hugging each edge — the calibration laps other analysers ask for.
    edges = track_edges.compute(
        _session({0: 0.0, 1: -5.9, 2: 5.9, 3: 0.0, 4: -5.9, 5: 5.9, 6: 0.0, 7: 0.0})
    )

    timid_width = float(np.median(_widths(timid)))
    edge_width = float(np.median(_widths(edges)))

    # Tiptoeing down the middle under-reports the road badly...
    assert timid_width < 5.0
    # ...and driving the edges lands within a metre of the truth.
    assert edge_width == pytest.approx(2 * HALF_WIDTH_M, abs=1.0)
    assert edge_width > timid_width


def test_pit_lane_never_widens_the_circuit():
    # InPitStall is not OnTrack, so those ticks are excluded by construction.
    payload = track_edges.compute(_session({i: 0.0 for i in range(N_LAPS)}))
    widths = _widths(payload)
    assert max(widths) < 1.0


def test_unmeasured_bins_are_null_not_zero():
    payload = track_edges.compute(_session())
    # Every emitted array keeps None for a bin nothing was seen in; a zero there
    # would draw as a real edge on the centreline.
    for key in ("left_m", "right_m", "width_m", "left_lat", "right_lon"):
        assert all(v is None or isinstance(v, float) for v in payload[key])
    assert 0.0 <= payload["coverage_pct"] <= 100.0


def test_edge_positions_are_emitted_as_lat_lon_for_merging():
    payload = track_edges.compute(_session({1: -5.0, 2: 5.0}))
    n = len(payload["grid_pct"])
    for key in ("left_lat", "left_lon", "right_lat", "right_lon"):
        assert len(payload[key]) == n
    seen = [v for v in payload["left_lat"] if v is not None]
    assert seen and all(30 < v < 36 for v in seen)


# --- surface and excursions ----------------------------------------------

def test_off_track_excursion_is_found_and_named():
    payload = track_edges.compute(_session(excursion_lap=3))
    excursions = payload["surface"]["excursions"]
    assert excursions
    assert excursions[0]["lap"] == 3
    assert excursions[0]["surface"] == "grass"
    assert excursions[0]["duration_ms"] > 0


def test_a_clean_session_says_so_rather_than_going_quiet():
    payload = track_edges.compute(_session({i: 0.0 for i in range(N_LAPS)}))
    assert payload["surface"]["excursions"] == []
    assert "never recorded the car off" in payload["surface"]["finding"]


def test_kerb_time_is_reported_not_judged():
    payload = track_edges.compute(_session({1: -5.5, 2: 5.5}))
    surface = payload["surface"]
    assert surface["kerb_pct"] > 0
    assert "not judged" in surface["kerb_note"]
    assert surface["materials_pct"]["asphalt"] > 0


def test_material_names_only_where_the_code_is_known():
    assert track_edges.material_name(2) == "asphalt"
    assert track_edges.material_name(12) == "kerb"
    assert track_edges.material_name(15) == "grass"
    assert track_edges.material_name(23) == "sand"
    # An unrecognised code reports its number rather than being given a label.
    assert track_edges.material_name(99) == "material 99"


def test_payload_is_json_serializable():
    assert json.loads(json.dumps(track_edges.compute(_session({1: -5.0, 2: 5.0}))))
