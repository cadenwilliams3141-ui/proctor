"""Structural tests on synthetic .ibt files — no real telemetry required."""

import numpy as np
import pytest

from proctor_parser import (
    GRID_POINTS,
    IbtFile,
    IbtFormatError,
    MissingChannelsError,
    moving_mask,
    parse_ibt,
)
from tests.synthetic import build_ibt, make_core_channels


def test_header_and_record_count():
    ch = make_core_channels()
    ibt = IbtFile(build_ibt(ch))
    assert ibt.header.num_vars == 42
    assert ibt.header.tick_rate == 60
    assert ibt.record_count == len(ch["Speed"])


def test_by_name_lookup_survives_reordering():
    ch = make_core_channels()
    order_a = list(ch)
    order_b = list(reversed(order_a))
    ibt_a = IbtFile(build_ibt(ch, channel_order=order_a))
    ibt_b = IbtFile(build_ibt(ch, channel_order=order_b))
    assert ibt_a.channels["Speed"].offset != ibt_b.channels["Speed"].offset
    np.testing.assert_array_equal(ibt_a.channel("Speed"), ibt_b.channel("Speed"))
    np.testing.assert_array_equal(ibt_a.channel("dcBrakeBias"), ibt_b.channel("dcBrakeBias"))


def test_truncated_file_fails_cleanly():
    data = build_ibt(make_core_channels())
    with pytest.raises(IbtFormatError):
        IbtFile(data[:100])
    with pytest.raises(IbtFormatError):
        IbtFile(b"\x00" * 200)


def test_missing_core_channel_raises_with_names():
    ch = make_core_channels()
    del ch["dcBrakeBias"]
    order = [c for c in ch]
    data = build_ibt(ch, channel_order=order)
    with pytest.raises(MissingChannelsError) as exc:
        parse_ibt(data)
    assert "dcBrakeBias" in exc.value.missing


def test_lap_flags_and_times():
    sessions = parse_ibt(build_ibt(make_core_channels()))
    assert len(sessions) == 1
    laps = sessions[0].laps
    assert len(laps) == 7

    out_lap = laps[0]
    assert out_lap.is_out_lap and not out_lap.is_valid

    partial = laps[-1]
    assert not partial.is_valid and partial.lap_time_s is None

    for lap in laps[1:-1]:
        assert lap.is_valid
        assert lap.lap_time_s == pytest.approx(12.0)  # 720 ticks @ 60 Hz


def test_anomaly_flags():
    sessions = parse_ibt(build_ibt(make_core_channels(slow_lap=3, incident_lap=5)))
    by_num = {lap.lap_number: lap for lap in sessions[0].laps}
    assert by_num[3].is_anomalous          # speed-profile outlier
    assert by_num[5].incident_delta == 4   # counter stepped mid-lap
    assert by_num[5].is_anomalous          # incident-flagged
    assert not by_num[2].is_anomalous


def test_wear_masked_detection():
    frozen = parse_ibt(build_ibt(make_core_channels(wear_varies=False)))
    live = parse_ibt(build_ibt(make_core_channels(wear_varies=True)))
    assert frozen[0].meta.wear_masked is True
    assert live[0].meta.wear_masked is False


def test_stationary_auto_brake_guard():
    ch = make_core_channels()
    ibt = IbtFile(build_ibt(ch))
    speed = ibt.channel("Speed")
    brake = ibt.channel("Brake")
    brake_raw = ibt.channel("BrakeRaw")

    stationary = ~moving_mask(speed)
    # The trap exists in the data: stopped ticks show full Brake, zero BrakeRaw.
    assert np.all(brake[stationary][:10] == 1.0)
    assert np.all(brake_raw[stationary][:10] == 0.0)
    # With the guard applied there is no Brake-vs-BrakeRaw divergence.
    moving = moving_mask(speed)
    assert np.max(np.abs(brake[moving] - brake_raw[moving])) < 1e-6


def test_session_num_split():
    data = build_ibt(make_core_channels(session_break_at_lap=4, incident_lap=None))
    sessions = parse_ibt(data)
    assert [s.meta.session_num for s in sessions] == [0, 1]
    assert sessions[0].meta.session_type == "Testing"
    assert sessions[1].meta.session_type == "Race"
    assert len(sessions[0].laps) == 4
    assert len(sessions[1].laps) == 3


def test_yaml_meta():
    sessions = parse_ibt(build_ibt(make_core_channels()))
    meta = sessions[0].meta
    assert meta.track_name == "Testland"
    assert meta.car_name == "Test Car GT3"
    assert meta.track_length_km == pytest.approx(4.0)
    assert meta.car_redline_rpm == pytest.approx(9000.0)


def test_grid_shape_and_monotonicity():
    sessions = parse_ibt(build_ibt(make_core_channels()))
    lap = sessions[0].laps[2]
    for key, arr in lap.grid.items():
        assert len(arr) == GRID_POINTS, key
    assert np.all(np.diff(lap.grid["grid_pct"]) > 0)
    raw_len = len(lap.raw["speed"])
    assert all(len(v) == raw_len for v in lap.raw.values())


def test_repeated_lap_numbers_are_remapped_unique():
    ch = make_core_channels(n_laps=6, incident_lap=None, slow_lap=None)
    n = len(ch["Lap"])
    ch["Lap"] = ch["Lap"] % 3  # reset/tow pattern: 0,1,2,0,1,2
    sessions = parse_ibt(build_ibt(ch))
    numbers = [lap.lap_number for lap in sessions[0].laps]
    assert len(numbers) == 6
    assert len(set(numbers)) == 6, f"lap numbers must be unique, got {numbers}"
    assert numbers == sorted(numbers)  # chronological order preserved
