"""Tests for the hardware (module 5) and report_card (module 7) analyses."""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import hardware, report_card
from tests.synthetic import build_ibt, make_core_channels


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


# --- hardware -------------------------------------------------------------

def test_hardware_owns_only_the_rig():
    """Driver-vs-car numbers live in input_response; this module does not repeat them.

    Two copies drifted before: the ABS share here counted braking off the
    applied channel and input_response off the pedal, so two screens printed
    different figures for one session.
    """
    payload = hardware.compute(_session())
    for gone in ("brake_vs_raw", "abs", "areas_of_concern"):
        assert gone not in payload


def test_hardware_pedal_noise_floor_clean():
    noise = hardware.compute(_session())["pedal_noise_floor"]
    # Full-throttle straights are silent on the synthetic: zero spikes.
    assert noise["spike_ticks"] == 0
    assert noise["qualifying_ticks"] > 0
    assert noise["brief_spikes"]["events"] == 0
    assert noise["brief_spikes"]["peak_pct"] is None
    assert noise["flagged"] is False
    assert noise["finding"] == "no brake signal while you were flat on the throttle"


def test_hardware_brake_bias_available():
    # dcBrakeBias is carried into raw as "brake_bias" since the contract v1.1
    # update; the synthetic holds it constant at 52.0.
    bias = hardware.compute(_session())["brake_bias"]
    assert bias["available"] is True
    assert bias["values"] == [52.0]
    assert bias["changed_during_session"] is False


def test_hardware_flags_sub_band_pedal_noise():
    ch = make_core_channels()
    br = ch["BrakeRaw"].copy()
    # Nonzero brake-sensor reading on full-throttle straights = a noise spike.
    br[ch["Throttle"] > 0.9] = 0.02
    ch["BrakeRaw"] = br
    noise = hardware.compute(parse_ibt(build_ibt(ch))[0])["pedal_noise_floor"]
    assert noise["spike_ticks"] > 0
    assert noise["flagged"] is True
    assert "finding" not in noise  # a real signal -> not the all-clear path
    assert json.loads(json.dumps(noise))


def _full_throttle_moving(ch):
    """Indices of a long full-throttle, moving stretch in lap 2 of the synthetic."""
    full = (ch["Throttle"] > 0.9) & (ch["Speed"] > 5.0)
    idx = np.flatnonzero(full)
    return idx[(idx > 2 * 720 + 100) & (idx < 2 * 720 + 600)]


def test_hardware_counts_a_brief_spike_the_noise_floor_cannot_see():
    """A one-frame jump to 30% is the fault a driver wants told about.

    The sub-5% noise floor excludes it by construction -- its qualifying ticks
    stop at 5% -- so before this check it went uncounted entirely.
    """
    ch = make_core_channels()
    at = _full_throttle_moving(ch)[50]
    br = ch["BrakeRaw"].copy()
    br[at : at + 2] = 0.3  # 2 ticks = 33 ms at 60 Hz: no foot does that
    ch["BrakeRaw"] = br
    noise = hardware.compute(parse_ibt(build_ibt(ch))[0])["pedal_noise_floor"]
    assert noise["brief_spikes"]["events"] == 1
    assert noise["brief_spikes"]["peak_pct"] == 30.0
    assert noise["spike_ticks"] == 0, "the original sub-5% count must not move"
    assert noise["flagged"] is True


def test_hardware_left_foot_overlap_is_not_a_spike():
    """Brake applied before the throttle lifts, and held: the driver, not the sensor."""
    ch = make_core_channels()
    at = _full_throttle_moving(ch)[100]
    br = ch["BrakeRaw"].copy()
    th = ch["Throttle"].copy()
    br[at : at + 30] = 0.5      # half a second of brake...
    th[at + 3 : at + 30] = 0.0  # ...that started 3 ticks before the lift
    ch["BrakeRaw"] = br
    ch["Throttle"] = th
    noise = hardware.compute(parse_ibt(build_ibt(ch))[0])["pedal_noise_floor"]
    assert noise["brief_spikes"]["events"] == 0


def test_hardware_brief_spike_while_stationary_is_ignored():
    ch = make_core_channels()
    at = _full_throttle_moving(ch)[50]
    br = ch["BrakeRaw"].copy()
    sp = ch["Speed"].copy()
    br[at : at + 2] = 0.3
    sp[at - 5 : at + 5] = 0.0
    ch["BrakeRaw"] = br
    ch["Speed"] = sp
    noise = hardware.compute(parse_ibt(build_ibt(ch))[0])["pedal_noise_floor"]
    assert noise["brief_spikes"]["events"] == 0


def test_hardware_ffb_flag_follows_its_threshold():
    clean = hardware.compute(_session())["ffb"]
    assert clean["flagged"] is False

    ch = make_core_channels()
    stops = ch["SteeringWheelPctTorqueSignStops"].copy()
    stops[: len(stops) // 4] = 1.0
    ch["SteeringWheelPctTorqueSignStops"] = stops
    ffb = hardware.compute(parse_ibt(build_ibt(ch))[0])["ffb"]
    assert ffb["clipping_pct"] >= ffb["flag_threshold_pct"]
    assert ffb["flagged"] is True


def test_hardware_ffb_clipping_counts_both_steering_directions():
    """SteeringWheelPctTorqueSignStops is SIGNED, so clipping is |x| >= 0.99.

    Regression for a bug that could only ever under-report: the check used to
    be a bare `>= 0.99`, which sees the wheel pinned one way and is blind to it
    pinned the other. The synthetic holds the channel flat at 0.4, so nothing
    in the suite had ever driven it against a stop in either direction.

    Planted here: a quarter of the ticks clipped NEGATIVE and nothing positive.
    The old code reported 0.0% and printed "no FFB clipping detected" over a
    session that spent a quarter of its time against the stops.
    """
    ch = make_core_channels()
    stops = ch["SteeringWheelPctTorqueSignStops"].copy()
    n = len(stops)
    clipped = slice(0, n // 4)
    stops[clipped] = -1.0
    ch["SteeringWheelPctTorqueSignStops"] = stops
    session = parse_ibt(build_ibt(ch))[0]

    ffb = hardware.compute(session)["ffb"]
    assert ffb["clipping_pct"] > 0.0, "negative-direction clipping went uncounted"
    assert "finding" not in ffb, "reported the all-clear over a clipped session"

    # And the share is the real one, not half of it. The planted ticks are a
    # quarter of the file; moving_mask drops the stationary ones, so the share
    # among MOVING ticks is what is asserted, with room for that trim.
    assert 15.0 < ffb["clipping_pct"] <= 30.0


def test_hardware_ffb_clipping_is_symmetric_in_sign():
    """The same magnitude clipped either way must report the same share."""
    shares = []
    for sign in (1.0, -1.0):
        ch = make_core_channels()
        stops = ch["SteeringWheelPctTorqueSignStops"].copy()
        stops[: len(stops) // 4] = sign
        ch["SteeringWheelPctTorqueSignStops"] = stops
        session = parse_ibt(build_ibt(ch))[0]
        shares.append(hardware.compute(session)["ffb"]["clipping_pct"])

    assert shares[0] == shares[1], f"sign changed the answer: {shares}"


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
