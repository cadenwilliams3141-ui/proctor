"""The coach: where the time is, and what the driver's own fastest passes did
differently — but only where the evidence holds up.

THE RULE (2026-11-22): prescribe only what the driver's own laps demonstrated.
So an action here is never "brake later" in the abstract. It is "on your
fastest passes through T4 you began braking 12 m later than on a typical pass;
across 14 passes, later braking went with less time here (rho -0.71, q 0.01);
moving your typical pass to that brake point is worth about 0.09 s". Every
number in that sentence is in the payload; the sentence itself is written in
the web app, from these fields only.

HOW THE NUMBERS ARE MADE, and the trap each step avoids:

1. Only usable passes count (phases.EXCLUDE): no off-track passes, no
   incidents, no tows, no "possible traffic". A shortcut must never become a
   target, and a car in the way must never look like a technique gap.
2. Steady drift over the run — fuel burning off, tyres coming in — is removed
   from time AND from every input (Theil–Sen against lap order) before
   anything is compared. Otherwise "your fastest passes" just means "your
   late, light-fuel laps" and every input that also drifted looks like the
   cause.
3. The target group is the k fastest passes after detrending (k = n/4, 2..5),
   so one fluke pass is never the target.
4. WINNER'S CURSE. The best few of n noisy passes sit well below the median
   by luck alone (about 1.2 standard deviations for the best 3 of 12). So the
   gap between typical and best is NOT the gain on offer. The gain shown is
   the part an input EXPLAINS: for every pass that fell short of the target
   group on that input, the robust slope of time against the input times how
   far short it fell, averaged over all passes — the time per lap that
   matching the target on every pass would save. Averaged rather than taken
   at the median pass, because the cost usually lives in a minority of passes
   ("on 5 of 15 passes you braked 20 m early"). If no input explains the gap,
   there is no action — the corner is reported as unexplained, with its
   spread.
5. MULTIPLE COMPARISONS. Twelve inputs at fifteen corners is 180 tests; at
   p < 0.05, nine would "find" something in pure noise. Every test gets a
   permutation p-value and the whole session is held to a Benjamini–Hochberg
   false-discovery rate.
6. Brake points are compared at matched entry speed: arriving faster means
   braking earlier for the same corner speed, which is not a technique
   difference.
7. Inputs that move together (brake point, release, minimum speed) are
   grouped; one leads, the rest are reported as coming with it, and their
   gain is counted once.
8. Mechanism check: a braking action must find most of its time before the
   apex, an exit action after it. If not, its confidence drops a level.
9. A target never lies outside the range the target passes actually drove.
"""

from __future__ import annotations

import numpy as np

from proctor_parser import stats
from proctor_parser.analysis.common import is_clean
from proctor_parser.events import landmarks
from proctor_parser.phases import EXCLUDE, FLAG_NAMES, Run
from proctor_parser.session import ParsedSession
from proctor_parser.track_model import TrackModel, fwd_dist

BASIS = "self-comparison: your own passes through each corner, this session"
MIN_RUNS = 6
STRONG_MIN_RUNS = 10
Q_STRONG = 0.05
Q_MODERATE = 0.10
STAB_STRONG = 0.95
STAB_MODERATE = 0.90
MIN_GAIN_S = 0.03
CONSISTENT_S = 0.05
CLUSTER_RHO = 0.7
MECHANISM_SHARE = 0.5
N_PERM = 2000
N_BOOT = 1000
MAX_ACTIONS_PER_CORNER = 2
MAX_ACTIONS = 8

# Inputs the coach may point at. `better` is the direction the TARGET differs
# in when it is an improvement — used only to name it, never to choose it:
# the data chooses the direction, the label follows.
CANDIDATES: dict[str, dict] = {
    "brake_on":    {"unit": "m",     "res": 5.0,       "phase": "entry", "positional": True},
    "brake_peak":  {"unit": "ratio", "res": 0.05,      "phase": "entry", "positional": False},
    "release":     {"unit": "m",     "res": 5.0,       "phase": "entry", "positional": True},
    "trail":       {"unit": "m",     "res": 5.0,       "phase": "entry", "positional": False},
    "turn_in":     {"unit": "m",     "res": 5.0,       "phase": "entry", "positional": True},
    "coast":       {"unit": "m",     "res": 5.0,       "phase": "entry", "positional": False},
    "abs_ms":      {"unit": "ms",    "res": 100.0,     "phase": "entry", "positional": False},
    "v_min":       {"unit": "m/s",   "res": 1.0 / 3.6, "phase": "mid",   "positional": False},
    "corrections": {"unit": "count", "res": 1.0,       "phase": "mid",   "positional": False},
    "pickup":      {"unit": "m",     "res": 5.0,       "phase": "exit",  "positional": True},
    "full":        {"unit": "m",     "res": 5.0,       "phase": "exit",  "positional": True},
    "relifts":     {"unit": "count", "res": 1.0,       "phase": "exit",  "positional": False},
}


def _entry_adjusted_brake(runs: list[Run]) -> dict[int, float | None]:
    """Brake point as it would have been at the median entry speed.

    Arriving 1 m/s faster at 70 m/s and 1.5 g needs ~4.8 m more braking. Using
    each pass's own deceleration (median across passes, for stability):
    adj = brake_on + (v_e^2 - v_med^2) / (2 a), with v_e the speed at the
    segment start — a fixed place, so it is not itself moved by the brake
    point.

    The deceleration is measured over the braking itself, brake point to
    release. Measuring it to the slowest point would include the whole
    constant-speed part of the corner and understate it by a factor of two or
    three, which over-corrects every pass."""
    rows = []
    for r in runs:
        m = r.metrics
        bo, rel = m.get("brake_on"), m.get("release")
        if bo is None or rel is None or rel - bo < 5.0:
            continue
        v_bo = float(np.interp(bo, r.u, r.ch["speed"]))
        v_rel = float(np.interp(rel, r.u, r.ch["speed"]))
        a = (v_bo ** 2 - v_rel ** 2) / (2.0 * (rel - bo))
        if a > 0.5:
            rows.append((r, a))
    if len(rows) < 3:
        return {id(r): r.metrics.get("brake_on") for r in runs}
    a_med = float(np.median([a for _, a in rows]))
    v_med = float(np.median([r.metrics["v_entry"] for r, _ in rows]))
    out = {}
    for r in runs:
        bo = r.metrics.get("brake_on")
        out[id(r)] = None if bo is None else bo + (r.metrics["v_entry"] ** 2 - v_med ** 2) / (2.0 * a_med)
    return out


def _phase_times(runs: list[Run], lm: dict) -> tuple[list[str], list[float], np.ndarray]:
    """Time in each phase on FIXED stations (the typical landmarks), so phases
    are comparable between passes and sum exactly to the segment time."""
    seg_len = min(r.seg_len for r in runs)
    named = [("approach", 0.0), ("braking", lm.get("brake_on")), ("entry", lm.get("turn_in")),
             ("mid", lm.get("v_min_at")), ("exit", lm.get("full"))]
    edges, names = [], []
    for name, at in named:
        if at is None or (edges and at <= edges[-1] + 1.0) or at >= seg_len - 1.0:
            continue
        edges.append(float(at))
        names.append(name)
    edges.append(seg_len)
    e = np.array(edges)
    pt = np.vstack([np.diff(np.asarray(r.time_at(e), dtype=np.float64)) for r in runs])
    return names, edges, pt


def _fmt(v, nd=3):
    return None if v is None else round(float(v), nd)


def analyse_corner(cid: int, runs: list[Run], model: TrackModel) -> dict:
    corner = next(c for c in model.corners if c.id == cid)
    usable = [r for r in runs if not (r.flags & EXCLUDE)]
    excluded: dict[str, int] = {}
    for r in runs:
        for f, name in FLAG_NAMES.items():
            if r.flags & f:
                excluded[name] = excluded.get(name, 0) + 1
    out: dict = {"id": cid, "n": len(usable), "n_runs": len(runs), "excluded": excluded,
                 "_tests": [], "_ctx": None}
    if not usable:
        out.update(status="insufficient", reason="no usable pass through this corner")
        return out
    T = np.array([r.time_s for r in usable])
    out.update(best_s=_fmt(T.min()), median_s=_fmt(np.median(T)),
               iqr_s=_fmt(np.subtract(*np.percentile(T, [75, 25]))))
    if len(usable) < MIN_RUNS:
        out.update(status="insufficient",
                   reason=f"need at least {MIN_RUNS} usable passes to compare; have {len(usable)}")
        out["differences"] = _differences(usable, T, model, corner)
        return out

    order = np.array([r.lap_index for r in usable], dtype=np.float64)
    T_res = stats.detrend(order, T)
    n = len(usable)
    k = int(min(5, max(2, round(n / 4))))
    G = np.argsort(T_res, kind="mergesort")[:k]
    # Time on the table per lap: how far, on average, a pass fell short of the
    # target group. Includes luck (see 4.) — it caps actions, it is not one.
    opportunity = float(np.mean(np.maximum(0.0, T_res - np.median(T_res[G]))))
    out.update(k=k, target_s=_fmt(np.median(T[G])), opportunity_s=_fmt(opportunity),
               target_laps=[int(usable[i].lap) for i in G])

    lm = landmarks(runs)
    names, edges, pt = _phase_times(usable, lm)
    d_phase = np.mean(pt, axis=0) - np.median(pt[G], axis=0)
    pos = np.maximum(d_phase, 0.0)
    entry_idx = [i for i, nm in enumerate(names) if nm in ("approach", "braking", "entry")]
    share_entry = float(pos[entry_idx].sum() / pos.sum()) if pos.sum() > 0 else None
    out["phase_gain_s"] = {nm: _fmt(v) for nm, v in zip(names, d_phase)}

    adj = _entry_adjusted_brake(usable)
    for metric, spec in CANDIDATES.items():
        if metric == "brake_on":
            vals = np.array([np.nan if adj.get(id(r)) is None else adj[id(r)] for r in usable])
        else:
            vals = np.array([np.nan if r.metrics.get(metric) is None else r.metrics[metric] for r in usable])
        ok = np.isfinite(vals)
        if ok.sum() < MIN_RUNS or np.ptp(vals[ok]) == 0:
            continue
        m_res = stats.detrend(order[ok], vals[ok])
        t_res = T_res[ok]
        rho = stats.spearman(m_res, t_res)
        p = stats.permutation_p(m_res, t_res, n_perm=N_PERM, seed=stats.seed_for(cid, metric))
        out["_tests"].append({"metric": metric, "rho": rho, "p": p, "ok": ok, "m_res": m_res,
                              "vals": vals, "t_res": t_res})
    out["_ctx"] = {"usable": usable, "T": T, "T_res": T_res, "G": G, "share_entry": share_entry,
                   "opportunity": opportunity, "corner": corner, "lm": lm}
    return out


def _differences(usable: list[Run], T: np.ndarray, model, corner) -> list[dict]:
    """Typical vs fastest-pass inputs with no statistical claim: what thin
    sessions get instead of actions."""
    if len(usable) < 3:
        return []
    best = np.argsort(T)[: max(1, len(usable) // 3)]
    rows = []
    for metric, spec in CANDIDATES.items():
        vals = np.array([np.nan if r.metrics.get(metric) is None else r.metrics[metric] for r in usable])
        if np.isfinite(vals).sum() < 3:
            continue
        typ = float(np.nanmedian(vals))
        bst = float(np.nanmedian(vals[best]))
        scale = max(spec["res"], stats.mad(vals[np.isfinite(vals)]))
        if abs(bst - typ) >= spec["res"]:
            rows.append((abs(bst - typ) / scale, {"metric": metric, "unit": spec["unit"],
                                                  "typical": _fmt(typ), "fastest": _fmt(bst)}))
    rows.sort(key=lambda x: -x[0])
    return [r for _, r in rows[:3]]


def _direction(metric: str, typical: float, target: float) -> str:
    up = target > typical
    if CANDIDATES[metric]["positional"]:
        return "later" if up else "earlier"
    return {"brake_peak": "harder" if up else "softer",
            "trail": "longer" if up else "shorter",
            "v_min": "higher" if up else "lower",
            "coast": "more" if up else "less",
            "abs_ms": "more" if up else "less",
            "corrections": "more" if up else "fewer",
            "relifts": "more" if up else "fewer"}[metric]


def _build_actions(c: dict, q_of: dict[tuple[int, str], float]) -> list[dict]:
    ctx = c["_ctx"]
    usable, T_res, G = ctx["usable"], ctx["T_res"], ctx["G"]
    corner, model_len = ctx["corner"], None
    cands = []
    for t in c["_tests"]:
        metric = t["metric"]
        q = q_of[(c["id"], metric)]
        if q > Q_MODERATE:
            continue
        spec = CANDIDATES[metric]
        ok, vals = t["ok"], t["vals"]
        g_ok = [i for i in G if ok[i]]
        if len(g_ok) < 2:
            continue
        slope, _ = stats.theil_sen(t["m_res"], t["t_res"])
        if slope == 0:
            continue
        helpful = -np.sign(slope)          # moving the input this way went with less time
        typical = float(np.median(vals[ok]))
        target = float(np.median(vals[g_ok]))
        if (target - typical) * helpful <= 0:
            continue  # the fast passes did not differ in the helpful direction
        short = (target - vals[ok]) * helpful          # > 0: this pass fell short
        n_short = int(np.count_nonzero(short >= spec["res"]))
        if n_short < 2:
            continue  # within measurement resolution on all but a pass or two
        gain = float(np.mean(np.abs(slope) * np.maximum(short, 0.0)))
        gain = min(gain, ctx["opportunity"])
        if gain < MIN_GAIN_S:
            continue
        stab = stats.bootstrap_sign_stability(t["m_res"], t["t_res"], n_boot=N_BOOT,
                                              seed=stats.seed_for(c["id"], metric, "boot"))
        n_ok = int(ok.sum())
        if q <= Q_STRONG and stab >= STAB_STRONG and n_ok >= STRONG_MIN_RUNS:
            conf = 2
        elif stab >= STAB_MODERATE:
            conf = 1
        else:
            continue
        share = ctx["share_entry"]
        if share is not None:
            if spec["phase"] == "entry" and share < MECHANISM_SHARE:
                conf -= 1
            elif spec["phase"] == "exit" and share > 1 - MECHANISM_SHARE:
                conf -= 1
        if conf <= 0:
            continue
        raw = np.array([np.nan if r.metrics.get(metric) is None else r.metrics[metric] for r in usable])
        raw_typ = float(np.nanmedian(raw))
        raw_g = raw[[i for i in G if np.isfinite(raw[i])]]
        raw_tgt = float(np.median(raw_g)) if raw_g.size else target
        short_idx = np.flatnonzero(ok)[short >= spec["res"]]
        short_raw = raw[short_idx]
        short_raw = short_raw[np.isfinite(short_raw)]
        cands.append({
            "metric": metric, "spec": spec, "q": q, "rho": t["rho"], "p": t["p"],
            "slope": slope, "gain": gain, "conf": conf, "stab": stab, "n": n_ok,
            "typical": raw_typ, "target": raw_tgt, "n_short": n_short,
            "short_typical": float(np.median(short_raw)) if short_raw.size else None,
            "short_laps": [int(usable[i].lap) for i in short_idx],
            "range": [float(np.min(raw_g)), float(np.max(raw_g))] if raw_g.size else [raw_tgt, raw_tgt],
            "m_res": t["m_res"], "ok": ok,
        })
    if not cands:
        return []

    # Group inputs that move together; lead with the one whose phase matches
    # where the time was actually found, then the strongest.
    share = ctx["share_entry"]
    want = "entry" if (share is not None and share >= MECHANISM_SHARE) else "exit"
    cands.sort(key=lambda x: (x["spec"]["phase"] != want and x["spec"]["phase"] != "mid",
                              -x["conf"], x["q"], -abs(x["rho"])))
    clusters: list[list[dict]] = []
    for cand in cands:
        placed = False
        for cl in clusters:
            lead = cl[0]
            both = lead["ok"] & cand["ok"]
            if both.sum() >= 4:
                a = _aligned(lead, both)
                b = _aligned(cand, both)
                if abs(stats.spearman(a, b)) >= CLUSTER_RHO:
                    cl.append(cand)
                    placed = True
                    break
        if not placed:
            clusters.append([cand])

    actions = []
    remaining = ctx["opportunity"]
    for cl in clusters[:MAX_ACTIONS_PER_CORNER]:
        lead = cl[0]
        gain = min(lead["gain"], remaining)
        if gain < MIN_GAIN_S:
            break
        remaining -= gain
        actions.append({
            "corner": int(c["id"]),
            "metric": lead["metric"],
            "unit": lead["spec"]["unit"],
            "phase": lead["spec"]["phase"],
            "typical": _fmt(lead["typical"], 2),
            "target": _fmt(lead["target"], 2),
            "n_short": lead["n_short"],
            "short_typical": _fmt(lead["short_typical"], 2),
            "short_laps": lead["short_laps"],
            "range": [_fmt(lead["range"][0], 2), _fmt(lead["range"][1], 2)],
            "direction": _direction(lead["metric"], lead["short_typical"] if lead["short_typical"] is not None else lead["typical"], lead["target"]),
            "gain_s": _fmt(gain),
            "confidence": "strong" if lead["conf"] >= 2 else "moderate",
            "comes_with": [{"metric": x["metric"], "unit": x["spec"]["unit"],
                            "typical": _fmt(x["typical"], 2), "target": _fmt(x["target"], 2),
                            "direction": _direction(x["metric"], x["typical"], x["target"])}
                           for x in cl[1:]],
            "evidence": {
                "n": lead["n"], "k": len(c["target_laps"]), "target_laps": c["target_laps"],
                "rho": _fmt(lead["rho"]), "p": _fmt(lead["p"], 4), "q": _fmt(lead["q"], 4),
                "slope_s_per_unit": _fmt(lead["slope"], 5), "stability": _fmt(lead["stab"]),
                "phase_share_entry": _fmt(ctx["share_entry"]),
                "entry_speed_adjusted": lead["metric"] == "brake_on",
                "detrended_by_lap_order": True,
            },
        })
    return actions


def _aligned(c: dict, mask: np.ndarray) -> np.ndarray:
    """c's residuals at the passes in `mask` (c['m_res'] is indexed over c['ok'])."""
    full = np.full(len(c["ok"]), np.nan)
    full[c["ok"]] = c["m_res"]
    return full[mask]


def coach(session: ParsedSession, model: TrackModel, runs_by_corner: dict[int, list[Run]]) -> dict:
    corners = [analyse_corner(c.id, runs_by_corner.get(c.id, []), model) for c in model.corners]
    tests = [(c["id"], t["metric"], t["p"]) for c in corners for t in c["_tests"]]
    q = stats.benjamini_hochberg(np.array([p for *_, p in tests])) if tests else np.array([])
    q_of = {(cid, m): float(qq) for (cid, m, _), qq in zip(tests, q)}

    actions: list[dict] = []
    for c in corners:
        if c["_ctx"] is None:
            continue
        acts = _build_actions(c, q_of)
        actions.extend(acts)
        opp = c.get("opportunity_s") or 0.0
        if acts:
            c["status"] = "action"
        elif opp < CONSISTENT_S:
            c["status"] = "consistent"
        else:
            c["status"] = "unexplained"
            c["reason"] = ("your passes here varied, but no single input explained the "
                           "difference at the required confidence")
            c["differences"] = _differences(c["_ctx"]["usable"], c["_ctx"]["T"], model, c["_ctx"]["corner"])
    for c in corners:
        c.pop("_tests", None)
        c.pop("_ctx", None)

    actions.sort(key=lambda a: -a["gain_s"])
    clean = [lap for lap in session.laps if is_clean(lap) and lap.lap_time_exact_s is not None]
    typical = float(np.median([lap.lap_time_exact_s for lap in clean])) if clean else None
    best = float(min(lap.lap_time_exact_s for lap in clean)) if clean else None
    gain_total = float(sum(a["gain_s"] for a in actions))
    bests = [c.get("best_s") for c in corners]
    theoretical = float(sum(bests)) if bests and all(b is not None for b in bests) else None
    return {
        "basis": BASIS,
        "n_clean_laps": len(clean),
        "typical_lap_s": _fmt(typical),
        "best_lap_s": _fmt(best),
        "achievable_lap_s": _fmt(typical - gain_total) if typical is not None else None,
        "explained_gain_s": _fmt(gain_total),
        "theoretical_best_s": _fmt(theoretical),
        "actions": actions[:MAX_ACTIONS],
        "actions_total": len(actions),
        "corners": corners,
        "tests_run": len(tests),
        "no_action_reason": None if actions else (
            "no input explained the differences between your passes at the required "
            "confidence — a finding, not a gap in the data"
            if tests else "not enough usable passes through any corner to compare"),
        "method": {
            "min_passes": MIN_RUNS, "fdr_q_moderate": Q_MODERATE, "fdr_q_strong": Q_STRONG,
            "stability_moderate": STAB_MODERATE, "stability_strong": STAB_STRONG,
            "strong_min_passes": STRONG_MIN_RUNS, "min_gain_s": MIN_GAIN_S,
            "permutations": N_PERM, "bootstrap": N_BOOT,
            "target_group": "fastest quarter of usable passes after detrending (2 to 5)",
            "gain": "explained: robust slope x (typical - target), capped at the corner's opportunity",
        },
        "caveat": (
            "actions come from this session's own passes only; one session can show what "
            "went with less time here, not why. Theoretical best stitches your best passes "
            "and is optimistic by construction."
        ),
    }
