"""This session's corners and the segments that partition the lap (track model).

Observes where the driver's own median lap slowed AND turned, names those
corners T1, T2, ... from the start/finish line (Proctor's numbering, not the
circuit's official turn names), and cuts the lap into one segment per corner:
brake zone, corner, exit and the following straight. Segment times come from
the tick clock, not from integrating speed, and per lap they reconcile to the
crossing-to-crossing lap time.
"""

from __future__ import annotations

from proctor_parser.analysis._engine import engine, insufficient
from proctor_parser.session import ParsedSession
from proctor_parser.timing import timing_check

METRIC_KEY = "segments"
BASIS = "self-comparison: the corners your own laps carved this session"
NUMBERING = (
    "corner numbers are Proctor's own, counted from the start/finish line; they are "
    "not the circuit's official turn names"
)


def compute(session: ParsedSession) -> dict:
    model, runs = engine(session)
    if model.insufficient:
        out = insufficient(BASIS, model.insufficient)
        out["timing"] = timing_check(session)
        return out
    L = model.length_m
    corners = []
    for c in model.corners:
        corners.append({
            "id": c.id, "name": f"T{c.id}", "kind": c.kind, "complex": c.complex,
            "dir": c.dir, "radius_m": c.radius_m, "turn_deg": round(c.turn_deg, 1),
            "vmin_ms": round(c.vmin_ms, 2),
            "apex_m": round(c.apex_m, 1),
            "seg_start_m": round(c.seg_start_m, 1), "seg_end_m": round(c.seg_end_m, 1),
            "start_pct": round(c.seg_start_m / L, 5),
            "apex_pct": round(c.apex_m / L, 5),
            "end_pct": round((c.seg_end_m % L) / L, 5),
            "wraps": c.seg_end_m > L,
            "sub_apexes": [{**sa, "apex_pct": round(sa["apex_m"] / L, 5)} for sa in c.sub_apexes],
        })

    laps_no = sorted({r.lap for rs in runs.values() for r in rs})
    table = []
    for lap in laps_no:
        row = []
        for c in model.corners:
            r = next((x for x in runs.get(c.id, []) if x.lap == lap), None)
            row.append(None if r is None else round(r.time_s, 4))
        table.append(row)

    return {
        "basis": BASIS,
        "numbering": NUMBERING,
        "length_m": round(L, 1),
        "length_source": model.length_source,
        "profile_laps": model.profile_laps,
        "corners": corners,
        "kinks": model.kinks,
        "laps": {"lap": laps_no, "segment_s": table},
        "reconciliation": _reconcile(session, model),
        "timing": timing_check(session),
        "caveat": (
            "segments that cross the start/finish line include the next lap's first metres, "
            "so a lap's own segment times do not sum to its lap time; the reconciliation "
            "block checks the clock within each lap instead"
        ),
    }


def _reconcile(session: ParsedSession, model) -> dict:
    """Within every complete lap, the segment pieces sum to the lap time."""
    L = model.length_m
    rows = []
    for lap in session.laps:
        ck = model.clocks.get(lap.lap_number)
        if ck is None or not ck.complete or not lap.is_valid:
            continue
        total = 0.0
        for c in model.corners:
            b0, b1 = c.seg_start_m, c.seg_end_m
            if b1 <= L:
                total += float(ck.time_at(b1) - ck.time_at(b0))
            else:
                total += float(ck.time_at(L) - ck.time_at(b0)) + float(ck.time_at(b1 - L) - ck.time_at(0.0))
        rows.append({"lap": int(lap.lap_number), "segments_s": round(total, 4),
                     "lap_s": round(float(ck.lap_time_s), 4),
                     "residual_ms": round((total - float(ck.lap_time_s)) * 1000.0, 3)})
    worst = max((abs(r["residual_ms"]) for r in rows), default=None)
    return {"laps": rows, "max_abs_residual_ms": worst}
