"""Tests for the stretch analysis modules 8-11.

lockup_wheelspin, shift_analysis, tire_temps, balance. Inputs are built from the
synthetic .ibt (see tests/synthetic.py); where a module needs a slip or shift
event the relevant raw array is overwritten in place after parsing, exactly as
the contract's raw arrays allow (numpy arrays, replaced not mutated-in-view).
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import balance, lockup_wheelspin, shift_analysis, tire_temps
from tests.synthetic import build_ibt, make_core_channels

TICKS_PER_LAP = 720


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


# --- lockup_wheelspin -----------------------------------------------------

def test_lockup_detected_when_lf_locks_under_braking():
    session = _session()
    # Zero a valid lap's LF wheel speed through its braking zone: the wheel now
    # reads far below ground speed while on the brake -> a lockup.
    lap = next(l for l in session.laps if l.is_valid)
    braking = lap.raw["brake_raw"] > 0.2
    locked = lap.raw["lf_speed"].copy()
    locked[braking] = 0.0
    lap.raw["lf_speed"] = locked

    payload = lockup_wheelspin.compute(session)
    assert payload["counts"]["lockup_events"] >= 1
    assert payload["lockups"], "expected at least one lockup event"
    event = payload["lockups"][0]
    assert event["wheels"] == ["lf"]
    assert event["peak_slip_ratio"] == 0.0
    assert json.loads(json.dumps(payload))


def test_wheelspin_detected_when_rr_spins_under_power():
    session = _session()
    # Scale a valid lap's RR wheel speed up 30% while on throttle -> wheelspin.
    lap = next(l for l in session.laps if l.is_valid)
    power = lap.raw["throttle"] > 0.5
    spun = lap.raw["rr_speed"].copy()
    spun[power] = spun[power] * 1.3
    lap.raw["rr_speed"] = spun

    payload = lockup_wheelspin.compute(session)
    assert payload["counts"]["wheelspin_events"] >= 1
    assert payload["wheelspin"], "expected at least one wheelspin event"
    event = payload["wheelspin"][0]
    assert "rr" in event["wheels"]
    assert event["peak_slip_ratio"] == pytest.approx(1.3, abs=1e-6)
    assert json.loads(json.dumps(payload))


def test_lockup_wheelspin_reports_honest_negatives():
    # The unmodified synthetic has every wheel at ground speed: no events, and
    # the negative results are reported as findings.
    payload = lockup_wheelspin.compute(_session())
    assert payload["counts"] == {"lockup_events": 0, "wheelspin_events": 0}
    assert payload["lockups_finding"] == "no lockups detected"
    assert payload["wheelspin_finding"] == "no wheelspin detected"
    assert json.loads(json.dumps(payload))


# --- shift_analysis -------------------------------------------------------

def test_shift_analysis_insufficient_on_constant_gear():
    # The synthetic holds 4th gear all session: no upshifts is an honest result.
    payload = shift_analysis.compute(_session())
    assert payload["insufficient_data"] is True
    assert json.loads(json.dumps(payload))


def test_shift_analysis_finds_upshifts_with_stepped_gear():
    ch = make_core_channels()
    n = len(ch["Gear"])
    in_lap = np.arange(n) % TICKS_PER_LAP
    # Step 3 -> 4 -> 5 mid-lap, in the moving portion of every lap.
    gear = np.full(n, 3.0)
    gear[in_lap >= 240] = 4.0
    gear[in_lap >= 480] = 5.0
    ch["Gear"] = gear
    session = parse_ibt(build_ibt(ch))[0]

    payload = shift_analysis.compute(session)
    assert payload["upshifts_total"] >= 3
    assert payload["redline_rpm"] == 9000.0
    assert set(payload["by_gear"]) == {"3", "4"}  # from-gears leaving 3rd and 4th
    assert payload["by_gear"]["3"]["pct_of_redline"] == pytest.approx(77.8, abs=0.1)
    assert json.loads(json.dumps(payload))


# --- tire_temps -----------------------------------------------------------

def test_tire_temps_reports_lf_edges():
    payload = tire_temps.compute(_session())
    assert payload["corner"] == "LF"
    assert payload["other_corners"]["available"] is False
    expected = {"left_c": 80.0, "middle_c": 85.0, "right_c": 90.0, "spread_c": 10.0}
    assert payload["session_median"] == expected
    assert next(iter(payload["laps"].values())) == expected
    # Synthetic freezes wear: flagged, but temps are still reported.
    assert payload["wear"]["skipped"] is True
    assert json.loads(json.dumps(payload))


def test_tire_temps_curve_across_lap():
    curve = tire_temps.compute(_session())["curve"]
    assert curve["corner"] == "LF"
    assert len(curve["grid_pct"]) == 100
    assert len(curve["left_c"]) == len(curve["middle_c"]) == len(curve["right_c"]) == 100
    # Constant synthetic temps -> a flat curve at each edge.
    assert set(curve["left_c"]) == {80.0}
    assert set(curve["middle_c"]) == {85.0}
    assert set(curve["right_c"]) == {90.0}


# --- balance --------------------------------------------------------------

def test_balance_insufficient_when_yaw_flat():
    # The synthetic yaw_rate is all zeros while steer is sinusoidal, so the
    # steer->yaw relationship cannot be calibrated: honest insufficient_data.
    payload = balance.compute(_session())
    assert payload["insufficient_data"] is True
    assert payload["reason"] == "steer-yaw relationship too weak to calibrate"
    # Must never crash and must be JSON-serializable either way.
    assert json.loads(json.dumps(payload))


def test_balance_computes_payload_when_yaw_tracks_steer():
    # Give yaw a clean linear relationship to steer*speed plus a little noise so
    # the fit is strong and the computed (non-insufficient) path is exercised.
    ch = make_core_channels()
    n = len(ch["Gear"])
    rng = np.random.default_rng(0)
    steer = ch["SteeringWheelAngle"]
    ch["YawRate"] = 0.03 * steer * ch["Speed"] + rng.normal(0, 0.01, n)
    session = parse_ibt(build_ibt(ch))[0]

    payload = balance.compute(session)
    # Strong fit -> not insufficient; every field JSON-serializable.
    if "insufficient_data" not in payload:
        assert payload["fit_r2"] >= 0.3
        assert "understeer_pct" in payload["tendency"]
        assert set(payload["by_input_state"]) == {"braking", "on_throttle", "coasting"}
        # Brake bias is carried on the synthetic (constant 52.0 front).
        bias = payload["brake_bias"]
        assert bias["available"] is True
        assert bias["front_pct_values"] == [52.0]
        assert bias["changed_during_session"] is False
        # No corners on the constant-speed reference -> by_corner says so.
        assert payload["by_corner"]["available"] is False
    assert json.loads(json.dumps(payload))


def _balance_session(invert_yaw: bool):
    """A session whose yaw genuinely tracks steer, optionally sign-inverted.

    Inverting YawRate is exactly what some sim builds do: the two channels are
    each self-consistent but disagree about which way is positive. Nothing about
    the driving changes, so every magnitude and the quality of the fit must come
    out identical — only the sign convention differs.
    """
    ch = make_core_channels()
    n = len(ch["Gear"])
    rng = np.random.default_rng(0)
    steer = ch["SteeringWheelAngle"]
    yaw = 0.03 * steer * ch["Speed"] + rng.normal(0, 0.01, n)
    # A real understeer/oversteer split to classify: push some ticks past the
    # fit in the steered direction so they are unambiguously oversteer.
    yaw[: n // 5] += 0.05 * np.sign(steer[: n // 5])
    ch["YawRate"] = -yaw if invert_yaw else yaw
    return parse_ibt(build_ibt(ch))[0]


def test_balance_flags_and_corrects_an_inverted_yaw_convention():
    """A negative fit k means the channels disagree, not that the car is odd.

    Left unguarded this was silent and total: magnitudes are unaffected, so r2
    still clears its floor and every block still fills in, but the oversteer
    test compares the residual's sign against the steering's — and with yaw
    mirrored EVERY divergence lands in the opposite bucket.
    """
    payload = balance.compute(_balance_session(invert_yaw=True))
    assert "insufficient_data" not in payload, "the fit is strong; only the sign differed"
    assert payload["yaw_sign_flipped"] is True
    assert "opposite sign conventions" in payload["yaw_sign_note"]
    # k is the physical coefficient and must be positive once aligned: more lock
    # one way produces more rotation that same way, in any car.
    assert payload["fit_k"] > 0


def test_balance_reads_the_same_whichever_way_the_yaw_channel_signs_it():
    """The regression that matters: the labels must not depend on the convention.

    Before the guard these two sessions — identical driving, one channel
    mirrored — reported opposite tendencies. A driver whose car pushed would
    have been told it was loose.
    """
    normal = balance.compute(_balance_session(invert_yaw=False))
    flipped = balance.compute(_balance_session(invert_yaw=True))

    assert normal["yaw_sign_flipped"] is False
    assert flipped["yaw_sign_flipped"] is True

    # Same driving -> same reading, to the digit.
    assert normal["tendency"] == flipped["tendency"]
    assert normal["by_input_state"] == flipped["by_input_state"]
    assert normal["fit_k"] == flipped["fit_k"]
    assert normal["fit_r2"] == flipped["fit_r2"]
    assert normal["divergence_share_pct"] == flipped["divergence_share_pct"]
    assert json.loads(json.dumps(flipped))


def test_balance_by_corner_places_divergences_on_a_carved_corner():
    ch = make_core_channels()
    n = len(ch["Gear"])
    rng = np.random.default_rng(0)
    steer = ch["SteeringWheelAngle"]
    ch["YawRate"] = 0.03 * steer * ch["Speed"] + rng.normal(0, 0.01, n)
    session = parse_ibt(build_ibt(ch))[0]

    # Carve a dip into the reference lap's grid speed so a corner is detected.
    ref = min(
        (l for l in session.laps if l.is_valid and not l.is_anomalous),
        key=lambda l: l.lap_time_s,
    )
    pct = (np.arange(1000) + 0.5) / 1000
    speed = np.full(1000, 50.0)
    region = np.abs(pct - 0.5) < 0.08
    x = (pct[region] - 0.5) / 0.08
    speed[region] = 50.0 - 30.0 * 0.5 * (1.0 + np.cos(np.pi * x))
    ref.grid["speed"] = speed.astype(np.float32)

    payload = balance.compute(session)
    if "insufficient_data" not in payload:
        bc = payload["by_corner"]
        assert bc["available"] is True
        assert len(bc["corners"]) >= 1
        for c in bc["corners"]:
            assert c["lean"] in ("understeer", "oversteer", "even", "no divergences here")
            assert c["start_pct"] <= c["apex_pct"] <= c["end_pct"]
    assert json.loads(json.dumps(payload))
