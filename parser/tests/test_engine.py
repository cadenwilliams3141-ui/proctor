"""The coaching engine against laps with known, planted truths.

Every session here is driven by tests/synthetic_track.py: a closed circuit,
a solved speed profile, every channel derived from the same motion. What was
planted is known exactly, so each module is asked to give it back.
"""

import json

import numpy as np
import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import compute_all
from proctor_parser.analysis._engine import engine
from proctor_parser.analysis import coach as coach_mod
from proctor_parser.analysis import corner_laps as corner_laps_mod
from proctor_parser.analysis import segments as segments_mod
from proctor_parser.analysis import watch as watch_mod
from proctor_parser.phases import HELD_UP, OFF_TRACK, TOW
from tests.synthetic import build_ibt, make_core_channels
from tests.synthetic_track import DEFAULT_LAYOUT, Knob, drive_session


def _parse(ds):
    return parse_ibt(ds.ibt())[0]


def _track_m(corner, u, length):
    return (corner["seg_start_m"] + u) % length


def _ring(a, b, length):
    d = abs(a - b) % length
    return min(d, length - d)


@pytest.fixture(scope="module")
def clean():
    ds = drive_session(n_laps=10, seed=3, noise=0.3)
    return ds, _parse(ds)


@pytest.fixture(scope="module")
def planted():
    knobs = {
        2: {1: Knob(lockup=True), 4: Knob(slide=True)},
        3: {2: Knob(pump=True), 5: Knob(hesitate=True)},
        4: {4: Knob(cut_m=20), 3: Knob(kerb=True)},
        5: {2: Knob(tow=0.15)},
        6: {4: Knob(held_up=True)},
        7: {2: Knob(coast_m=40), 4: Knob(pickup_m=30)},
    }
    ds = drive_session(n_laps=10, knobs=knobs, seed=7)
    return ds, _parse(ds)


# ── timing and the track model ───────────────────────────────────────────────

def test_exact_lap_times_match_the_driven_truth_to_a_millisecond(clean):
    ds, s = clean
    for lap in s.laps:
        if lap.lap_time_exact_s is None:
            continue
        assert abs(lap.lap_time_exact_s - ds.lap_times[lap.lap_number]) < 1e-3
        # The tick-count time is coarser, and stays what it always was.
        assert lap.lap_time_s == round(lap.lap_time_s * 60) / 60


def test_corners_kinks_and_the_chicane_are_found(clean):
    ds, s = clean
    seg = segments_mod.compute(s)
    L = seg["length_m"]
    assert seg["length_source"] == "LapDist"
    truth = ds.track.corners
    assert len(seg["corners"]) == len(truth)
    for c, t in zip(seg["corners"], truth):
        assert _ring(c["apex_m"], t.apex_m, L) < 15.0, (c, t)
        assert c["dir"] == t.direction
        if c["radius_m"] is not None and not c["complex"]:
            assert abs(c["radius_m"] - t.radius_m) / t.radius_m < 0.15
    chicane = next(c for c in seg["corners"] if c["id"] == 3)
    assert chicane["complex"] and len(chicane["sub_apexes"]) == 2
    assert {sa["dir"] for sa in chicane["sub_apexes"]} == {"left", "right"}
    # The flat 12-degree kink is a kink, not a corner.
    assert len(seg["kinks"]) == 1 and abs(seg["kinks"][0]["at_m"] - 1824) < 60
    assert "official" in seg["numbering"]


def test_segments_partition_the_lap_and_reconcile(clean):
    _, s = clean
    seg = segments_mod.compute(s)
    L = seg["length_m"]
    cs = seg["corners"]
    for a, b in zip(cs, cs[1:] + cs[:1]):
        assert abs(a["seg_end_m"] % L - b["seg_start_m"]) < 0.2
    assert abs(sum(c["seg_end_m"] - c["seg_start_m"] for c in cs) - L) < 0.5
    assert seg["reconciliation"]["max_abs_residual_ms"] < 1e-3
    assert seg["timing"]["sim_agrees"] is True
    json.dumps(seg)


def test_a_corner_across_the_start_finish_line_is_found():
    layout = list(DEFAULT_LAYOUT)
    t5 = layout[13]
    half = ("A", t5[1], t5[2] / 2, 5)
    rotated = [half] + layout[14:] + layout[:13] + [half]
    ds = drive_session(n_laps=8, seed=4, noise=0.3, layout=tuple(rotated))
    seg = segments_mod.compute(_parse(ds))
    L = seg["length_m"]
    apexes = [c["apex_m"] for c in seg["corners"]]
    assert len(apexes) == 5
    assert min(_ring(a, 0.0, L) for a in apexes) < 40.0
    assert any(c["wraps"] for c in seg["corners"])


def test_constant_speed_has_no_corners_and_says_so():
    s = parse_ibt(build_ibt(make_core_channels()))[0]
    for mod in (segments_mod, corner_laps_mod, watch_mod, coach_mod):
        out = mod.compute(s)
        assert out.get("insufficient_data") is True and out["reason"], mod.METRIC_KEY
        json.dumps(out)


# ── per-pass metrics ─────────────────────────────────────────────────────────

def test_brake_points_and_minimum_speeds_are_recovered(clean):
    ds, s = clean
    seg = segments_mod.compute(s)
    cl = corner_laps_mod.compute(s)
    L = seg["length_m"]
    for c, block in zip(seg["corners"], cl["corners"]):
        runs = block["runs"]
        for lap, bo, vmin in zip(runs["lap"], runs["m"]["brake_on"], runs["m"]["v_min"]):
            truth = ds.truth["laps"][lap][c["id"]]
            if truth["brake_on_m"] is not None and bo is not None:
                assert _ring(_track_m(c, bo, L), truth["brake_on_m"], L) < 2.0, (c["id"], lap)
            assert abs(vmin - truth["vmin"]) < 0.5 / 3.6 + 0.05, (c["id"], lap)


def test_late_throttle_moves_the_full_throttle_point(planted):
    _, s = planted
    cl = corner_laps_mod.compute(s)
    t4 = next(b for b in cl["corners"] if b["id"] == 4)["runs"]
    full = dict(zip(t4["lap"], t4["m"]["full"]))
    others = [v for lap, v in full.items() if lap != 7 and v is not None]
    assert full[7] - np.median(others) > 25.0


def test_flags_land_on_the_planted_passes_and_nowhere_else(planted, clean):
    _, s = planted
    _, runs = engine(s)
    flagged = {(r.corner, r.lap): r.flags for rs in runs.values() for r in rs if r.flags}
    assert flagged.get((4, 4), 0) & OFF_TRACK
    # The tow is on the straight BEFORE T2, which belongs to T1's segment.
    assert flagged.get((1, 5), 0) & TOW
    assert flagged.get((3, 6), 0) & HELD_UP
    # Picking the throttle up late is the driver's own doing, never "traffic".
    assert not flagged.get((4, 7), 0) & HELD_UP
    assert set(flagged) == {(4, 4), (1, 5), (3, 6)}
    _, s_clean = clean
    _, runs_clean = engine(s_clean)
    assert not any(r.flags for rs in runs_clean.values() for r in rs)


# ── the watcher ──────────────────────────────────────────────────────────────

def test_every_planted_event_is_watched_at_the_right_corner(planted):
    ds, s = planted
    w = watch_mod.compute(s)
    seen = {(e[4], e[0], e[2]) for e in w["events"]}
    expect = {
        ("lockup", 2, 1), ("oversteer", 2, 4), ("brake_pumping", 3, 2),
        ("throttle_hesitation", 3, 5), ("off_track", 4, 4), ("kerb_strike", 4, 3),
        ("tow", 5, 1), ("possible_traffic", 6, 3), ("coasting", 7, 2),
    }
    assert expect <= seen, expect - seen
    assert seen <= expect, seen - expect
    phases = {(e[4], e[2]): e[3] for e in w["events"]}
    assert phases[("lockup", 1)] == "braking"
    assert phases[("coasting", 2)] == "approach"
    json.dumps(w)


def test_a_clean_session_reports_none_observed_not_zero(clean):
    _, s = clean
    w = watch_mod.compute(s)
    assert w["events"] == [] and w["counts"] == {}
    assert "lockup" in w["none_observed"] and "off_track" in w["none_observed"]


def test_a_missing_channel_is_not_checkable_rather_than_none_observed():
    ds = drive_session(n_laps=8, seed=2, noise=0.3)
    for key in ("PlayerTrackSurface", "PlayerTrackSurfaceMaterial"):
        ds.channels.pop(key)
    w = watch_mod.compute(_parse(ds))
    assert "off_track" in w["unavailable"] and "kerb_strike" in w["unavailable"]
    assert "off_track" not in w["none_observed"]


# ── the coach ────────────────────────────────────────────────────────────────

def _effect_session(seed):
    rng = np.random.default_rng(seed)
    knobs = {lap: {4: Knob(decel=float(rng.uniform(-2.5, 3.5))),
                   2: Knob(pickup_m=float(rng.choice([0, 0, 25, 40])))}
             for lap in range(1, 17)}
    knobs[9][4] = Knob(decel=6.0, cut_m=25)    # fastest through T4 — by cutting it
    knobs[11][1] = Knob(tow=0.15)              # fastest down T1's straight — in a tow
    return drive_session(n_laps=16, knobs=knobs, seed=seed, noise=0.15, thrust_noise=0.01)


@pytest.fixture(scope="module")
def effect():
    ds = _effect_session(5)
    return ds, _parse(ds)


def test_the_coach_recovers_the_planted_effects(effect):
    _, s = effect
    out = coach_mod.compute(s)
    by_corner = {a["corner"]: a for a in out["actions"]}
    assert set(by_corner) == {2, 4}
    t4 = by_corner[4]
    assert t4["metric"] in ("brake_on", "brake_peak")
    named = {t4["metric"]} | {c["metric"] for c in t4["comes_with"]}
    assert {"brake_on", "brake_peak"} <= named
    assert t4["confidence"] == "strong"
    t2 = by_corner[2]
    assert t2["metric"] in ("full", "pickup") and t2["direction"] == "earlier"
    for a in out["actions"]:
        lo, hi = a["range"]
        assert lo - 1e-6 <= a["target"] <= hi + 1e-6
        corner = next(c for c in out["corners"] if c["id"] == a["corner"])
        assert 0 < a["gain_s"] <= corner["opportunity_s"] + 1e-9
        ev = a["evidence"]
        assert ev["n"] >= 6 and ev["q"] <= 0.10 and ev["target_laps"]
    json.dumps(out)


def test_a_shortcut_or_a_tow_is_never_the_target(effect):
    _, s = effect
    out = coach_mod.compute(s)
    corners = {c["id"]: c for c in out["corners"]}
    assert 9 not in corners[4]["target_laps"]
    assert corners[4]["excluded"].get("off_track") == 1
    assert 11 not in corners[1].get("target_laps", [])
    for a in out["actions"]:
        assert 9 not in a["evidence"]["target_laps"] or a["corner"] != 4


def test_noise_alone_produces_no_advice():
    """Lap time varies by about a second here and no input explains it.
    The coach must say nothing rather than invent a cause."""
    hits = 0
    for seed in range(8):
        ds = drive_session(n_laps=14, seed=100 + seed, noise=0.15, thrust_noise=0.02)
        out = coach_mod.compute(_parse(ds))
        hits += bool(out["actions"])
        if not out["actions"]:
            assert out["no_action_reason"]
    assert hits == 0


def test_an_entry_speed_change_is_not_read_as_a_brake_point_change():
    """Only T3's exit varies. T4 is then entered faster or slower and braked
    for earlier or later — at the same deceleration. That is not technique."""
    rng = np.random.default_rng(1)
    knobs = {lap: {3: Knob(vmin=float(rng.uniform(-2.0, 2.0)))} for lap in range(1, 15)}
    ds = drive_session(n_laps=14, knobs=knobs, seed=1, noise=0.1)
    out = coach_mod.compute(_parse(ds))
    assert not any(a["corner"] == 4 and a["metric"] == "brake_on" for a in out["actions"])
    assert any(a["corner"] == 3 and a["metric"] == "v_min" for a in out["actions"])


def test_too_few_passes_is_insufficient_not_a_guess():
    ds = drive_session(n_laps=4, seed=8, noise=0.5)
    out = coach_mod.compute(_parse(ds))
    assert out["actions"] == []
    assert all(c["status"] == "insufficient" for c in out["corners"])
    assert all("need at least" in c["reason"] for c in out["corners"])


def test_the_coach_is_deterministic(effect):
    ds, _ = effect
    a = coach_mod.compute(_parse(ds))
    b = coach_mod.compute(_parse(ds))
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_every_module_runs_on_the_driven_session_and_stays_compact(effect):
    _, s = effect
    m = compute_all(s)
    assert not {k: v for k, v in m.items() if "error" in v}
    sizes = {k: len(json.dumps(m[k])) for k in ("segments", "corner_laps", "watch", "coach")}
    assert sizes["coach"] < 20_000 and sizes["watch"] < 40_000
    assert sizes["corner_laps"] < 80_000 and sizes["segments"] < 20_000


def test_traffic_that_straddles_a_segment_boundary_is_still_caught():
    """Held up just before T3's braking zone: the lift starts in T2's segment
    and ends in T3's. Judged per segment, neither half was flat on both sides,
    and the pass counted as normal driving. Both passes must be left out."""
    knobs = {lap: {} for lap in range(1, 13)}
    knobs[6][3] = Knob(held_up=True)
    ds = drive_session(n_laps=12, knobs=knobs, seed=5, noise=0.4)
    _, runs = engine(_parse(ds))
    flagged = {(r.corner, r.lap) for rs in runs.values() for r in rs if r.flags & HELD_UP}
    assert {(2, 6), (3, 6)} <= flagged
    assert {lap for _, lap in flagged} == {6}
