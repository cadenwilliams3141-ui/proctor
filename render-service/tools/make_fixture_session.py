"""Build realistic synthetic sessions and push them through the REAL ingest path.

DEV TOOL. Nothing in the product imports this and it never runs on Render.

Not a UI fixture. The bytes go parser -> compute_all -> Postgres exactly as an
uploaded .ibt does, so every screen is then exercised against the real shaping
code, the real absence machinery and the real API routes rather than against
hand-written JSON. That distinction is the whole point: the honesty rules live
in the seam between a module's payload and what a screen makes of it, and a
hand-written bundle steps over that seam.

    createdb proctordb
    psql "$DATABASE_URL" -f migrations/001_init.sql
    psql "$DATABASE_URL" -f migrations/002_track_boundaries.sql
    DATABASE_URL=... python render-service/tools/make_fixture_session.py

Writes three sessions, chosen because they are the three shapes that break
different things:

  1. twelve laps, nine of them clean, one flagged  -> the healthy case
  2. four laps, two clean                          -> a thin session
  3. two laps, NONE clean                          -> no reference lap exists,
                                                      which is what exposes a
                                                      spinner that never
                                                      resolves

TWO TRAPS THIS FILE EXISTS TO AVOID REPEATING. Both were hit while writing it,
and both produce a fixture that renders without complaint and proves nothing:

  * tests.synthetic.make_core_channels holds speed CONSTANT, so no corner is
    ever detected and every corner-shaped module reports insufficient_data.
  * it also uses a fixed ticks_per_lap, so every lap takes exactly the same
    time and the Analyze screen reads "0 of 12 corners costing time" with every
    delta at +0.000.

So this builds lap by lap with a per-lap tick count, and the corners alternate
left/right — which is realistic AND is what lets the fixture see a bug that is
symmetric in steering sign (see the FFB clipping fix of 2026-09-01: a
one-directional fixture could not tell the broken code from the fixed code).
"""
import sys, pathlib, numpy as np

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT / "parser"))
sys.path.insert(0, str(_ROOT / "render-service"))

from tests.synthetic import build_ibt, make_core_channels

R_LAT, R_LON = 33.80, -84.27          # Road-Atlanta-ish corner of the world
N_CORNERS = 6


def circuit(n_laps=12, ticks_per_lap=900, slow_lap=None, incident_lap=None,
            clean=True):
    """A lap-by-lap build, so laps can differ in LENGTH and therefore in TIME.

    make_core_channels uses a fixed ticks_per_lap, which makes every lap take
    exactly the same time — the Analyze screen then reads "0 of 12 corners
    costing time" and every delta is +0.000, which tells you nothing about
    whether the screen works. Here each lap gets its own tick count.
    """
    base = make_core_channels(n_laps=2, ticks_per_lap=ticks_per_lap)
    keys = list(base.keys())
    per_lap = {k: [] for k in keys}

    rng = np.random.default_rng(7)
    for L in range(n_laps):
        # Lap 0 is the out lap; the last lap is deliberately partial.
        pace = 1.0 + 0.028 * rng.random() + (0.06 if L == 0 else 0.0)
        if slow_lap is not None and L == slow_lap:
            pace += 0.22                       # a scruffy lap, clearly slower
        m = int(round(ticks_per_lap * pace))
        if L == n_laps - 1:
            m = int(m * 0.4)                   # partial
        t = np.arange(m)
        d = t / (ticks_per_lap * pace)          # 0..1 round the lap
        tau = 2 * np.pi * d
        turn = np.sin(N_CORNERS * tau)
        cp = np.abs(turn)
        speed = (62.0 - 26.0 * cp ** 1.4) / pace
        if L == 0:
            speed[:10] = 0.0
        if not clean:
            speed[t > m * 0.5] *= 0.25

        on = speed > 0.001
        decel = np.gradient(speed)
        steer = 0.62 * turn * cp
        lat = steer * speed * 0.62
        brake = np.clip(-decel * 6.0, 0, 1) * on
        brake_raw = brake.copy()
        if L == 0:
            brake[:10] = 1.0
            brake_raw[:10] = 0.0
        rx = 900.0 + 260.0 * np.sin(3 * tau)
        stops = np.clip(np.clip(lat / 9.0, -1.4, 1.4), -1.0, 1.0)

        vals = {
            "Lap": np.full(m, float(L)),
            "LapDistPct": np.clip(d, 0, 0.9999),
            "Speed": speed,
            "Throttle": np.clip(decel * 6.0 + 0.35, 0, 1) * on,
            "Brake": brake,
            "BrakeRaw": brake_raw,
            "SteeringWheelAngle": steer,
            "Gear": np.clip(np.round(speed / 13.0), 1, 6).astype(float),
            "RPM": 3200 + (speed / 62.0) * 4600,
            "LatAccel": lat,
            "LongAccel": decel * 55.0,
            "VertAccel": -(9.81 + 5.5 * (speed / 62.0) ** 2),
            "YawRate": lat / np.clip(speed, 1, None),
            "Yaw": np.cumsum(lat / np.clip(speed, 1, None)) * 0.016,
            "VelocityX": speed,
            "VelocityY": speed * 0.052 * turn * cp,
            "Lat": R_LAT + (700.0 * np.sin(tau) + 150.0 * np.sin(2 * tau)) / 111320.0,
            "Lon": R_LON + (rx * np.cos(tau)) / (111320.0 * np.cos(np.radians(R_LAT))),
            "Alt": 300.0 + 32.0 * np.sin(tau) + 9.0 * np.sin(4 * tau),
            "FuelLevel": np.full(m, 78.0 - 3.9 * L),
            "LFspeed": np.where(brake_raw > 0.55, speed * 0.42, speed),
            "RFspeed": speed.copy(),
            "LRspeed": speed.copy(),
            "RRspeed": np.where(np.clip(decel * 6.0 + 0.35, 0, 1) * on > 0.85, speed * 1.16, speed),
            "BrakeABSactive": (brake_raw > 0.7).astype(float),
            "BrakeABScutPct": np.where(brake_raw > 0.7, 12.0, 0.0),
            "dcBrakeBias": np.full(m, 50.8 if L < n_laps // 2 else 52.0),
            "ShiftIndicatorPct": np.zeros(m),
            "ShiftGrindRPM": np.zeros(m),
            "SteeringWheelPctTorqueSignStops": stops,
            "SteeringWheelPctTorque": np.abs(stops),
            "SteeringWheelTorque": np.sign(steer) * np.where(np.abs(steer) > 0.40, 6.5,
                                                             2.0 + 18.0 * np.abs(steer)),
            "LFtempL": np.full(m, 78.0) + 6 * cp + L * 0.4,
            "LFtempM": np.full(m, 86.0) + 6 * cp + L * 0.4,
            "LFtempR": np.full(m, 94.0) + 6 * cp + L * 0.4,
            "PlayerCarMyIncidentCount": np.full(m, 4.0 if (incident_lap is not None and L > incident_lap) else 0.0),
            "SessionNum": np.zeros(m),
            "OnPitRoad": (np.arange(m) < 10) & (L == 0),
            "FrameRate": np.where(np.arange(m) % 2200 < 24, 52.0, 141.0),
            "PlayerTrackSurface": np.where((np.arange(m) < 10) & (L == 0), 1.0, 3.0),
            "PlayerTrackSurfaceMaterial": np.full(m, 1.0),
        }
        # a worn brake sensor bleeding on the straights
        br = vals["BrakeRaw"].copy()
        straight = (vals["Throttle"] > 0.9) & (br < 0.05)
        si = np.where(straight)[0][::37]
        br[si] = 0.004
        vals["BrakeRaw"] = br

        for k in keys:
            if k in vals:
                per_lap[k].append(np.asarray(vals[k], dtype=float))
            else:
                # anything the synthetic carries that this builder does not name
                per_lap[k].append(np.full(m, float(np.asarray(base[k]).ravel()[0])))

    return {k: np.concatenate(v) for k, v in per_lap.items()}


def main():
    from app.ingest import process_file
    from app.db import connect

    conn = connect()
    for filename, kwargs in [
        ("porsche992rgt3_roadatlanta full 2026-08-30 19-04-11.ibt",
         dict(n_laps=12, slow_lap=7, incident_lap=9, clean=True)),
        ("porsche992rgt3_roadatlanta full 2026-08-30 20-11-02.ibt",
         dict(n_laps=4, slow_lap=None, incident_lap=None, clean=False)),
        ("porsche992rgt3_roadatlanta full 2026-08-30 21-40-00.ibt",
         dict(n_laps=2, slow_lap=None, incident_lap=0, clean=False)),
    ]:
        data = build_ibt(circuit(**kwargs))
        row = conn.execute(
            "INSERT INTO ingest_files (user_id, filename, sha256) VALUES (%s,%s,%s) RETURNING id",
            ("caden", filename, filename),
        ).fetchone()
        process_file(row[0], filename, data, "caden")
        st = conn.execute("SELECT status, error_detail FROM ingest_files WHERE id=%s",
                          (row[0],)).fetchone()
        print(f"{filename[:52]:52s} -> {st[0]}  {st[1] or ''}")

    for r in conn.execute(
        "SELECT s.id, s.track_name, count(l.id) FROM sessions s "
        "LEFT JOIN laps l ON l.session_id=s.id GROUP BY s.id, s.track_name ORDER BY s.id"
    ).fetchall():
        print("session", r)
    print("metric keys:", [r[0] for r in conn.execute(
        "SELECT DISTINCT metric_key FROM session_metrics ORDER BY 1").fetchall()])


main()
