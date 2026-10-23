"""Tests for trail_braking (module 19).

The synthetic laps here carry one corner whose entry is planted with known
ground truth: where the brake comes off relative to turn-in, how quick the
entry is, whether the pedal re-stabs. Distance advances with speed, so a lap
that carries less speed through the corner genuinely spends more ticks
getting to the apex -- the only way entry time can differ between laps.
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import trail_braking
from tests.synthetic import build_ibt, make_core_channels

T = 1200          # ticks per lap
G = 9.81


def _lap_profile(trail: bool, min_speed: float, restab: bool = False, brake: bool = True):
    """Per-tick channels for one lap with a single corner around the half-way mark."""
    u = np.arange(T) / T
    # Speed dips around tick T/2; distance is integrated from it below.
    dip = np.clip(1 - np.abs(u - 0.5) / 0.09, 0, 1)
    speed = 50.0 - (50.0 - min_speed) * (0.5 - 0.5 * np.cos(np.pi * dip))
    dist = np.concatenate(([0.0], np.cumsum(speed)[:-1]))
    dist = dist / (dist[-1] + speed[-1]) * (T - 1) / T

    # Everything else is laid out against DISTANCE, so it lands in the same
    # place on the track whatever the speed did.
    brake_raw = np.zeros(T)
    if brake:
        hard = (dist >= 0.40) & (dist < 0.44)
        brake_raw[hard] = 0.8
        off = 0.49 if trail else 0.44   # turn-in sits near 0.463
        rel = (dist >= 0.44) & (dist < off)
        brake_raw[rel] = 0.8 * (1 - (dist[rel] - 0.44) / (off - 0.44))
        if restab:
            bump = (dist >= 0.455) & (dist < 0.46)
            brake_raw[bump] += 0.15
    lat = np.interp(dist, [0.0, 0.45, 0.50, 0.55, 0.60, 1.0], [0, 0, 1.5, 1.5, 0, 0]) * G
    throttle = np.where(dist >= 0.52, 1.0, np.where(dist < 0.40, 1.0, 0.0))
    throttle[brake_raw > 0] = 0.0
    long_acc = np.where(brake_raw > 0, -1.4 * G * brake_raw / 0.8, 0.2 * G * throttle)
    vert = np.interp(speed, [20.0, 50.0], [-1.2 * G, -1.8 * G])  # load rises with speed
    return {
        "LapDistPct": dist, "Speed": speed, "BrakeRaw": brake_raw, "Brake": brake_raw.copy(),
        "Throttle": throttle, "LatAccel": lat, "LongAccel": long_acc, "VertAccel": vert,
    }


def _session(laps: list[dict]):
    """Out lap + `laps` + a partial closing lap, each lap built from its spec."""
    specs = [laps[0]] + laps + [laps[0]]
    ch = make_core_channels(n_laps=len(specs), ticks_per_lap=T, slow_lap=None, incident_lap=None)
    for i, spec in enumerate(specs):
        sl = slice(i * T, (i + 1) * T)
        for name, values in _lap_profile(**spec).items():
            ch[name][sl] = values
    # The out lap still starts stationary, as a real one does.
    ch["Speed"][:10] = 0.0
    return parse_ibt(build_ibt(ch))[0]


def _corner(payload):
    assert payload.get("insufficient_data") is not True, payload.get("reason")
    assert len(payload["corners"]) == 1
    return payload["corners"][0]


def test_trail_braked_entry_reads_brake_at_turn_in_and_a_positive_trail():
    c = _corner(trail_braking.compute(_session([dict(trail=True, min_speed=24.0)] * 3)))
    assert c["measured"] is True
    m = c["median"]
    assert m["trail_s"] > 0, "brake came off after turn-in"
    assert m["brake_at_turn_in_pct"] > 20.0
    assert c["released_before_turn_in_laps"] == 0


def test_straight_line_braking_reads_negative_trail_and_a_deeper_dip():
    trailed = _corner(trail_braking.compute(_session([dict(trail=True, min_speed=24.0)] * 3)))
    straight = _corner(trail_braking.compute(_session([dict(trail=False, min_speed=24.0)] * 3)))
    assert straight["median"]["trail_s"] < 0, "brake was off before turn-in"
    assert straight["median"]["brake_at_turn_in_pct"] == pytest.approx(0.0, abs=0.5)
    assert straight["median"]["coast_s"] > trailed["median"]["coast_s"]
    # Nothing on the car between braking and cornering: less of the envelope used.
    assert straight["median"]["transition_min_pct"] < trailed["median"]["transition_min_pct"]


def test_best_entry_is_the_quickest_lap_and_reports_its_gain():
    laps = [
        dict(trail=False, min_speed=22.0),
        dict(trail=True, min_speed=27.0),   # quickest to the apex
        dict(trail=False, min_speed=23.0),
    ]
    s = _session(laps)
    c = _corner(trail_braking.compute(s))
    clean = [l.lap_number for l in s.laps if l.is_valid and not l.is_out_lap]
    assert c["best_entry"]["lap"] == clean[1]
    assert c["best_entry"]["trail_s"] > 0
    assert c["best_entry"]["gain_vs_median_s"] > 0


def test_link_needs_five_laps_and_finds_one_when_it_is_there():
    few = _corner(trail_braking.compute(_session([dict(trail=True, min_speed=24.0)] * 3)))
    assert few["trail_vs_entry"]["measured"] is False
    assert "at least 5" in few["trail_vs_entry"]["reason"]

    # Longer trails planted on the quicker laps.
    laps = [dict(trail=t, min_speed=v) for t, v in [
        (False, 21.0), (True, 27.0), (False, 22.0), (True, 26.0), (False, 21.5), (True, 27.5),
    ]]
    c = _corner(trail_braking.compute(_session(laps)))
    link = c["trail_vs_entry"]
    assert link["measured"] is True and link["laps"] == 6
    assert link["link"] == "longer_trail_faster"
    assert link["rho"] <= -0.5


def test_no_link_is_a_reported_negative_result():
    laps = [dict(trail=True, min_speed=24.0)] * 6
    link = _corner(trail_braking.compute(_session(laps)))["trail_vs_entry"]
    assert link["measured"] is True
    assert link["link"] == "none"


def test_restab_is_counted():
    c = _corner(trail_braking.compute(_session([dict(trail=True, min_speed=24.0, restab=True)] * 3)))
    assert c["median"]["restabs"] >= 1


def test_a_corner_taken_without_braking_says_so():
    c = _corner(trail_braking.compute(_session([dict(trail=True, min_speed=40.0, brake=False)] * 3)))
    assert c["measured"] is False
    assert c["reason"] == "taken without braking on every clean lap"


def test_context_reads_grade_and_load_and_states_the_brake_temp_wall():
    payload = trail_braking.compute(_session([dict(trail=True, min_speed=24.0)] * 3))
    ctx = _corner(payload)["context"]
    assert ctx["grade_pct"] is not None
    # Load falls as speed falls through the zone (planted: rises with speed).
    assert ctx["load_drop_g"] > 0
    assert ctx["lf_temp_middle_c"] == pytest.approx(85.0)
    assert payload["brake_temperature"]["available"] is False


def test_missing_altitude_leaves_grade_unmeasured_not_zero():
    s = _session([dict(trail=True, min_speed=24.0)] * 3)
    for lap in s.laps:
        del lap.raw["alt"]
    ctx = _corner(trail_braking.compute(s))["context"]
    assert ctx["grade_pct"] is None


def test_flat_synthetic_has_no_corners_and_says_why():
    payload = trail_braking.compute(parse_ibt(build_ibt(make_core_channels()))[0])
    assert payload["insufficient_data"] is True
    assert "no corners" in payload["reason"]
    assert payload["brake_temperature"]["available"] is False


def test_payload_is_json_serializable():
    payload = trail_braking.compute(_session([dict(trail=True, min_speed=24.0)] * 5))
    assert json.loads(json.dumps(payload))["basis"]
    assert payload["summary"]["corners_measured"] == 1
    assert payload["thresholds"]["turn_in_pct_of_peak_lat"] == 30.0
