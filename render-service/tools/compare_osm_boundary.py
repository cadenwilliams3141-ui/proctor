"""Measure how far OpenStreetMap's idea of a circuit sits from your own.

DEV TOOL. Nothing in the product imports this and it never runs on Render.

┌ WHAT THIS EXISTS TO SETTLE ─────────────────────────────────────────────────┐
│ The 2026-08-02 Decision says the racing-line view draws the road YOU used,  │
│ never the track, because a disk .ibt carries GPS and nothing else about the │
│ circuit — no kerbs, no white lines, no surveyed edges. That forbids         │
│ INVENTING edges. It does not settle whether real ones could be SOURCED.     │
│                                                                             │
│ This tool answers the only question that matters before anyone builds that: │
│ does an externally-mapped circuit actually land on top of the road you      │
│ drove? It reports the separation in metres and draws both, and it is        │
│ equally willing to come back with "these disagree by four metres, do not    │
│ build this." A negative result here is the useful result — it closes the    │
│ question for the price of one command.                                      │
└─────────────────────────────────────────────────────────────────────────────┘

WHY THE ANSWER IS NOT OBVIOUS EITHER WAY. iRacing's circuits are laser-scanned
to centimetres. OSM's raceways are digitised from aerial imagery, so a metre or
two of drift is normal and carries no error bars. Overlay a boundary that loose
on a line that tight and a lap that never left the road can be drawn running
wide — a picture that describes the wrong run without ever looking wrong, which
is the failure CLAUDE.md records three times over. So the separation has to be
MEASURED before any of it reaches a screen.

WHAT IT DELIBERATELY DOES NOT DO. It does not fit a rotation or a scale to make
the two agree. Fitting a transform until the error is small manufactures the
agreement it claims to find. The headline number is the RAW separation, exactly
as the two datasets sit on the Earth. A translation-only residual is reported
BESIDE it, never instead of it, because the two answer different questions: a
large raw offset with a small residual means one dataset is shifted (fixable), a
large residual means the shapes genuinely differ (not fixable).

USAGE, on a machine that can reach the network:

    export DATABASE_URL=...                 # the Neon connection string
    python render-service/tools/compare_osm_boundary.py --list
    python render-service/tools/compare_osm_boundary.py --track "Road Atlanta"

Writes comparison.json, the raw Overpass response, and comparison.svg to --out
(default ./osm-comparison). LOOK AT THE SVG. Five Build Log entries record
screens verified by types and never by pixels, and every one of those bugs was
found by looking; a table of percentiles can hide a circuit matched to the wrong
layout in a way one glance cannot.

Re-runnable without the network once fetched: --osm-json replays a saved
response, so the geometry can be re-examined offline.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "parser"))

# The SAME spike filter the app applies at read time. Imported rather than
# reimplemented: a third copy of that rule (parser, shape.ts, here) would be a
# third thing to keep in step, and comparing against bins the app itself
# refuses to draw would answer a question nobody asked.
from proctor_parser.analysis.track_edges import discard_outward_spikes  # noqa: E402

M_PER_DEG = 111320.0
DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter"

# A way whose median separation exceeds this is treated as a DIFFERENT road —
# a kart track, a service road, an access lane — rather than as a bad match for
# this one. It is a grouping threshold, not a verdict: everything found is
# reported either way, and this only decides what goes into the headline union.
NEARBY_WAY_M = 25.0


# ─────────────────────────────────────────────────────────────────────────────
# Geometry. Pure, and separated from the I/O so it can be tested.
# ─────────────────────────────────────────────────────────────────────────────

def to_local(lat, lon, origin_lat: float, origin_lon: float):
    """Geographic degrees -> the local metre frame a boundary is stored in.

    The inverse of the projection track_edges.py applies, using the same
    constant. Anything compared against a stored boundary has to arrive in that
    boundary's own frame; re-centring on its own mean instead would silently
    align the two datasets and destroy the measurement.
    """
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    x = (lon - origin_lon) * M_PER_DEG * math.cos(math.radians(origin_lat))
    y = (lat - origin_lat) * M_PER_DEG
    return x, y


def to_geographic(x, y, origin_lat: float, origin_lon: float):
    """The local metre frame -> geographic degrees."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    lat = origin_lat + y / M_PER_DEG
    lon = origin_lon + x / (M_PER_DEG * math.cos(math.radians(origin_lat)))
    return lat, lon


def nearest_on_polyline(px, py, vx, vy):
    """For each point: distance to the polyline, and the foot of that distance.

    Measured to the SEGMENTS, not the vertices. A vertex-only measure reads
    metres of error on a straight that OSM happens to draw with two nodes and
    the telemetry with a thousand, which is a property of how each was recorded
    rather than of where the road is.
    """
    px = np.asarray(px, dtype=np.float64)
    py = np.asarray(py, dtype=np.float64)
    vx = np.asarray(vx, dtype=np.float64)
    vy = np.asarray(vy, dtype=np.float64)
    if vx.size < 2:
        nan = np.full(px.shape, np.nan)
        return np.full(px.shape, np.inf), nan, nan

    ax, ay = vx[:-1], vy[:-1]          # segment starts
    bx, by = vx[1:], vy[1:]            # segment ends
    sx, sy = bx - ax, by - ay
    seg_len2 = sx * sx + sy * sy
    # A zero-length segment (duplicate nodes, which OSM does contain) would
    # divide by zero; clamped, it degenerates to its own endpoint, which is the
    # right answer for it.
    seg_len2 = np.where(seg_len2 > 0, seg_len2, 1e-12)

    # (points, segments) — the projection of each point onto each segment,
    # clamped to the segment so the foot never runs off the end.
    dx = px[:, None] - ax[None, :]
    dy = py[:, None] - ay[None, :]
    t = np.clip((dx * sx[None, :] + dy * sy[None, :]) / seg_len2[None, :], 0.0, 1.0)
    fx = ax[None, :] + t * sx[None, :]
    fy = ay[None, :] + t * sy[None, :]
    d = np.hypot(px[:, None] - fx, py[:, None] - fy)
    j = np.argmin(d, axis=1)
    i = np.arange(px.size)
    return d[i, j], fx[i, j], fy[i, j]


def point_polyline_distance(px, py, vx, vy) -> np.ndarray:
    """Shortest distance from each point to a polyline, in the same units."""
    return nearest_on_polyline(px, py, vx, vy)[0]


def _mean_displacement(px, py, ways) -> tuple[float, float]:
    """Mean vector from each point to the nearest place on the nearest way."""
    feet = [nearest_on_polyline(px, py, w[0], w[1]) for w in ways]
    stacked = np.vstack([f[0] for f in feet])
    pick = np.argmin(stacked, axis=0)
    idx = np.arange(np.asarray(px).size)
    fx = np.vstack([f[1] for f in feet])[pick, idx]
    fy = np.vstack([f[2] for f in feet])[pick, idx]
    ok = np.isfinite(fx) & np.isfinite(fy)
    if not np.any(ok):
        return 0.0, 0.0
    return float(np.mean(fx[ok] - px[ok])), float(np.mean(fy[ok] - py[ok]))


def fit_translation(px, py, ways, iterations: int = 60) -> tuple[float, float]:
    """The shift that best lines two shapes up. TRANSLATION ONLY — no rotation,
    no scale, and reported beside the raw separation rather than instead of it.

    Two wrong ways to compute this, both tried here first and both recorded so
    nobody re-derives them:

    NOT THE TWO CENTROIDS. A closed OSM way repeats its first node, and OSM
    nodes crowd into corners and thin out along straights, so the centroid of
    its vertices is a biased estimate of where the circuit sits. On a 240-point
    ring with one repeated node that bias alone was 1.7 m — larger than the
    disagreement this tool exists to resolve.

    NOT ONE STEP OF MATCHED PAIRS EITHER. Matching a point to the nearest place
    on a curve only ever sees the component ACROSS the curve; the component
    along it slides freely and averages away. On a closed loop that halves the
    answer exactly — a planted 4 m shift came back as 2.0 m. So the step is
    iterated: each pass re-matches from the shifted position and removes half of
    what remains, which converges geometrically on the true offset.

    Still translation only. Iterating a shift cannot absorb a difference in
    SHAPE, which is the thing the residual has to stay able to report.
    """
    tx = ty = 0.0
    px = np.asarray(px, dtype=np.float64)
    py = np.asarray(py, dtype=np.float64)
    for _ in range(iterations):
        dx, dy = _mean_displacement(px + tx, py + ty, ways)
        tx += dx
        ty += dy
        if math.hypot(dx, dy) < 1e-6:
            break
    return tx, ty


def summarise(distances: np.ndarray) -> dict:
    """Percentiles of a separation, or an explicit statement that there is none."""
    finite = distances[np.isfinite(distances)]
    if finite.size == 0:
        return {"measured": False, "reason": "no finite separations to summarise"}
    return {
        "measured": True,
        "points": int(finite.size),
        "median_m": round(float(np.median(finite)), 3),
        "p90_m": round(float(np.percentile(finite, 90)), 3),
        "max_m": round(float(np.max(finite)), 3),
        "mean_m": round(float(np.mean(finite)), 3),
    }


# ─────────────────────────────────────────────────────────────────────────────
# The stored boundary
# ─────────────────────────────────────────────────────────────────────────────

def _clean(values) -> np.ndarray:
    """Postgres REAL[] with NULLs -> float array with NaN. Missing ≠ zero."""
    return np.array([np.nan if v is None else float(v) for v in values], dtype=np.float64)


def load_boundary(conn, track: str) -> dict:
    row = conn.execute(
        """
        SELECT track_name, origin_lat, origin_lon, track_length_km, grid_pct,
               centre_x_m, centre_y_m, normal_x, normal_y, left_m, right_m,
               sessions_contributed, laps_contributed
        FROM track_boundaries WHERE track_name=%s LIMIT 1
        """,
        (track,),
    ).fetchone()
    if row is None:
        raise SystemExit(
            f'no stored boundary for "{track}". --list shows the tracks that have one.'
        )

    left = discard_outward_spikes(_clean(row[9]), "left")
    right = discard_outward_spikes(_clean(row[10]), "right")
    return {
        "track_name": row[0],
        "origin_lat": float(row[1]),
        "origin_lon": float(row[2]),
        "track_length_km": None if row[3] is None else float(row[3]),
        "grid_pct": _clean(row[4]),
        "centre_x": _clean(row[5]),
        "centre_y": _clean(row[6]),
        "normal_x": _clean(row[7]),
        "normal_y": _clean(row[8]),
        "left_m": left,
        "right_m": right,
        "sessions_contributed": int(row[11]),
        "laps_contributed": int(row[12]),
    }


def edge_points(b: dict, side: str):
    """The measured edge of the road you used, as points in the stored frame."""
    offs = b["left_m"] if side == "left" else b["right_m"]
    keep = np.isfinite(offs) & np.isfinite(b["centre_x"]) & np.isfinite(b["centre_y"])
    return (
        b["centre_x"][keep] + b["normal_x"][keep] * offs[keep],
        b["centre_y"][keep] + b["normal_y"][keep] * offs[keep],
    )


# ─────────────────────────────────────────────────────────────────────────────
# OpenStreetMap
# ─────────────────────────────────────────────────────────────────────────────

def fetch_osm(lat: float, lon: float, radius_m: int, endpoint: str) -> dict:
    """Every raceway way near a point, with its geometry and its tags.

    `area:highway=raceway` is asked for alongside `highway=raceway` because it
    is the ONLY tag that carries the road's real edges — and it is a proposed
    tag with thin adoption, so its absence is the expected case and is reported
    rather than worked around.
    """
    query = f"""
[out:json][timeout:90];
(
  way["highway"="raceway"](around:{radius_m},{lat},{lon});
  way["area:highway"="raceway"](around:{radius_m},{lat},{lon});
);
out geom tags;
"""
    req = urllib.request.Request(
        endpoint,
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "proctor-osm-comparison/1.0 (dev tool)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"could not reach Overpass at {endpoint}: {exc}\n"
            "This tool needs outbound network. Run it on the rig, or pass a saved "
            "response with --osm-json."
        )


def ways_from(osm: dict) -> list[dict]:
    out = []
    for el in osm.get("elements", []):
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        out.append({
            "id": el.get("id"),
            "tags": el.get("tags") or {},
            "lat": np.array([p["lat"] for p in geom], dtype=np.float64),
            "lon": np.array([p["lon"] for p in geom], dtype=np.float64),
        })
    return out


def _tag_width_m(tags: dict) -> float | None:
    raw = tags.get("width") or tags.get("est_width")
    if raw is None:
        return None
    try:
        return float(str(raw).split()[0])
    except (ValueError, IndexError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# The comparison
# ─────────────────────────────────────────────────────────────────────────────

def compare(b: dict, ways: list[dict]) -> dict:
    cx, cy = b["centre_x"], b["centre_y"]
    keep = np.isfinite(cx) & np.isfinite(cy)
    cx, cy = cx[keep], cy[keep]

    per_way = []
    for w in ways:
        wx, wy = to_local(w["lat"], w["lon"], b["origin_lat"], b["origin_lon"])
        d = point_polyline_distance(cx, cy, wx, wy)
        per_way.append({
            "id": w["id"],
            "name": w["tags"].get("name"),
            "highway": w["tags"].get("highway"),
            "area_highway": w["tags"].get("area:highway"),
            "width_tag_m": _tag_width_m(w["tags"]),
            "nodes": int(w["lat"].size),
            "median_separation_m": round(float(np.median(d)), 3),
            "x": wx, "y": wy,
        })

    near = [w for w in per_way if w["median_separation_m"] <= NEARBY_WAY_M]
    if not near:
        return {
            "matched": False,
            "reason": (
                "no mapped raceway lies within "
                f"{NEARBY_WAY_M:.0f} m of the road you drove. Either this circuit is "
                "not in OpenStreetMap, or what is there is a different layout."
            ),
            "ways_considered": [_public(w) for w in per_way],
        }

    # Distance to the UNION of the nearby ways: a real circuit is routinely
    # split across several ways (surface changes, bridges, pit entry), and
    # scoring against one of them alone would report the joins as error.
    polylines = [(w["x"], w["y"]) for w in near]
    raw = np.min(
        np.vstack([point_polyline_distance(cx, cy, wx, wy) for wx, wy in polylines]),
        axis=0,
    )
    shift_x, shift_y = fit_translation(cx, cy, polylines)
    shifted = [
        point_polyline_distance(cx + shift_x, cy + shift_y, w["x"], w["y"]) for w in near
    ]
    residual = np.min(np.vstack(shifted), axis=0)

    return {
        "matched": True,
        "ways_used": [_public(w) for w in near],
        "ways_rejected_as_other_roads": [
            _public(w) for w in per_way if w not in near
        ],
        "raw_separation": summarise(raw),
        "translation_only": {
            "shift_east_m": round(shift_x, 3),
            "shift_north_m": round(shift_y, 3),
            "shift_magnitude_m": round(math.hypot(shift_x, shift_y), 3),
            "residual": summarise(residual),
            "note": (
                "Reported BESIDE the raw separation, never instead of it. A large "
                "raw offset with a small residual means one dataset sits on a "
                "different datum; a large residual means the shapes themselves "
                "disagree. No rotation or scale is fitted."
            ),
        },
    }


def _public(w: dict) -> dict:
    return {k: v for k, v in w.items() if k not in ("x", "y")}


def width_comparison(b: dict, result: dict) -> dict:
    """What you measured against what OSM claims, where OSM claims anything.

    Proctor's band is the road you were observed to use, so it is a LOWER bound
    on the road's width and can never legitimately exceed it. A band wider than
    the tagged width is therefore evidence about the tag or the alignment, not
    about the circuit — which is the most useful thing this check produces.
    """
    span = b["left_m"] - b["right_m"]      # right_m runs negative
    span = span[np.isfinite(span)]
    used = {
        "measured": bool(span.size),
        "bins": int(span.size),
        "median_m": round(float(np.median(span)), 2) if span.size else None,
        "p90_m": round(float(np.percentile(span, 90)), 2) if span.size else None,
        "max_m": round(float(np.max(span)), 2) if span.size else None,
        "what_it_is": "the widest band of road you were observed to use, per bin",
    }

    tagged = [
        w["width_tag_m"] for w in result.get("ways_used", []) if w.get("width_tag_m")
    ]
    areas = [w for w in result.get("ways_used", []) if w.get("area_highway")]
    return {
        "road_you_used": used,
        "osm_width_tag_m": tagged or None,
        "osm_has_surface_polygon": bool(areas),
        "note": (
            "OSM's width tag is documented but thinly used, and area:highway=raceway "
            "— the only tag carrying real edges — is a proposal. Absence here is the "
            "expected case, not a fetch failure."
        ),
        "band_exceeds_tag": (
            bool(tagged and used["max_m"] and used["max_m"] > min(tagged))
            if tagged else None
        ),
    }


def verdict(result: dict) -> str:
    """A reading of the numbers. Deliberately blunt, including when it says no."""
    if not result.get("matched"):
        return "NO MATCH — " + result["reason"]
    raw = result["raw_separation"]
    if not raw["measured"]:
        return "NO MEASUREMENT — nothing finite to compare."
    med = raw["median_m"]
    res = result["translation_only"]["residual"]
    shift = result["translation_only"]["shift_magnitude_m"]
    if med <= 1.0:
        return (
            f"AGREES — median {med} m. Tight enough that an overlay would not "
            "misplace a lap. Worth building, with the source and its accuracy on screen."
        )
    if res.get("measured") and res["median_m"] <= 1.0 and shift > 1.0:
        return (
            f"SHIFTED — median {med} m raw, but {res['median_m']} m after a "
            f"{shift} m translation. The shapes agree; one dataset sits on a "
            "different datum. Worth investigating before deciding."
        )
    if med <= 3.0:
        return (
            f"MARGINAL — median {med} m, p90 {raw['p90_m']} m. That is a car's "
            "width of doubt; an overlay could draw a clean lap running wide."
        )
    return (
        f"DISAGREES — median {med} m, p90 {raw['p90_m']} m. Too loose to draw "
        "against a laser-scanned line. This closes the question."
    )


# ─────────────────────────────────────────────────────────────────────────────
# The picture
# ─────────────────────────────────────────────────────────────────────────────

def write_svg(path: pathlib.Path, b: dict, ways: list[dict], result: dict) -> None:
    """Both datasets in one frame, to scale. Look at this before the numbers."""
    layers: list[tuple[str, np.ndarray, np.ndarray, str, float, float]] = []

    cx, cy = b["centre_x"], b["centre_y"]
    keep = np.isfinite(cx) & np.isfinite(cy)
    layers.append(("your centreline", cx[keep], cy[keep], "#b5abfc", 1.6, 1.0))
    for side, colour in (("left", "#6fbf8f"), ("right", "#e0a86a")):
        ex, ey = edge_points(b, side)
        if ex.size > 1:
            layers.append((f"your {side} edge", ex, ey, colour, 1.1, 0.9))

    used_ids = {w["id"] for w in result.get("ways_used", [])}
    for w in ways:
        wx, wy = to_local(w["lat"], w["lon"], b["origin_lat"], b["origin_lon"])
        inside = w["id"] in used_ids
        layers.append((
            f"osm {w['id']}", wx, wy,
            "#e0685e" if inside else "#595d6c",
            1.4 if inside else 0.8,
            0.95 if inside else 0.45,
        ))

    # FRAME ON THE CIRCUIT, not on everything found. A rejected way can be
    # kilometres off — the smoke test's kart track sits 2.9 km away — and
    # letting it set the bounds shrinks the subject to a smudge in one corner.
    # The rejected ways are still DRAWN; they are simply not allowed to choose
    # the scale, so anything near enough to matter stays visible and anything
    # far enough to be irrelevant leaves the frame. (Written after looking at
    # the first render, which was unreadable while every number was correct.)
    framed = [l for l in layers if not l[0].startswith("osm ")] + [
        l for l in layers if l[0] in {f"osm {i}" for i in used_ids}
    ]
    xs = np.concatenate([l[1] for l in framed])
    ys = np.concatenate([l[2] for l in framed])
    pad = 40.0
    x0, x1 = float(xs.min()) - pad, float(xs.max()) + pad
    y0, y1 = float(ys.min()) - pad, float(ys.max()) + pad
    w_m, h_m = x1 - x0, y1 - y0
    scale = 1000.0 / max(w_m, h_m)
    W, H = w_m * scale, h_m * scale

    def path_of(px, py) -> str:
        # y is flipped: north is up on the page, down in SVG coordinates.
        pts = [f"{(x - x0) * scale:.1f},{(y1 - y) * scale:.1f}" for x, y in zip(px, py)]
        return "M " + " L ".join(pts)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H + 76:.0f}" '
        f'viewBox="0 0 {W:.0f} {H + 76:.0f}">',
        f'<rect width="100%" height="100%" fill="#161826"/>',
        f'<clipPath id="frame"><rect x="0" y="0" width="{W:.0f}" height="{H:.0f}"/></clipPath>',
        '<g clip-path="url(#frame)">',
    ]
    for name, px, py, colour, width, opacity in layers:
        parts.append(
            f'<path d="{path_of(px, py)}" fill="none" stroke="{colour}" '
            f'stroke-width="{width}" stroke-opacity="{opacity}" '
            f'stroke-linejoin="round" stroke-linecap="round"><title>{name}</title></path>'
        )
    parts.append("</g>")

    bar_m = 100.0
    parts.append(
        f'<g transform="translate(14,{H + 24:.0f})" font-family="system-ui,sans-serif">'
        f'<line x1="0" y1="0" x2="{bar_m * scale:.1f}" y2="0" stroke="#e9e9ed" stroke-width="2"/>'
        f'<text x="0" y="16" fill="#9397ab" font-size="11">{bar_m:.0f} m</text>'
        f'<text x="{bar_m * scale + 18:.1f}" y="4" fill="#b5abfc" font-size="11">'
        f'your centreline</text>'
        f'<text x="{bar_m * scale + 132:.1f}" y="4" fill="#e0685e" font-size="11">'
        f'osm (matched)</text>'
        f'<text x="{bar_m * scale + 240:.1f}" y="4" fill="#595d6c" font-size="11">'
        f'osm (other roads)</text>'
        f'<text x="0" y="36" fill="#75798c" font-size="11">{verdict(result)[:150]}</text>'
        f'</g></svg>'
    )
    path.write_text("\n".join(parts), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--track", help='stored track name, e.g. "Road Atlanta"')
    ap.add_argument("--list", action="store_true", help="tracks that have a boundary")
    ap.add_argument("--radius", type=int, default=2500, help="OSM search radius, metres")
    ap.add_argument("--out", default="osm-comparison", help="output directory")
    ap.add_argument("--overpass", default=DEFAULT_OVERPASS, help="Overpass endpoint")
    ap.add_argument("--osm-json", help="replay a saved Overpass response instead of fetching")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set.")

    import psycopg  # imported here so --help works without the driver

    with psycopg.connect(url) as conn:
        if args.list or not args.track:
            rows = conn.execute(
                "SELECT track_name, laps_contributed, sessions_contributed, "
                "track_length_km FROM track_boundaries ORDER BY track_name"
            ).fetchall()
            if not rows:
                print("no track boundaries stored yet.")
                return 1
            print(f"{'track':<34} {'laps':>6} {'sessions':>9}  length")
            for name, laps, sessions, km in rows:
                km_s = "—" if km is None else f"{float(km):.2f} km"
                print(f"{name:<34} {laps:>6} {sessions:>9}  {km_s}")
            if not args.track:
                print("\nPick one with --track.")
                return 0
        b = load_boundary(conn, args.track)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.osm_json:
        osm = json.loads(pathlib.Path(args.osm_json).read_text(encoding="utf-8"))
        source = f"replayed from {args.osm_json}"
    else:
        osm = fetch_osm(b["origin_lat"], b["origin_lon"], args.radius, args.overpass)
        (out / "overpass-response.json").write_text(json.dumps(osm), encoding="utf-8")
        source = f"{args.overpass} (around:{args.radius})"

    ways = ways_from(osm)
    result = compare(b, ways)

    report = {
        "track": b["track_name"],
        "origin": {"lat": b["origin_lat"], "lon": b["origin_lon"]},
        "your_boundary_built_from": {
            "laps": b["laps_contributed"],
            "sessions": b["sessions_contributed"],
        },
        "osm_source": source,
        "osm_ways_found": len(ways),
        "comparison": {k: v for k, v in result.items()},
        "width": width_comparison(b, result),
        "verdict": verdict(result),
    }
    (out / "comparison.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    if ways:
        write_svg(out / "comparison.svg", b, ways, result)

    print(f"\n{b['track_name']} — boundary from {b['laps_contributed']} laps "
          f"across {b['sessions_contributed']} sessions")
    print(f"OSM ways found within {args.radius} m: {len(ways)}")
    if result.get("matched"):
        raw = result["raw_separation"]
        tr = result["translation_only"]
        print(f"  raw separation      median {raw['median_m']} m  "
              f"p90 {raw['p90_m']} m  max {raw['max_m']} m")
        print(f"  after {tr['shift_magnitude_m']} m shift  "
              f"median {tr['residual'].get('median_m')} m")
    w = report["width"]
    if w["road_you_used"]["measured"]:
        print(f"  road you used       median {w['road_you_used']['median_m']} m  "
              f"max {w['road_you_used']['max_m']} m")
    print(f"  osm width tag       {w['osm_width_tag_m'] or 'not tagged'}")
    print(f"  osm surface polygon {'yes' if w['osm_has_surface_polygon'] else 'no'}")
    print(f"\n{report['verdict']}\n")
    print(f"wrote {out}/comparison.json" + (f" and {out}/comparison.svg" if ways else ""))
    print("LOOK AT THE SVG before trusting the percentiles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
