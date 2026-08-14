"""Tests for the insight modules 13-16.

grip, input_response, stint, track_width, plus the input-context block that
lockup_wheelspin gained. Inputs are built from the synthetic .ibt (see
tests/synthetic.py); where a module needs an event or a divergence the relevant
raw or grid array is replaced after parsing, exactly as the contract's arrays
allow.
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import grip, input_response, lockup_wheelspin, stint, track_width
from tests.synthetic import build_ibt, make_core_channels

TICKS_PER_LAP = 720


def _session(**kwargs):
    return parse_ibt(build_ibt(make_core_channels(**kwargs)))[0]


# --- grip -----------------------------------------------------------------

def test_grip_measures_horizontal_over_vertical():
    payload = grip.compute(_session())
    session = payload["session"]
    # The synthetic holds VertAccel at 9.8 m/s^2, so mu and combined g coincide.
    assert session["median_vertical_load_g"] == pytest.approx(1.0, abs=0.01)
    assert session["peak_mu"] == pytest.approx(session["peak_combined_g"], abs=0.01)
    assert session["ticks"] > 0
    assert json.loads(json.dumps(payload))


def test_grip_excludes_ticks_with_no_vertical_load():
    session = _session()
    # A car mid-crest unloads: dividing by that is a divide-by-noise, not grip.
    lap = next(l for l in session.laps if l.is_valid)
    vert = lap.raw["vert_accel"].copy()
    vert[:] = 0.5
    lap.raw["vert_accel"] = vert

    laps = {row["lap"] for row in grip.compute(session)["laps"]}
    assert lap.lap_number not in laps


def test_grip_reports_insufficient_rather_than_dividing_by_nothing():
    session = _session()
    for lap in session.laps:
        lap.raw["vert_accel"] = np.zeros_like(lap.raw["vert_accel"])
    payload = grip.compute(session)
    assert payload["insufficient_data"] is True
    assert "vertical" in payload["reason"]
    assert json.loads(json.dumps(payload))


def test_grip_stint_trend_needs_enough_clean_laps():
    # Three valid laps once the out lap, the slow lap and the partial are out.
    payload = grip.compute(_session(n_laps=5))
    assert payload["stint"]["measured"] is False
    assert "clean laps" in payload["stint"]["reason"]


def test_grip_stint_trend_flags_frozen_wear():
    payload = grip.compute(_session(n_laps=12, slow_lap=None, incident_lap=None))
    trend = payload["stint"]
    assert trend["measured"] is True
    # The synthetic's LFwearM is constant, so the parser marks wear masked.
    assert trend["wear_masked"] is True
    assert json.loads(json.dumps(payload))


def test_grip_by_speed_marks_empty_bands_unmeasured():
    bands = grip.compute(_session())["by_speed"]["bands"]
    empty = [b for b in bands if not b["measured"]]
    assert empty, "the synthetic never reaches the top speed bands"
    assert all("too few" in b["reason"] for b in empty)


def _physical_session(*, load_sens: float = 0.13, brake_share: float = 0.04):
    """A session whose vertical load actually moves, and moves for reasons.

    make_core_channels holds VertAccel flat at 9.8, so mu collapses to
    horizontal/1g and every question grip exists to answer is degenerate — which
    is how four measurement bugs lived in this module under a green suite. Here
    the car gains downforce with speed, and the rubber is load sensitive: the
    force it returns per unit of load FALLS as the load rises. Braking is
    deliberately confined to `brake_share` of the lap so the dilution bug has
    something to bite on.
    """
    ch = make_core_channels(n_laps=8, ticks_per_lap=TICKS_PER_LAP, slow_lap=None,
                            incident_lap=None)
    n = len(ch["Speed"])
    dist = ch["LapDistPct"]
    g = 9.81

    # Speed: one long straight and one slow corner per lap.
    v = 25.0 + 45.0 * (0.5 + 0.5 * np.cos(dist * 2 * np.pi))
    v[ch["Speed"] == 0.0] = 0.0
    moving = v > 5.0

    load_g = np.where(moving, 1.0 + 0.55 * (v / 70.0) ** 2, 1.0)
    mu_avail = 1.62 * np.power(np.maximum(load_g, 0.05), -load_sens)

    # Braking sits on the approach to the corner, which is both where a driver
    # actually brakes and where they are committed — a braking zone parked on a
    # coasting straight would test the dilution bug with a force too small to
    # tell apart from the bug.
    brake_start = 0.42 - brake_share
    braking = (dist >= brake_start) & (dist < 0.42)

    # Committed in the corner and under braking, coasting on the straight.
    corner = np.exp(-0.5 * (((dist - 0.5) / 0.10) ** 2))
    commitment = np.clip(0.15 + 0.85 * np.maximum(corner, braking.astype(float)), 0.0, 1.0)
    horizontal_g = mu_avail * load_g * commitment

    lat_g = np.where(braking, 0.0, horizontal_g)
    long_g = np.where(braking, -horizontal_g, 0.0)

    ch["Speed"] = v
    ch["LatAccel"] = lat_g * g
    ch["LongAccel"] = long_g * g
    ch["VertAccel"] = -load_g * g
    ch["BrakeRaw"] = np.where(braking, 0.9, 0.0)
    ch["Brake"] = ch["BrakeRaw"].copy()
    ch["Throttle"] = np.where(braking, 0.0, 0.8)
    return parse_ibt(build_ibt(ch))[0]


def test_grip_peak_braking_is_not_diluted_by_ticks_that_were_not_braking():
    """The bug: percentiles taken over the whole session, zeros included.

    max(-long, 0) is exactly 0 on every tick that was not braking. Taking the
    98th percentile of THAT array measures the share of the lap spent braking,
    not the force reached while braking — and when braking is rarer than 2% of
    ticks the reported peak is exactly 0.0 g for a car that braked hard.
    """
    session = _physical_session(brake_share=0.015)
    block = grip.compute(session)["session"]

    assert block["braking_ticks"] > 0, "the fixture does brake"
    assert block["peak_braking_g"] is not None
    # The fixture brakes at well over 1 g; a diluted percentile reported 0.0.
    assert block["peak_braking_g"] > 0.8, block["peak_braking_g"]
    assert block["peak_braking_g"] != 0.0


def test_grip_reports_null_not_zero_when_a_state_is_too_rare():
    """Missing is not zero — least of all for a force."""
    session = _physical_session(brake_share=0.0)
    block = grip.compute(session)["session"]

    assert block["peak_braking_g"] is None
    assert block["braking_ticks"] == 0
    assert "too few" in block["braking_reason"]


def test_grip_reads_downforce_off_the_load_column_not_the_ratio():
    """Downforce presses the car DOWN; it does not raise the friction ratio.

    The old test for it was `peak_mu` rising with speed, which is the opposite
    of what a load-sensitive tire does under downforce: load rises, force rises,
    and the ratio falls. A winged car was therefore reported as having no
    downforce.
    """
    payload = grip.compute(_physical_session())
    fvs = payload["by_speed"]["fastest_vs_slowest"]

    assert fvs["load_change_g"] > 0.05, "the fixture gains load with speed"
    assert "downforce" in fvs["downforce_note"]
    # The ratio falls while the load rises, and both are stated.
    assert fvs["peak_mu_change"] < 0
    assert "load sensitive" in fvs["mu_note"] or "less force" in fvs["mu_note"]


def test_grip_load_curve_recovers_the_direction_of_load_sensitivity():
    payload = grip.compute(_physical_session(load_sens=0.13))
    by_load = payload["by_load"]

    assert by_load["measured"] is True
    assert len(by_load["bins"]) > 2
    # Rubber that is load sensitive returns less per unit of load as load rises.
    assert by_load["mu_per_g_of_load"] < 0, by_load["mu_per_g_of_load"]
    assert "fell" in by_load["load_sensitivity_note"]


def test_grip_load_slope_is_not_set_by_the_sparsest_bins():
    """The slope is a tick-weighted fit, not first-bin against last-bin.

    The lightest bins are crest and kerb moments where the driver is not asking
    for anything, so they read low on commitment rather than on grip. Comparing
    endpoints let a bin holding a few dozen ticks set the sign of the finding
    against thousands in the populated middle.
    """
    by_load = grip.compute(_physical_session())["by_load"]
    measured = [b for b in by_load["bins"] if b["measured"]]

    endpoint_change = measured[-1]["peak_mu"] - measured[0]["peak_mu"]
    weighted_change = by_load["mu_change_across_load"]

    # Whatever the endpoints happen to say, the reported figure is the fit.
    assert weighted_change == pytest.approx(
        by_load["mu_per_g_of_load"] * (measured[-1]["load_g"] - measured[0]["load_g"]),
        abs=1e-3,
    )
    assert weighted_change < 0
    # And the fit is genuinely doing work rather than echoing the endpoints.
    assert endpoint_change != pytest.approx(weighted_change, abs=1e-6)


def test_grip_counts_the_ticks_it_threw_away():
    """The low-load guard drops exactly the ticks that would read as most grip."""
    payload = grip.compute(_physical_session())
    excluded = payload["ticks_excluded"]

    assert excluded["kept"] == payload["session"]["ticks"]
    assert excluded["stationary_excluded"] > 0, "the out lap starts stationary"
    for key in ("low_load_excluded", "non_finite_excluded"):
        assert isinstance(excluded[key], int)
    assert json.loads(json.dumps(payload))


# --- input_response -------------------------------------------------------

def test_input_response_brake_pedal_against_applied():
    brake = input_response.compute(_session())["brake"]
    assert brake["measured"] is True
    # Synthetic Brake and BrakeRaw agree while moving: nothing was held back.
    assert brake["mean_held_back_pct"] == pytest.approx(0.0, abs=1e-6)
    assert brake["pedal_ceiling_pct"] == pytest.approx(80.0, abs=0.1)
    assert brake["abs"]["finding"] == "the ABS never engaged this session"


def test_input_response_reports_abs_taking_pressure_back():
    channels = make_core_channels()
    braking = channels["BrakeRaw"] > 0.2
    # The ABS comes in and takes a quarter of the pressure back out.
    channels["BrakeABSactive"][braking] = 1.0
    channels["BrakeABScutPct"][braking] = 25.0
    channels["Brake"] = np.where(braking, channels["BrakeRaw"] * 0.75, channels["Brake"])

    brake = input_response.compute(parse_ibt(build_ibt(channels))[0])["brake"]
    assert brake["abs"]["engaged_pct_of_braking"] > 90.0
    assert brake["abs"]["mean_cut_while_engaged_pct"] == pytest.approx(25.0, abs=0.1)
    assert brake["mean_held_back_pct"] > 0


def test_input_response_finds_wheelspin_share_under_power():
    session = _session()
    for lap in session.laps:
        power = lap.raw["throttle"] > 0.5
        spun = lap.raw["rr_speed"].copy()
        spun[power] = spun[power] * 1.2
        lap.raw["rr_speed"] = spun

    slip = input_response.compute(session)["throttle"]["slip"]
    assert slip["share_of_on_power_pct"] > 90.0
    assert slip["peak_excess_pct"] == pytest.approx(20.0, abs=0.5)


def test_input_response_steering_bands_carry_lateral_g():
    steering = input_response.compute(_session())["steering"]
    assert steering["measured"] is True
    measured = [b for b in steering["bands"] if b["measured"]]
    assert measured, "expected at least one populated steering band"
    assert all("peak_lateral_g" in b for b in measured)
    assert steering["peak_steer_deg"] > 0


def test_input_response_findings_are_plain_sentences():
    findings = input_response.compute(_session())["findings"]
    assert findings and all(isinstance(f, str) and f for f in findings)


def test_input_response_payload_is_json_serializable():
    assert json.loads(json.dumps(input_response.compute(_session())))


# --- stint ----------------------------------------------------------------

def test_stint_lists_every_lap_including_excluded_ones():
    payload = stint.compute(_session())
    laps = payload["laps"]
    assert any(row["out_lap"] for row in laps), "the out lap must still appear"
    assert any(row["anomalous"] for row in laps), "the flagged lap must still appear"
    assert payload["clean_lap_count"] < len(laps)


def test_stint_trend_is_refused_on_a_short_run():
    trends = stint.compute(_session(n_laps=5))["trends"]
    assert trends["measured"] is False
    assert "noise" in trends["reason"]


def test_stint_reports_brake_response_falling_over_the_run():
    channels = make_core_channels(n_laps=12, slow_lap=None, incident_lap=None)
    lap = np.arange(len(channels["Speed"])) // 720
    # Same pedal, progressively less deceleration: the drift this module exists
    # to surface. It reports the drift; it never names a cause.
    fade = 1.0 - 0.04 * lap
    channels["LongAccel"] = np.where(channels["Brake"] > 0, -20.0 * fade, 5.0)

    payload = stint.compute(parse_ibt(build_ibt(channels))[0])
    series = payload["trends"]["series"]["decel_per_pedal_g"]
    assert series["measured"] is True
    assert series["change"] < 0
    assert any("less deceleration" in f for f in payload["findings"])


def test_stint_honours_frozen_wear():
    payload = stint.compute(_session())
    assert payload["wear"]["measured"] is False
    assert "froze tire wear" in payload["wear"]["reason"]


def test_stint_fuel_is_read_not_estimated():
    fuel = stint.compute(_session())["fuel"]
    assert fuel["measured"] is True
    assert fuel["total_used_l"] == pytest.approx(20.0, abs=0.2)


def test_stint_payload_is_json_serializable():
    assert json.loads(json.dumps(stint.compute(_session())))


# --- track_width ----------------------------------------------------------

def _spread_laps(session, metres_per_step: float = 2.2):
    """Push each clean lap sideways so the laps no longer share one line."""
    for i, lap in enumerate(l for l in session.laps if l.is_valid):
        lap.grid["lat_gps"] = lap.grid["lat_gps"] + (i - 1) * (metres_per_step / 111320.0)
    return session


def test_track_width_is_zero_when_every_lap_took_the_same_line():
    payload = track_width.compute(_session())
    assert payload["summary"]["median_used_width_m"] == pytest.approx(0.0, abs=1e-6)
    assert len(payload["centre_x_m"]) == len(payload["left_m"])


def test_track_width_opens_up_when_laps_run_wide_of_each_other():
    payload = track_width.compute(_spread_laps(_session()))
    assert payload["summary"]["median_used_width_m"] > 1.0
    # Left is the positive side of the reference lap's direction of travel.
    assert max(payload["left_m"]) >= 0
    assert min(payload["right_m"]) <= 0


def test_track_width_needs_two_laps():
    payload = track_width.compute(_session(n_laps=3))
    assert payload["insufficient_data"] is True
    assert "at least" in payload["reason"]


def test_track_width_carries_the_frame_needed_to_plot_any_lap():
    payload = track_width.compute(_spread_laps(_session()))
    assert set(payload["origin"]) == {"lat", "lon"}
    assert len(payload["normal_x"]) == len(payload["centre_x_m"])
    assert json.loads(json.dumps(payload))


def test_track_width_says_it_is_not_the_track():
    caveat = track_width.compute(_session())["caveat"]
    assert "not the track's width" in caveat


# --- lockup_wheelspin input context ---------------------------------------

def _locked_session():
    session = _session()
    lap = next(l for l in session.laps if l.is_valid)
    braking = lap.raw["brake_raw"] > 0.2
    locked = lap.raw["lf_speed"].copy()
    locked[braking] = 0.0
    lap.raw["lf_speed"] = locked
    return session


def test_lockup_event_carries_the_inputs_at_its_onset():
    event = lockup_wheelspin.compute(_locked_session())["lockups"][0]
    inputs = event["inputs"]
    assert inputs["brake_pedal_pct"] == pytest.approx(80.0, abs=0.1)
    assert inputs["gear"] == 4
    assert inputs["speed_kmh"] > 0
    assert inputs["pedal"] == "brake_raw"
    assert "combined_g" in inputs


def test_wheelspin_event_context_watches_the_throttle_pedal():
    session = _session()
    lap = next(l for l in session.laps if l.is_valid)
    power = lap.raw["throttle"] > 0.5
    spun = lap.raw["rr_speed"].copy()
    spun[power] = spun[power] * 1.3
    lap.raw["rr_speed"] = spun

    event = lockup_wheelspin.compute(session)["wheelspin"][0]
    assert event["inputs"]["pedal"] == "throttle"
    assert event["inputs"]["throttle_pct"] == pytest.approx(100.0, abs=0.1)


def test_lockup_common_ground_summarises_the_pattern():
    common = lockup_wheelspin.compute(_locked_session())["common_ground"]["lockups"]
    assert common["measured"] is True
    assert common["most_affected_wheel"] == "lf"
    assert common["most_common_gear"] == 4
    assert "describe when the slip happened, not why" in common["note"]


def test_common_ground_is_honest_when_nothing_happened():
    common = lockup_wheelspin.compute(_session())["common_ground"]
    assert common["lockups"]["measured"] is False
    assert common["wheelspin"]["measured"] is False


def test_lockup_payload_with_context_is_json_serializable():
    assert json.loads(json.dumps(lockup_wheelspin.compute(_locked_session())))
