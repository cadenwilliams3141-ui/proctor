"""Tests for contact_patch (module 18) and hardware's steer_torque block.

The synthetic fixture plants known ground truth for every quantity this module
claims to measure — a lateral velocity component that is exactly 2% of forward
speed, a column torque that FALLS past a known lock threshold, and a sinusoidal
elevation profile — so these tests check recovery of a known answer rather than
merely that a number came out.
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import contact_patch, hardware, input_response
from tests.synthetic import build_ibt, make_core_channels

GRID_N = 1000


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


def _dip_profile(depth_min=20.0, base=50.0, center=0.5, half=0.08):
    """Constant `base` m/s with one smooth cosine dip, so a corner is detected."""
    pct = (np.arange(GRID_N) + 0.5) / GRID_N
    speed = np.full(GRID_N, base)
    region = np.abs(pct - center) < half
    x = (pct[region] - center) / half
    bump = 0.5 * (1.0 + np.cos(np.pi * x))
    speed[region] = base - (base - depth_min) * bump
    return speed.astype(np.float32)


# --- slip angle -------------------------------------------------------------

def test_slip_angle_recovers_the_planted_value():
    """vel_y is 2% of vel_x at its peak, so |beta| peaks at atan(0.02)."""
    slip = contact_patch.compute(_session())["slip"]
    assert slip["measured"] is True
    expected = np.degrees(np.arctan(0.02))
    assert slip["peak_deg"] == pytest.approx(expected, abs=0.02)
    assert slip["highest_single_tick_deg"] == pytest.approx(expected, abs=0.02)
    assert 0 < slip["median_deg"] < slip["peak_deg"]


def test_slip_angle_is_a_measurement_not_a_fit():
    """Doubling the lateral velocity doubles the angle — nothing is calibrated."""
    channels = make_core_channels()
    channels["VelocityY"] = channels["VelocityY"] * 2.0
    session = parse_ibt(build_ibt(channels))[0]
    slip = contact_patch.compute(session)["slip"]
    assert slip["peak_deg"] == pytest.approx(np.degrees(np.arctan(0.04)), abs=0.02)


def test_slip_reports_unmeasured_below_the_speed_floor():
    """Under the floor the lateral component is noise, so it declines to answer."""
    session = _session()
    for lap in session.laps:
        lap.raw["speed"] = np.full_like(lap.raw["speed"], 6.0)
    slip = contact_patch.compute(session)["slip"]
    assert slip["measured"] is False
    assert "m/s" in slip["reason"]


# --- rotation against the path ---------------------------------------------

def test_rotation_reports_agreement_only_when_both_channels_vary():
    """The fixture's YawRate is flat, so the correlation is honestly null."""
    rotation = contact_patch.compute(_session())["rotation"]
    assert rotation["measured"] is True
    assert rotation["path_agreement"] is None

    session = _session()
    for lap in session.laps:
        n = len(lap.raw["yaw_rate"])
        lap.raw["yaw_rate"] = (
            lap.raw["lat_accel"].astype(np.float64) / np.maximum(lap.raw["speed"], 1.0)
        ).astype(np.float32)
        assert n == len(lap.raw["yaw_rate"])
    matched = contact_patch.compute(session)["rotation"]
    assert matched["path_agreement"] == pytest.approx(1.0, abs=0.01)
    assert matched["median_abs_difference_rad_s"] == pytest.approx(0.0, abs=1e-3)


# --- self-aligning torque ---------------------------------------------------

def test_torque_falloff_past_peak_is_found_with_its_size():
    """The fixture drops torque 10 Nm -> 3 Nm past 0.35 rad of lock."""
    block = contact_patch.compute(_session())["steer_torque"]
    assert block["measured"] is True
    assert block["most_torque_band"] == "0-20°"
    assert block["falloff_past_peak_nm"] == pytest.approx(7.0, abs=0.01)
    assert "LESS" in block["falloff_note"]


def test_torque_bands_match_input_response_bands():
    """The two panels are read against each other, so the edges must agree."""
    assert contact_patch._STEER_BINS_DEG == input_response._STEER_BINS_DEG
    labels = [b["band"] for b in contact_patch.compute(_session())["steer_torque"]["bands"]]
    assert labels[0] == "0-20°"
    assert labels[-1] == "150°+"


def test_torque_band_without_enough_ticks_says_so_rather_than_zero():
    bands = contact_patch.compute(_session())["steer_torque"]["bands"]
    empty = [b for b in bands if b["ticks"] == 0]
    assert empty, "the fixture never reaches full lock, so some bands are empty"
    for band in empty:
        assert band["measured"] is False
        assert "reason" in band
        assert "median_torque_nm" not in band


# --- road grade -------------------------------------------------------------

def test_grade_recovers_the_planted_hill():
    """10 m of sine over a 4 km lap peaks at 10*2pi/4000 = 1.57%."""
    grade = contact_patch.compute(_session())["grade"]
    assert grade["measured"] is True
    expected_pct = 10.0 * 2 * np.pi / 4000.0 * 100.0
    assert grade["steepest_climb_pct"] == pytest.approx(expected_pct, rel=0.05)
    assert grade["steepest_descent_pct"] == pytest.approx(-expected_pct, rel=0.05)


def test_grade_reports_braking_both_ways_never_replacing_one_with_the_other():
    braking = contact_patch.compute(_session())["grade"]["braking"]
    assert braking["measured"] is True
    assert "peak_decel_g_uncorrected" in braking
    assert "peak_decel_g_grade_corrected" in braking
    assert braking["difference_g"] == pytest.approx(
        braking["peak_decel_g_grade_corrected"] - braking["peak_decel_g_uncorrected"],
        abs=0.002,
    )


# --- corners ----------------------------------------------------------------

def test_corners_measure_slip_when_a_corner_exists():
    session = _session()
    ref = min(
        (l for l in session.laps if l.is_valid and not l.is_anomalous),
        key=lambda l: l.lap_time_s,
    )
    ref.grid["speed"] = _dip_profile()

    corners = contact_patch.compute(session)["corners"]
    assert corners["measured"] is True
    assert corners["reference_lap"] == ref.lap_number
    measured = [c for c in corners["corners"] if c["measured"]]
    assert measured
    for corner in measured:
        assert corner["start_pct"] < corner["apex_pct"] < corner["end_pct"]
        assert corner["peak_slip_deg"] > 0
        assert corner["laps_pooled"] >= 1
    assert corners["most_slip"]["peak_slip_deg"] >= corners["least_slip"]["peak_slip_deg"]


def test_corners_say_why_when_none_are_detected():
    """Constant speed means no corner. That is an answer, not an empty list."""
    corners = contact_patch.compute(_session())["corners"]
    assert corners["measured"] is False
    assert corners["reason"] == "no corners were detected on the reference lap"


# --- the data wall ----------------------------------------------------------

def test_per_tire_load_is_reported_as_a_wall_not_computed():
    """Splitting force between four tyres needs car geometry. Never guessed."""
    block = contact_patch.compute(_session())["per_tire_load"]
    assert block["available"] is False
    assert "wheelbase" in block["reason"]
    assert not any(k.endswith("_kg") for k in block)


# --- contract compliance ----------------------------------------------------

def test_payload_is_json_serialisable():
    json.dumps(contact_patch.compute(_session()))


def test_no_valid_laps_returns_an_honest_payload():
    session = _session()
    for lap in session.laps:
        lap.is_valid = False
    payload = contact_patch.compute(session)
    assert payload["insufficient_data"] is True
    assert payload["reason"]
    assert payload["basis"]


def test_missing_channel_degrades_rather_than_crashing():
    session = _session()
    for lap in session.laps:
        del lap.raw["steer_torque"]
    payload = contact_patch.compute(session)
    assert payload["insufficient_data"] is True
    json.dumps(payload)


# --- hardware's new block ---------------------------------------------------

def test_hardware_reports_column_torque_in_newton_metres():
    block = hardware.compute(_session())["steer_torque"]
    assert block["available"] is True
    assert block["peak_nm"] == pytest.approx(10.0, abs=0.01)
    assert block["median_nm"] == pytest.approx(3.0, abs=0.01)
    assert 0.0 <= block["at_own_max_pct"] <= 100.0


def test_hardware_keeps_every_existing_block():
    """The golden numbers live in these keys; the new block must not disturb them."""
    payload = hardware.compute(_session())
    for key in (
        "basis", "brake_vs_raw", "abs", "brake_bias",
        "pedal_noise_floor", "ffb", "areas_of_concern", "caveat",
    ):
        assert key in payload
    assert payload["brake_vs_raw"]["ceiling_note"] == "your own max this session, not a hardware limit"


def test_hardware_torque_absent_is_absent_not_zero():
    session = _session()
    for lap in session.laps:
        del lap.raw["steer_torque"]
    block = hardware.compute(session)["steer_torque"]
    assert block["available"] is False
    assert "reason" in block
    assert "peak_nm" not in block
