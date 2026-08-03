"""Merge one session's measured track edges into the per-track boundary.

The track_edges module reports what ONE session learned about where the racing
surface reaches. This is where those findings accumulate, so a circuit gets
better described every time it is driven instead of starting from nothing.

The merge is a widening, never a replacement:

    stored_left[i]  = max(stored_left[i],  this_session_left[i])
    stored_right[i] = min(stored_right[i], this_session_right[i])

with NULL meaning "nothing has ever been measured in this bin" on either side,
so a session that covers new ground fills it in and a session that covers less
leaves it alone. Nothing here ever narrows a boundary: the edges only move
outward, because a lap that stayed in the middle is not evidence that the road
got smaller.

FRAMES. Each session projects GPS about its own reference lap's centroid, so two
sessions at the same track have origins metres apart and centrelines that differ
by whatever the two reference laps did. Offsets from one are therefore not
comparable with offsets from the other. That is why track_edges also emits the
winning edge POSITIONS as lat/lon: this module re-projects those into the frame
the track was FIRST stored in and re-measures them against the stored
centreline. The first session to reach a track defines the frame; every later
one is translated into it.
"""

from __future__ import annotations

import math

# Same projection constant as the parser's track_map, corners and track_edges.
_M_PER_DEG = 111320.0

# A re-projected edge further than this from the stored centreline is not the
# track: it is a GPS dropout, or two different layouts sharing a track name.
_MAX_PLAUSIBLE_OFFSET_M = 60.0


def _usable(payload: dict | None) -> bool:
    return bool(
        payload
        and not payload.get("insufficient_data")
        and not payload.get("error")
        and payload.get("grid_pct")
        and payload.get("origin")
    )


def _offsets_in_frame(
    payload: dict,
    origin: tuple[float, float],
    centre_x: list,
    centre_y: list,
    normal_x: list,
    normal_y: list,
    side: str,
) -> list[float | None]:
    """This session's `side` edge positions, measured in the stored frame."""
    lats = payload.get(f"{side}_lat") or []
    lons = payload.get(f"{side}_lon") or []
    n = min(len(lats), len(lons), len(centre_x), len(centre_y))

    origin_lat, origin_lon = origin
    scale_x = _M_PER_DEG * math.cos(math.radians(origin_lat))

    out: list[float | None] = [None] * n
    for i in range(n):
        lat, lon = lats[i], lons[i]
        if lat is None or lon is None:
            continue
        px = (lon - origin_lon) * scale_x
        py = (lat - origin_lat) * _M_PER_DEG
        offset = (px - centre_x[i]) * normal_x[i] + (py - centre_y[i]) * normal_y[i]
        if abs(offset) <= _MAX_PLAUSIBLE_OFFSET_M:
            out[i] = round(offset, 2)
    return out


def _widen(stored: list, incoming: list, keep: str) -> list[float | None]:
    """Elementwise max (left) or min (right), with NULL meaning unmeasured."""
    n = max(len(stored), len(incoming))
    out: list[float | None] = []
    for i in range(n):
        a = stored[i] if i < len(stored) else None
        b = incoming[i] if i < len(incoming) else None
        if a is None:
            out.append(b)
        elif b is None:
            out.append(a)
        else:
            out.append(max(a, b) if keep == "left" else min(a, b))
    return out


def merge_session(conn, user_id: str, track_name: str | None,
                  track_length_km: float | None, payload: dict | None) -> None:
    """Fold one session's track_edges payload into its track's boundary.

    Silent no-op when there is nothing to fold: a session on a nameless track,
    or a file whose .ibt never carried PlayerTrackSurface. Those are already
    reported honestly by the module itself; there is nothing to add here.
    """
    if not track_name or not _usable(payload):
        return

    lap_count = len(payload.get("laps_used") or [])
    row = conn.execute(
        """
        SELECT origin_lat, origin_lon, centre_x_m, centre_y_m,
               normal_x, normal_y, left_m, right_m
        FROM track_boundaries WHERE user_id=%s AND track_name=%s
        """,
        (user_id, track_name),
    ).fetchone()

    if row is None:
        # First session at this track: its frame becomes the canonical one.
        conn.execute(
            """
            INSERT INTO track_boundaries (
                user_id, track_name, origin_lat, origin_lon, track_length_km,
                grid_pct, centre_x_m, centre_y_m, normal_x, normal_y,
                left_m, right_m, sessions_contributed, laps_contributed)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s)
            """,
            (
                user_id, track_name,
                payload["origin"]["lat"], payload["origin"]["lon"], track_length_km,
                payload["grid_pct"], payload["centre_x_m"], payload["centre_y_m"],
                payload["normal_x"], payload["normal_y"],
                payload["left_m"], payload["right_m"], lap_count,
            ),
        )
        return

    origin = (float(row[0]), float(row[1]))
    centre_x, centre_y, normal_x, normal_y = list(row[2]), list(row[3]), list(row[4]), list(row[5])
    stored_left, stored_right = list(row[6]), list(row[7])

    # A layout change under the same name would misalign every bin. The grid is
    # always 1000 points, so a mismatch means something is wrong; leave the
    # stored boundary untouched rather than corrupt it.
    if len(payload["grid_pct"]) != len(centre_x):
        return

    incoming_left = _offsets_in_frame(
        payload, origin, centre_x, centre_y, normal_x, normal_y, "left"
    )
    incoming_right = _offsets_in_frame(
        payload, origin, centre_x, centre_y, normal_x, normal_y, "right"
    )

    conn.execute(
        """
        UPDATE track_boundaries
           SET left_m = %s,
               right_m = %s,
               sessions_contributed = sessions_contributed + 1,
               laps_contributed = laps_contributed + %s,
               updated_at = now()
         WHERE user_id = %s AND track_name = %s
        """,
        (
            _widen(stored_left, incoming_left, "left"),
            _widen(stored_right, incoming_right, "right"),
            lap_count, user_id, track_name,
        ),
    )
