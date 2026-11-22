"""Full-rate lap storage: round trip, resolution, overflow, gaps, size."""

import json

import numpy as np

from proctor_parser import parse_ibt
from proctor_parser.samples import SCALES, decode_lap, encode_lap
from proctor_parser.timing import session_clocks
from tests.synthetic_track import drive_session


def _laps():
    ds = drive_session(n_laps=3, seed=2, noise=0.5)
    s = parse_ibt(ds.ibt())[0]
    clocks, _, _ = session_clocks(s)
    return s, clocks


def test_round_trip_is_within_half_a_step_on_every_channel():
    s, clocks = _laps()
    lap = s.laps[1]
    header, data = encode_lap(lap, clocks[lap.lap_number], 60)
    back = decode_lap(header, data)
    n = len(lap.raw["dist"])
    assert header["n"] == n
    for key, step in SCALES.items():
        if key == "t":
            ref = clocks[lap.lap_number].tick_t_s
        elif key == "d":
            ref = clocks[lap.lap_number].tick_d_m
        elif key in lap.raw:
            ref = np.asarray(lap.raw[key], dtype=np.float64)
            if key == "yaw":
                ref = np.unwrap(ref)
        else:
            assert key not in back
            continue
        err = np.max(np.abs(back[key] - ref))
        assert err <= step / 2 + 1e-9, (key, err, step)
    json.dumps(header)


def test_it_compresses_a_lap_to_well_under_its_raw_size():
    s, clocks = _laps()
    lap = s.laps[1]
    header, data = encode_lap(lap, clocks[lap.lap_number], 60)
    raw_bytes = header["n"] * len(header["ch"]) * 4
    assert len(data) < raw_bytes / 4
    # ~68 s lap: well under 1.5 KB per second of driving.
    assert len(data) / (header["n"] / 60) < 1500


def test_a_jump_too_big_for_int16_falls_back_to_int32():
    s, clocks = _laps()
    lap = s.laps[1]
    lap.raw["rpm"] = lap.raw["rpm"].copy()
    lap.raw["rpm"][100] = lap.raw["rpm"][99] + 50000.0
    header, data = encode_lap(lap, clocks[lap.lap_number], 60)
    widths = {c["k"]: c["w"] for c in header["ch"]}
    assert widths["rpm"] == 4 and widths["speed"] == 2
    back = decode_lap(header, data)
    assert np.allclose(back["rpm"], lap.raw["rpm"], atol=0.5)


def test_missing_ticks_come_back_missing_not_zero():
    s, clocks = _laps()
    lap = s.laps[1]
    lap.raw["fuel"] = lap.raw["fuel"].astype(np.float64).copy()
    lap.raw["fuel"][10:20] = np.nan
    header, data = encode_lap(lap, clocks[lap.lap_number], 60)
    back = decode_lap(header, data)
    assert np.all(np.isnan(back["fuel"][10:20]))
    assert np.isfinite(back["fuel"][20])
