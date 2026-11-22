"""Small, robust statistics for few-lap telemetry. numpy only.

A session gives a corner somewhere between six and forty passes. At those
sizes the usual tools mislead: a least-squares line is dragged by one bad
lap, a p-value of 0.05 across 150 tests produces seven false findings, and the
mean of a driver's three best passes sits well below their median by luck
alone. Everything here is chosen for that regime:

- Theil–Sen slopes (median of pairwise slopes) instead of least squares.
- Spearman rank correlation (tie-aware) instead of Pearson.
- Permutation p-values, so no distributional assumption is smuggled in.
- Benjamini–Hochberg false-discovery control across EVERY test in a session.
- Bootstrap sign stability: how often a resample agrees on the direction.

All randomness is seeded from the question being asked, so the same session
always produces the same answer.
"""

from __future__ import annotations

import zlib

import numpy as np


def seed_for(*parts: object) -> int:
    """A stable seed from the question (corner, metric, ...) — never `hash()`,
    which is salted per process."""
    return zlib.crc32("|".join(str(p) for p in parts).encode())


def rank(x: np.ndarray) -> np.ndarray:
    """Average ranks (ties share the mean of their positions), 0-based."""
    x = np.asarray(x, dtype=np.float64)
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x), dtype=np.float64)
    ranks[order] = np.arange(len(x), dtype=np.float64)
    sx = x[order]
    # Average over runs of equal values.
    i = 0
    n = len(x)
    while i < n:
        j = i + 1
        while j < n and sx[j] == sx[i]:
            j += 1
        if j - i > 1:
            ranks[order[i:j]] = 0.5 * (i + j - 1)
        i = j
    return ranks


def _pearson_rows(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pearson r between `a` (vector) and every row of `b`."""
    a = a - a.mean()
    b = b - b.mean(axis=-1, keepdims=True)
    den = np.sqrt((a * a).sum()) * np.sqrt((b * b).sum(axis=-1))
    with np.errstate(invalid="ignore", divide="ignore"):
        r = (b @ a) / den
    return np.where(den > 0, r, 0.0)


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3:
        return 0.0
    return float(_pearson_rows(rank(x), rank(y)[None, :])[0])


def theil_sen(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Median-of-pairwise-slopes line. Returns (slope, intercept)."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = len(x)
    if n < 2:
        return 0.0, float(np.median(y)) if n else 0.0
    i, j = np.triu_indices(n, k=1)
    dx = x[j] - x[i]
    ok = dx != 0
    if not ok.any():
        return 0.0, float(np.median(y))
    slope = float(np.median((y[j] - y[i])[ok] / dx[ok]))
    intercept = float(np.median(y - slope * x))
    return slope, intercept


def detrend(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """y with its robust linear trend against x removed (centred on y's median).

    Used with x = lap order, to take out what changes steadily over a run —
    fuel burning off, tyres coming in or going off, a track rubbering in —
    before asking what distinguishes one pass from another."""
    slope, intercept = theil_sen(x, y)
    resid = y - (slope * x + intercept)
    return resid + float(np.median(y))


def permutation_p(x: np.ndarray, y: np.ndarray, *, n_perm: int = 2000, seed: int = 0) -> float:
    """Two-sided permutation p-value for Spearman rho between x and y.

    Vectorised: every permutation of y's ranks is correlated with x's ranks in
    one matrix product. The +1 in numerator and denominator keeps p > 0, which
    is the honest answer with a finite number of permutations."""
    n = len(x)
    if n < 4:
        return 1.0
    rx, ry = rank(x), rank(y)
    obs = abs(float(_pearson_rows(rx, ry[None, :])[0]))
    rng = np.random.default_rng(seed)
    perms = rng.permuted(np.tile(ry, (n_perm, 1)), axis=1)
    null = np.abs(_pearson_rows(rx, perms))
    return float((np.count_nonzero(null >= obs - 1e-12) + 1) / (n_perm + 1))


def bootstrap_sign_stability(x: np.ndarray, y: np.ndarray, *, n_boot: int = 1000,
                             seed: int = 0) -> float:
    """Share of bootstrap resamples whose Spearman rho has the observed sign."""
    n = len(x)
    if n < 4:
        return 0.0
    obs = spearman(x, y)
    if obs == 0:
        return 0.0
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_boot, n))
    agree = 0
    total = 0
    for row in idx:
        xs, ys = x[row], y[row]
        if np.ptp(xs) == 0 or np.ptp(ys) == 0:
            continue
        total += 1
        agree += int(np.sign(spearman(xs, ys)) == np.sign(obs))
    return float(agree / total) if total else 0.0


def benjamini_hochberg(p: np.ndarray) -> np.ndarray:
    """BH-adjusted q-values, same order as p."""
    p = np.asarray(p, dtype=np.float64)
    m = len(p)
    if m == 0:
        return p
    order = np.argsort(p)
    ranked = p[order] * m / (np.arange(m) + 1.0)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(m)
    out[order] = np.minimum(q, 1.0)
    return out


def mad(x: np.ndarray) -> float:
    """Median absolute deviation (unscaled)."""
    x = np.asarray(x, dtype=np.float64)
    if x.size == 0:
        return 0.0
    return float(np.median(np.abs(x - np.median(x))))
