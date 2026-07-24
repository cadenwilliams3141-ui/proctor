"""Per-corner, per-section time deltas vs the reference lap.

Splits each corner from the reference lap into four equal-track-length sections
(S1..S4) and observes, for every valid lap, the time gained or lost in each
section against the reference. Time across a span is the integral of 1/speed
over distance. Corner boundaries come only from this session's reference lap, so
they describe this driver's line — not the track's surveyed geometry.
"""

from __future__ import annotations

import numpy as np

from proctor_parser.analysis.corners import detect_corners
from proctor_parser.session import ParsedLap, ParsedSession

METRIC_KEY = "corner_sections"

BASIS = "self-comparison within this session"
DEFAULT_TRACK_LENGTH_KM = 4.0
MIN_SPEED_MS = 1.0
N_SECTIONS = 4


def _reference_lap(session: ParsedSession) -> ParsedLap | None:
    valid = [lap for lap in session.laps if lap.is_valid and lap.lap_time_s is not None]
    if not valid:
        return None
    clean = [lap for lap in valid if not lap.is_anomalous]
    pool = clean or valid
    return min(pool, key=lambda lap: lap.lap_time_s)


def _section_time(inv_speed: np.ndarray, mask: np.ndarray, ds: float) -> float:
    """Seconds spent in the masked span = sum of ds / speed over its bins."""
    return float(np.sum(ds * inv_speed[mask]))


def compute(session: ParsedSession) -> dict:
    ref = _reference_lap(session)
    if ref is None:
        return {
            "basis": BASIS,
            "insufficient_data": True,
            "reason": "no valid laps in this session to serve as a reference",
        }

    track_km = session.meta.track_length_km
    assumed = track_km is None
    if assumed:
        track_km = DEFAULT_TRACK_LENGTH_KM
    ds = (track_km * 1000.0) / 1000.0  # metres per grid bin

    ref_pct = ref.grid["grid_pct"].astype(np.float64)
    inv_ref = 1.0 / np.clip(ref.grid["speed"].astype(np.float64), MIN_SPEED_MS, None)
    corners = detect_corners(ref.grid["speed"], ref.grid["grid_pct"])

    # Equal-track-length quarters between start and end. The true apex is carried
    # through even though it may not fall on the S2/S3 boundary.
    corners_payload: list[dict] = []
    section_masks: dict[int, list[np.ndarray]] = {}
    for c in corners:
        edges = np.linspace(c["start_pct"], c["end_pct"], N_SECTIONS + 1)
        sections = []
        masks = []
        for k in range(N_SECTIONS):
            lo, hi = float(edges[k]), float(edges[k + 1])
            if k == N_SECTIONS - 1:
                mask = (ref_pct >= lo) & (ref_pct <= hi)  # last span keeps its end
            else:
                mask = (ref_pct >= lo) & (ref_pct < hi)
            sections.append({"s": k + 1, "start_pct": round(lo, 4), "end_pct": round(hi, 4)})
            masks.append(mask)
        corners_payload.append({
            "id": c["id"],
            "start_pct": c["start_pct"],
            "apex_pct": c["apex_pct"],
            "end_pct": c["end_pct"],
            "sections": sections,
        })
        section_masks[c["id"]] = masks

    per_lap: dict[str, dict] = {}
    for lap in session.laps:
        if not lap.is_valid or lap.lap_number == ref.lap_number:
            continue  # valid laps only; the reference's delta against itself is zero
        inv_lap = 1.0 / np.clip(lap.grid["speed"].astype(np.float64), MIN_SPEED_MS, None)
        corner_deltas: dict[str, list[float]] = {}
        for c in corners_payload:
            deltas = []
            for mask in section_masks[c["id"]]:
                lap_t = _section_time(inv_lap, mask, ds)
                ref_t = _section_time(inv_ref, mask, ds)
                deltas.append(round(lap_t - ref_t, 4))
            corner_deltas[str(c["id"])] = deltas
        per_lap[str(lap.lap_number)] = corner_deltas

    caveat = "corner boundaries derived from this session's reference lap only"
    payload = {
        "basis": BASIS,
        "reference_lap": int(ref.lap_number),
        "corners": corners_payload,
        "per_lap": per_lap,
        "caveat": caveat,
    }
    if assumed:
        payload["track_length_assumed"] = True
        payload["caveat"] = (
            f"track length unknown; assumed {DEFAULT_TRACK_LENGTH_KM:.1f} km "
            f"(section delta magnitudes scale with it); " + caveat
        )
    return payload
