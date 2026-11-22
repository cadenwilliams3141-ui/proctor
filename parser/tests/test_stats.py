"""The statistics the coach stands on."""

import numpy as np

from proctor_parser import stats


def test_ranks_average_ties():
    assert stats.rank(np.array([3.0, 1.0, 3.0, 2.0])).tolist() == [2.5, 0.0, 2.5, 1.0]


def test_spearman_is_rank_based_and_signed():
    x = np.arange(10.0)
    assert stats.spearman(x, x ** 3) == 1.0
    assert stats.spearman(x, -np.exp(x)) == -1.0


def test_theil_sen_ignores_one_wild_point():
    x = np.arange(12.0)
    y = 2.0 * x + 1.0
    y[5] = 500.0
    slope, intercept = stats.theil_sen(x, y)
    assert abs(slope - 2.0) < 1e-9 and abs(intercept - 1.0) < 1e-9


def test_detrend_removes_a_steady_drift():
    x = np.arange(14.0)
    y = 70.0 - 0.05 * x
    r = stats.detrend(x, y)
    assert np.ptp(r) < 1e-9


def test_permutation_p_is_deterministic_small_for_signal_large_for_noise():
    rng = np.random.default_rng(0)
    x = rng.normal(size=14)
    y = x + rng.normal(scale=0.3, size=14)
    p1 = stats.permutation_p(x, y, seed=9)
    assert p1 == stats.permutation_p(x, y, seed=9)
    assert p1 < 0.01
    assert stats.permutation_p(x, rng.normal(size=14), seed=9) > 0.05


def test_benjamini_hochberg_is_monotone_and_bounded():
    p = np.array([0.001, 0.04, 0.03, 0.2, 0.9])
    q = stats.benjamini_hochberg(p)
    assert np.all(q >= p - 1e-12) and np.all(q <= 1.0)
    order = np.argsort(p)
    assert np.all(np.diff(q[order]) >= -1e-12)


def test_bootstrap_stability_high_for_signal():
    x = np.arange(12.0)
    y = x + np.random.default_rng(1).normal(scale=1.0, size=12)
    assert stats.bootstrap_sign_stability(x, y, seed=2) > 0.95


def test_seeds_are_stable_across_processes():
    assert stats.seed_for(4, "brake_on") == stats.seed_for(4, "brake_on")
    assert stats.seed_for(4, "brake_on") != stats.seed_for(5, "brake_on")
