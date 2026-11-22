"""Shared definitions every analysis module agrees on.

Before this file existed the reference-lap rule was copied into ten modules.
The copies happened to agree; nothing made them. A module that drifted would
silently compare against a different lap from its neighbours, and two panels
on one screen would describe two different "fastest laps" without saying so.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from proctor_parser.session import ParsedLap, ParsedSession

# Used when the session YAML does not carry a track length. Modules that fall
# back to it must say so in their payload.
DEFAULT_TRACK_LENGTH_KM = 4.0


def _laps(source: ParsedSession | Iterable[ParsedLap]) -> list[ParsedLap]:
    return list(source.laps) if isinstance(source, ParsedSession) else list(source)


def is_clean(lap: ParsedLap) -> bool:
    """A lap fit to stand for the driver's normal running: valid, timed, and
    not flagged anomalous (incident or speed-profile outlier)."""
    return lap.is_valid and lap.lap_time_s is not None and not lap.is_anomalous


def clean_laps(source: ParsedSession | Iterable[ParsedLap]) -> list[ParsedLap]:
    return [lap for lap in _laps(source) if is_clean(lap)]


def reference_lap(source: ParsedSession | Iterable[ParsedLap]) -> ParsedLap | None:
    """Contract rule 4: fastest clean lap, else fastest valid, else None."""
    valid = [lap for lap in _laps(source) if lap.is_valid and lap.lap_time_s is not None]
    if not valid:
        return None
    clean = [lap for lap in valid if not lap.is_anomalous]
    return min(clean or valid, key=lambda lap: lap.lap_time_s)


def track_length_m(session: ParsedSession) -> tuple[float, bool]:
    """Track length in metres, and whether it had to be assumed."""
    km = session.meta.track_length_km
    if km is None or km <= 0:
        return DEFAULT_TRACK_LENGTH_KM * 1000.0, True
    return float(km) * 1000.0, False


def directional_peak(
    values_g: np.ndarray, *, in_state_g: float = 0.05, min_ticks: int = 30,
    pctile: float = 98.0,
) -> tuple[float | None, int, str | None]:
    """Peak of a one-sided quantity, taken ONLY over the ticks doing it.

    `values_g` is already clipped at zero (or an absolute value), so a tick not
    in the state reads ~0. Counting those ticks in the percentile measures the
    SHARE of the lap spent in the state, not the force reached while in it — a
    driver who brakes for 1.5% of a lap would be reported at 0.0 g. Returns
    (peak or None, ticks in state, reason when None).
    """
    v = np.asarray(values_g, dtype=np.float64)
    in_state = np.isfinite(v) & (v > in_state_g)
    n = int(np.count_nonzero(in_state))
    if n < min_ticks:
        return None, n, f"only {n} ticks above {in_state_g} g — too few to take a peak from"
    return round(float(np.percentile(v[in_state], pctile)), 3), n, None
