"""Tests for the hardware (module 5) and report_card (module 7) analyses."""

import json

import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import hardware, report_card
from tests.synthetic import build_ibt, make_core_channels


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


# --- hardware -------------------------------------------------------------

def test_hardware_brake_vs_raw_excludes_stationary():
    payload = hardware.compute(_session())
    bvr = payload["brake_vs_raw"]
    # The synthetic's forced stationary auto-brake ticks exist and must be
    # excluded; with them gone there is no moving Brake-vs-BrakeRaw divergence.
    assert bvr["stationary_ticks_excluded"] > 0
    assert bvr["max_abs_diff"] < 0.01
    # Synthetic braking maxes at 0.8 while moving -> demonstrated ceiling 80%.
    assert bvr["brake_ceiling_pct"] == 80.0


def test_hardware_pedal_noise_floor_clean():
    noise = hardware.compute(_session())["pedal_noise_floor"]
    # Full-throttle straights are silent on the synthetic: zero spikes.
    assert noise["spike_ticks"] == 0
    assert noise["qualifying_ticks"] > 0


def test_hardware_abs_all_zeros_is_honest():
    abs_block = hardware.compute(_session())["abs"]
    # BrakeABSactive is all zeros but braking ticks exist: honest 0%, 0 events.
    assert abs_block["engaged_pct_of_braking"] == 0.0
    assert abs_block["activation_events"] == 0
    assert abs_block["finding"] == "no ABS engagement detected"


def test_hardware_brake_bias_available():
    # dcBrakeBias is carried into raw as "brake_bias" since the contract v1.1
    # update; the synthetic holds it constant at 52.0.
    bias = hardware.compute(_session())["brake_bias"]
    assert bias["available"] is True
    assert bias["values"] == [52.0]
    assert bias["changed_during_session"] is False


def test_hardware_areas_of_concern_clean_session():
    aoc = hardware.compute(_session())["areas_of_concern"]
    # Silent pedal, no FFB clipping on the synthetic: nothing to flag, said so.
    assert aoc["concerns"] == []
    assert "no brake-pedal or sensor concerns" in aoc["finding"]
    assert json.loads(json.dumps(aoc))


def test_hardware_areas_of_concern_flags_pedal_noise():
    ch = make_core_channels()
    br = ch["BrakeRaw"].copy()
    # Nonzero brake-sensor reading on full-throttle straights = a noise spike.
    br[ch["Throttle"] > 0.9] = 0.02
    ch["BrakeRaw"] = br
    session = parse_ibt(build_ibt(ch))[0]

    aoc = hardware.compute(session)["areas_of_concern"]
    assert any(c["area"] == "brake sensor noise" for c in aoc["concerns"])
    assert "finding" not in aoc  # a real concern -> not the all-clear path
    assert json.loads(json.dumps(aoc))


def test_hardware_payload_is_json_serializable():
    payload = hardware.compute(_session())
    assert json.loads(json.dumps(payload))["basis"]


# --- report_card ----------------------------------------------------------

def test_report_card_driving_style_left_foot():
    # 8 clean laps, no anomalies: brake applications at each lap boundary where
    # throttle flips to 0 exactly as braking starts -> median ~0ms -> left-foot.
    style = report_card.compute(
        _session(n_laps=10, slow_lap=None, incident_lap=None)
    )["driving_style"]
    assert isinstance(style["median_release_to_brake_ms"], (int, float))
    assert style["median_release_to_brake_ms"] == pytest.approx(0.0, abs=20.0)
    assert style["brake_applications"] >= 5
    assert "left-foot braking" in style["style_observation"]


def test_report_card_fuel_fade_insufficient_data():
    # n_laps=4 -> only laps 1 and 2 are clean (< 4), so no honest pace trend.
    fuel = report_card.compute(_session(n_laps=4))["fuel_fade"]
    assert fuel["pace_trend"]["insufficient_data"] is True
    assert fuel["agreement"] == "insufficient_data"


def test_report_card_frame_health_computed():
    # FrameRate is carried into raw as "frame_rate" since the contract v1.1
    # update; the synthetic runs a steady 120 FPS -> negative result reported.
    frame = report_card.compute(_session())["frame_health"]
    assert frame["available"] is True
    assert frame["min_fps"] == 120.0
    assert frame["sub_60_ticks"] == 0
    assert frame["finding"] == "no sub-60 FPS moments"


def test_report_card_payload_is_json_serializable():
    payload = report_card.compute(_session())
    assert json.loads(json.dumps(payload))["basis"]
