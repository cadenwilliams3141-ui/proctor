"""Upshift points: the RPM you actually shift at, per gear (module 9).

Observes every upshift the driver made this session — a gear incrementing by one
between consecutive moving ticks, both gears in a forward ratio — and records the
engine RPM on the tick just before the change. Grouped by the gear being left,
and expressed against the car's redline when it is known.

This is descriptive only. The optimal shift point depends on the car's power and
torque curves, which the contract does not carry, so the payload reports where
shifts clustered and never advises shifting earlier or later.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.laps import moving_mask
from proctor_parser.session import ParsedSession

METRIC_KEY = "shift_analysis"

_BASIS = "your own shift points this session vs the car's redline"
_CAVEAT = (
    "descriptive only; optimal shift points depend on the car's power curve, "
    "which is not modeled"
)
_MIN_UPSHIFTS = 3


def compute(session: ParsedSession) -> dict:
    redline = session.meta.car_redline_rpm
    redline_f = float(redline) if redline else None
    tick_rate = session.meta.tick_rate or 60

    from_gears: list[int] = []
    rpms: list[float] = []
    for lap in session.laps:
        if "gear" not in lap.raw or len(lap.raw["gear"]) < 2:
            continue
        gear = lap.raw["gear"].astype(np.int64)
        rpm = lap.raw["rpm"].astype(np.float64)
        moving = moving_mask(lap.raw["speed"])
        # iRacing's gearbox passes through neutral (0) for a few ticks
        # mid-shift (3 -> 0 -> 4), so a consecutive-tick comparison never sees
        # +1 on real data. Compare the sequence of forward-gear ticks instead,
        # capping the neutral gap so a long coast in neutral is not a "shift".
        nz = np.flatnonzero(gear >= 1)
        if nz.size < 2:
            continue
        gseq = gear[nz]
        gap_ok = np.diff(nz) <= 2 * tick_rate
        up = (gseq[1:] == gseq[:-1] + 1) & gap_ok & moving[nz[:-1]]
        pre = nz[:-1][up]  # last tick in the gear being left
        from_gears.extend(int(v) for v in gear[pre])
        rpms.extend(float(v) for v in rpm[pre])

    total = len(rpms)
    if total < _MIN_UPSHIFTS:
        return {
            "basis": _BASIS,
            "insufficient_data": True,
            "reason": f"need >={_MIN_UPSHIFTS} upshifts; found {total}",
            "redline_rpm": redline_f,
            "caveat": _CAVEAT,
        }

    gears_arr = np.array(from_gears, dtype=np.int64)
    rpm_arr = np.array(rpms, dtype=np.float64)

    by_gear: dict[str, dict] = {}
    for g in sorted(set(from_gears)):
        sel = rpm_arr[gears_arr == g]
        median = float(np.median(sel))
        entry: dict = {
            "count": int(sel.size),
            "median_rpm": round(median),
        }
        if redline_f:
            entry["pct_of_redline"] = round(100.0 * median / redline_f, 1)
        else:
            entry["redline_unknown"] = True
        by_gear[str(g)] = entry

    overall_median = float(np.median(rpm_arr))
    if redline_f:
        pct = round(100.0 * overall_median / redline_f, 1)
        observation = f"upshifts cluster at {pct}% of redline"
    else:
        observation = (
            f"upshifts cluster around {round(overall_median)} rpm (redline unknown)"
        )

    return {
        "basis": _BASIS,
        "redline_rpm": redline_f,
        "upshifts_total": total,
        "by_gear": by_gear,
        "observation": observation,
        "caveat": _CAVEAT,
    }
