"""Golden-fixture tests against real .ibt files.

Each file's test skips cleanly when that file is not on this machine, so the
suite is honest about what it actually verified. Expected values for Long
Beach and Mugello come from prior verified parses; Road Atlanta was measured
in this repo (Section 3 gate).
"""

import os
from pathlib import Path

import pytest

from proctor_parser import IbtFile, parse_ibt

SEARCH_DIRS = [
    Path(os.environ.get("PROCTOR_FIXTURE_DIR", "")),
    Path.home() / "OneDrive" / "Documents" / "iRacing" / "Telemetry",
    Path.home() / "Documents" / "iRacing" / "telemetry",
    Path.home() / "Downloads",
    Path(__file__).parent / "fixtures",
]

# Keyed by exact filename: track-name tokens are ambiguous (the telemetry
# folder holds many sessions per track) and each golden number belongs to one
# specific verified file.
GOLDEN = {
    "porsche992rgt3_roadatlanta full 2026-07-16 21-19-03.ibt":
        dict(num_vars=287, buf_len=1104, tick_rate=60, records=52458),
    "porsche992rgt3_mugello gp 2026-07-09 21-57-07.ibt":
        dict(num_vars=287, buf_len=1104, tick_rate=60, records=48955),
    "porsche718gt4_longbeach 2026-01-26 13-42-30.ibt":
        dict(num_vars=285, buf_len=1099, tick_rate=60, records=124215,
             wear_masked=True),
}


def find_fixture(filename: str) -> Path | None:
    for d in SEARCH_DIRS:
        if not d or not d.is_dir():
            continue
        candidate = d / filename
        if candidate.is_file():
            return candidate
    return None


@pytest.mark.parametrize("token", list(GOLDEN))
def test_golden_header(token):
    path = find_fixture(token)
    if path is None:
        pytest.skip(f"fixture file for '{token}' not present on this machine")
    ibt = IbtFile.from_path(path)
    exp = GOLDEN[token]
    assert ibt.header.num_vars == exp["num_vars"]
    assert ibt.header.buf_len == exp["buf_len"]
    assert ibt.header.tick_rate == exp["tick_rate"]
    assert ibt.record_count == exp["records"]
    assert ibt.missing_core_channels() == []


@pytest.mark.parametrize("token", list(GOLDEN))
def test_golden_parse(token):
    path = find_fixture(token)
    if path is None:
        pytest.skip(f"fixture file for '{token}' not present on this machine")
    sessions = parse_ibt(IbtFile.from_path(path))
    assert sessions, "at least one session"
    exp = GOLDEN[token]
    if "wear_masked" in exp:
        assert sessions[0].meta.wear_masked is exp["wear_masked"]

    all_laps = [lap for s in sessions for lap in s.laps]
    valid = [lap for lap in all_laps if lap.is_valid]
    assert all_laps, "laps segmented"
    # Real driving: any valid lap has a plausible lap time.
    for lap in valid:
        assert 30.0 < lap.lap_time_s < 600.0
    # First lap of the file is never valid (out lap by definition).
    assert all_laps[0].is_valid is False
