"""The regression tripwire from CLAUDE.md, asserted rather than remembered.

CLAUDE.md lists four known-good Long Beach readings. Until this file, nothing in
the suite checked any of them: test_golden.py checks the file header only. So a
change could move every one of them and stay green everywhere, including on the
rig that has the file.

These skip without the .ibt (it is 60-136 MB and lives in OneDrive on the rig),
so CI cannot prove them. Run the suite on the rig after any parser or module
change.

A file can hold more than one SessionNum run. The known-good values were read
off the session the app showed, which is not recorded anywhere, so each value is
required of SOME session in the file. That still trips the moment a change moves
the number in every session, which is the regression worth catching.
"""

import pytest

from proctor_parser import parse_ibt
from proctor_parser.analysis import compute_all
from tests.test_golden import find_fixture

LONG_BEACH = "porsche718gt4_longbeach 2026-01-26 13-42-30.ibt"


@pytest.fixture(scope="module")
def long_beach_metrics():
    path = find_fixture(LONG_BEACH)
    if path is None:
        pytest.skip(f"golden fixture '{LONG_BEACH}' not present on this machine")
    sessions = parse_ibt(path.read_bytes())
    return [compute_all(s) for s in sessions]


def _any(metrics: list[dict], pick) -> list:
    out = []
    for m in metrics:
        try:
            out.append(pick(m))
        except (KeyError, TypeError):
            continue
    return out


def test_brake_ceiling_is_89_8(long_beach_metrics):
    seen = _any(long_beach_metrics, lambda m: m["hardware"]["brake_vs_raw"]["brake_ceiling_pct"])
    assert 89.8 in seen, seen


def test_pedal_noise_spikes_are_69(long_beach_metrics):
    seen = _any(long_beach_metrics, lambda m: m["hardware"]["pedal_noise_floor"]["spike_ticks"])
    assert 69 in seen, seen


def test_left_foot_braking_median_minus_50ms_77pct(long_beach_metrics):
    seen = _any(
        long_beach_metrics,
        lambda m: (
            m["report_card"]["driving_style"]["median_release_to_brake_ms"],
            m["report_card"]["driving_style"]["brake_before_lift_pct"],
        ),
    )
    assert any(abs(ms - (-50)) <= 0.5 and abs(pct - 77) < 1.0 for ms, pct in seen), seen


def test_pace_improved_0_213s_while_fuel_burned(long_beach_metrics):
    seen = _any(
        long_beach_metrics,
        lambda m: (
            m["report_card"]["fuel_fade"]["pace_delta_s"],
            m["report_card"]["fuel_fade"]["total_fuel_drop_l"],
        ),
    )
    assert any(
        delta is not None and abs(delta - (-0.213)) <= 0.0015 and abs(fuel - 31) <= 2.0
        for delta, fuel in seen
    ), seen


def test_new_engine_runs_and_reconciles_on_real_telemetry(long_beach_metrics):
    """The coach must run on a real file, and its segments must reconcile."""
    for m in long_beach_metrics:
        seg = m.get("segments", {})
        if seg.get("insufficient_data") or "error" in seg:
            continue
        for row in seg.get("reconciliation", {}).get("laps", []):
            assert abs(row["residual_ms"]) <= 1.0, row
        assert "error" not in m.get("coach", {}), m.get("coach")
        return
    pytest.fail("no session in the golden file produced segments")
