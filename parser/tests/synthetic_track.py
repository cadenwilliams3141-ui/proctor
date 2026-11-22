"""A kinematic lap generator: laps that are physically self-consistent, with
known truths planted in them.

WHY THIS EXISTS. `make_core_channels` drives at constant speed on a straight
line with identical lap times, so it cannot test anything about corners, brake
points or lap time. Here every lap is DRIVEN: a speed profile is solved on a
closed circuit the way a lap-time simulator does it (corner speed limits, a
forward pass with acceleration limits, a backward pass with braking limits),
time is integrated from that profile, and every channel is derived from the
same motion. So tick counts, lap times, LapDistPct, GPS, heading, yaw rate,
lateral and longitudinal g and wheel speeds all agree with each other, and the
start/finish line falls between ticks the way it does in a real file.

Per-lap, per-corner knobs plant known truths — braking harder (and so later),
carrying more minimum speed, picking up the throttle late, coasting, a lockup,
a slide, an off-track shortcut, a tow on the straight, being held up — and
`DrivenSession.truth` returns what was planted so a test can demand it back.

Nothing here is a model of any real car. The numbers are plausible, not
calibrated; the point is that the analysis never sees them, only the channels.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from tests.synthetic import build_ibt

G = 9.81
DS = 0.25            # station spacing, metres
TICK_RATE = 60
MU_LAT = 1.5         # lateral grip used to set corner speeds
V_TOP = 69.0         # m/s
A_ACC0 = 6.5         # m/s^2 at standstill, falling with speed^2
A_BRAKE = 14.0       # m/s^2 baseline braking
A_COAST = 0.8        # m/s^2 rolling/aero deceleration with no pedal
BRAKE_FULL = 16.0    # m/s^2 that corresponds to 100% brake pedal
STEER_RATIO = 14.0
WHEELBASE = 2.7
GEAR_UP = (0.0, 20.0, 29.0, 38.0, 47.0, 56.0)   # speed at which each gear starts
GEAR_RPM_PER_MS = (0.0, 380.0, 270.0, 205.0, 165.0, 138.0, 118.0)
REDLINE = 8500.0

# A closed, clockwise circuit. ("S", length) is a straight; ("A", radius,
# degrees, corner_id) is an arc (negative degrees = right turn). Arcs sharing a
# corner_id are one corner (the chicane). The total turning is exactly -360.
DEFAULT_LAYOUT = (
    ("S", 600.0),
    ("A", 30.0, -90.0, 1),     # T1: slow right
    ("S", 300.0),
    ("A", 80.0, -90.0, 2),     # T2: medium right
    ("S", 260.0),
    ("A", 40.0, 40.0, 3),      # T3a: chicane, left
    ("S", 20.0),
    ("A", 40.0, -40.0, 3),     # T3b: chicane, right
    ("S", 350.0),
    ("A", 400.0, -12.0, 0),    # kink: flat out (corner id 0 = not a corner)
    ("S", 300.0),
    ("A", 60.0, -90.0, 4),     # T4
    ("S", 400.0),
    ("A", 120.0, -78.0, 5),    # T5: fast right
    ("S", 200.0),
)


@dataclass
class Knob:
    """What one lap does differently at one corner."""
    decel: float = 0.0       # m/s^2 added to braking (harder = later brake point)
    vmin: float = 0.0        # m/s added to the corner's minimum speed
    pickup_m: float = 0.0    # metres the throttle pickup is delayed past the arc end
    coast_m: float = 0.0     # metres coasted (no pedal) before the brake point
    lockup: bool = False     # left front locks for a quarter second mid-braking
    slide: bool = False      # a slide with countersteer near the apex
    pump: bool = False       # brake released and re-applied in the braking zone
    hesitate: bool = False   # throttle lifted again after pickup
    kerb: bool = False       # a kerb strike at the apex
    cut_m: float = 0.0       # an off-track shortcut: metres of centreline skipped
    tow: float = 0.0         # extra acceleration fraction on the straight BEFORE this corner
    held_up: bool = False    # a lift mid-straight BEFORE this corner (traffic)
    incident: bool = False   # an incident point registered at this corner


@dataclass
class Corner:
    id: int
    start_m: float
    end_m: float
    apex_m: float
    radius_m: float
    direction: str
    vmin: float


@dataclass
class Track:
    length_m: float
    s: np.ndarray
    k: np.ndarray            # signed curvature, 1/m (positive = left)
    k_smooth: np.ndarray
    heading: np.ndarray
    x: np.ndarray
    y: np.ndarray
    corners: list[Corner]
    corner_of: np.ndarray    # corner id at each station (0 = none)
    v_corner: np.ndarray     # corner speed limit at each station


def build_track(layout=DEFAULT_LAYOUT) -> Track:
    lengths, curv, ids = [], [], []
    for el in layout:
        if el[0] == "S":
            n = int(round(el[1] / DS))
            lengths.append(n); curv.append(0.0); ids.append(0)
        else:
            _, r, deg, cid = el
            arc = abs(np.radians(deg)) * r
            n = int(round(arc / DS))
            lengths.append(n); curv.append(np.sign(deg) / r); ids.append(cid)
    k = np.concatenate([np.full(n, c) for n, c in zip(lengths, curv)])
    corner_of = np.concatenate([np.full(n, cid, dtype=np.int64) for n, cid in zip(lengths, ids)])
    N = len(k)
    s = np.arange(N) * DS
    L = N * DS

    # Turn-in is not instantaneous: steering, yaw and lateral g follow a
    # curvature smoothed over ~12 m, circularly.
    w = int(12.0 / DS)
    kk = np.concatenate([k[-w:], k, k[:w]])
    k_smooth = np.convolve(kk, np.ones(w) / w, mode="same")[w:-w]

    heading = np.cumsum(k_smooth) * DS
    heading -= heading[0]
    x = np.cumsum(np.cos(heading)) * DS
    y = np.cumsum(np.sin(heading)) * DS
    # Close the loop: spread the small residual gap linearly over the lap.
    frac = s / L
    x -= (x[-1] + np.cos(heading[-1]) * DS - x[0]) * frac
    y -= (y[-1] + np.sin(heading[-1]) * DS - y[0]) * frac

    v_corner = np.full(N, np.inf)
    curved = np.abs(k) > 0
    v_corner[curved] = np.sqrt(MU_LAT * G / np.abs(k[curved]))

    corners = []
    for cid in sorted(set(int(c) for c in corner_of) - {0}):
        idx = np.flatnonzero(corner_of == cid)
        r = float(np.min(1.0 / np.abs(k[idx])))
        vmin = float(np.min(v_corner[idx]))
        # The "apex" is the middle of the slowest arc of the corner.
        slow = idx[v_corner[idx] <= vmin + 1e-9]
        corners.append(Corner(
            id=cid, start_m=float(s[idx[0]]), end_m=float(s[idx[-1]]),
            apex_m=float(s[slow[len(slow) // 2]]), radius_m=r,
            direction="right" if k[idx[len(idx) // 2]] < 0 else "left",
            vmin=min(vmin, V_TOP),
        ))
    return Track(L, s, k, k_smooth, heading, x, y, corners, corner_of, v_corner)


def _accel(v, boost: float = 0.0):
    """Drive force falls with speed squared (drag). A tow adds both thrust and
    top speed, the signature the watcher looks for."""
    v_top = V_TOP + 30.0 * boost
    return A_ACC0 * (1.0 + boost) * np.maximum(0.0, 1.0 - (v / (v_top + 3.0)) ** 2)


def _next_corner(track: Track) -> np.ndarray:
    """For each station, the id of the next corner at or ahead of it."""
    N = len(track.s)
    out = np.zeros(N, dtype=np.int64)
    nxt = 0
    for i in range(2 * N - 1, -1, -1):
        c = track.corner_of[i % N]
        if c:
            nxt = c
        if i < N:
            out[i] = nxt
    return out


def _straight_before(track: Track, cid: int) -> np.ndarray:
    """Mask of the straight leading into corner `cid`, back to the previous corner."""
    N = len(track.s)
    start = int(np.flatnonzero(track.corner_of == cid)[0])
    mask = np.zeros(N, dtype=bool)
    i = (start - 1) % N
    while track.corner_of[i] == 0 and not mask[i]:
        mask[i] = True
        i = (i - 1) % N
    return mask


def drive_lap(track: Track, knobs: dict[int, Knob], rng: np.random.Generator | None,
              noise: float, thrust_noise: float = 0.0) -> dict[str, np.ndarray]:
    """Solve one lap's speed and inputs on the station grid.

    `thrust_noise` varies the car's straight-line thrust from lap to lap (a
    stand-in for wind, tyre state, anything the driver did not do): lap time
    moves, and no driver input explains it."""
    N = len(track.s)
    nxt = _next_corner(track)
    v_lim = np.minimum(track.v_corner, V_TOP).copy()
    decel = np.full(N, A_BRAKE)
    boost = np.zeros(N)
    if thrust_noise > 0 and rng is not None:
        boost[:] = rng.normal(0.0, thrust_noise)
    holds: list[np.ndarray] = []

    for c in track.corners:
        kn = knobs.get(c.id, Knob())
        dv = kn.vmin + (rng.normal(0, 0.25 * noise) if rng is not None else 0.0)
        dd = kn.decel + (rng.normal(0, 0.35 * noise) if rng is not None else 0.0)
        idx = track.corner_of == c.id
        v_lim[idx] = np.minimum(track.v_corner[idx] + dv, V_TOP)
        if kn.pickup_m > 0:
            end = int(np.flatnonzero(idx)[-1])
            ext = np.arange(end + 1, end + 1 + int(kn.pickup_m / DS)) % N
            v_lim[ext] = np.minimum(v_lim[ext], v_lim[end])
        decel[nxt == c.id] = A_BRAKE + dd
        if kn.tow > 0:
            boost[_straight_before(track, c.id)] = kn.tow
        if kn.held_up:
            sb = np.flatnonzero(_straight_before(track, c.id))
            if sb.size > 200:
                mid = sb[len(sb) // 2]
                holds.append(np.arange(mid, mid + int(30 / DS)) % N)

    def fwd(v):
        for i in range(1, 2 * N):
            j, p = i % N, (i - 1) % N
            cap = np.sqrt(v[p] ** 2 + 2.0 * _accel(v[p], boost[j]) * DS)
            if cap < v[j]:
                v[j] = cap
        return v

    def bwd(v, a):
        for i in range(2 * N - 2, -1, -1):
            j, q = i % N, (i + 1) % N
            cap = np.sqrt(v[q] ** 2 + 2.0 * a[j] * DS)
            if cap < v[j]:
                v[j] = cap
        return v

    v_fwd = fwd(v_lim.copy())
    # Being held up: a temporary cap at 82% of the speed the car would have had.
    if holds:
        for zone in holds:
            v_lim[zone] = 0.82 * v_fwd[zone]
        v_fwd = fwd(np.minimum(v_lim, v_fwd))
    v = bwd(v_fwd.copy(), decel)
    braking = v < v_fwd - 1e-6

    # Coasting: lift early, roll with no pedal, then brake.
    coast = np.zeros(N, dtype=bool)
    for c in track.corners:
        kn = knobs.get(c.id, Knob())
        if kn.coast_m <= 0:
            continue
        # The braking run is the contiguous block just before the corner.
        cidx = int(np.flatnonzero(track.corner_of == c.id)[0])
        run = []
        i = (cidx - 1) % N
        while braking[i] and len(run) < N:
            run.append(i)
            i = (i - 1) % N
        if not run:
            continue
        start = run[-1]
        n_coast = int(kn.coast_m / DS)
        # Backward from the brake point at coasting deceleration.
        for m in range(1, n_coast + 1):
            j, q = (start - m) % N, (start - m + 1) % N
            cap = np.sqrt(v[q] ** 2 + 2.0 * A_COAST * DS)
            if cap < v[j]:
                v[j] = cap
            coast[j] = True
    braking = (v < v_fwd - 1e-6) & ~coast

    dvds = (np.roll(v, -1) - np.roll(v, 1)) / (2 * DS)
    along = v * dvds
    brake = np.where(braking & (along < -1.0), np.clip(-along / BRAKE_FULL, 0.0, 1.0), 0.0)
    # Full throttle unless braking, coasting or holding the corner's speed
    # limit (a maintenance throttle). Decided from what the driver is doing,
    # never from the car's acceleration, so thrust noise cannot move it.
    holding = (v <= v_lim + 0.02) & np.isfinite(np.where(v_lim < V_TOP, v_lim, np.inf))
    throttle = np.where(braking | coast, 0.0, np.where(holding, 0.35, 1.0))

    return {"v": v, "along": along, "brake": brake, "throttle": throttle,
            "braking": braking, "coast": coast}


@dataclass
class DrivenSession:
    channels: dict[str, np.ndarray]
    track: Track
    lap_times: list[float]
    truth: dict = field(default_factory=dict)

    def ibt(self) -> bytes:
        km = self.track.length_m / 1000.0
        yaml = DEFAULT_YAML_TMPL.format(km=km)
        return build_ibt(self.channels, tick_rate=TICK_RATE, yaml_text=yaml)


DEFAULT_YAML_TMPL = """---
WeekendInfo:
 TrackDisplayName: Synthetic Circuit
 TrackLength: {km:.4f} km
 EventType: Practice
DriverInfo:
 DriverCarIdx: 0
 DriverCarRedLine: 8500.000
 Drivers:
 - CarIdx: 0
   CarScreenName: Synthetic GT
SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionType: Practice
...
"""


def drive_session(
    n_laps: int = 14,
    knobs: dict[int, dict[int, Knob]] | None = None,
    *,
    seed: int = 7,
    noise: float = 1.0,
    layout=DEFAULT_LAYOUT,
    optional_channels: bool = True,
    phase_ticks: float = 0.37,
    thrust_noise: float = 0.0,
) -> DrivenSession:
    """Drive `n_laps` timed laps plus an out lap (lap 0) and a partial final lap.

    `knobs[lap][corner_id]` plants per-lap behaviour. Lap numbers here are the
    file's Lap channel values; lap 0 is the out lap.
    """
    knobs = knobs or {}
    rng = np.random.default_rng(seed)
    track = build_track(layout)
    N = len(track.s)
    total_laps = n_laps + 2  # out lap + timed laps + partial

    per_lap = []
    truth_laps = {}
    for lap in range(total_laps):
        lk = {cid: Knob(**vars(k)) for cid, k in knobs.get(lap, {}).items()}
        d = drive_lap(track, lk, rng if (noise > 0 or thrust_noise > 0) else None, noise, thrust_noise)
        per_lap.append((d, lk))

    # Time per station, lap after lap.
    seg_dt = []
    surface = []
    material = []
    for lap, (d, lk) in enumerate(per_lap):
        v_mid = 0.5 * (d["v"] + np.roll(d["v"], -1))
        dt = DS / np.maximum(v_mid, 0.5)
        surf = np.full(N, 3.0)
        mat = np.full(N, 2.0)
        for cid, kn in lk.items():
            idx = track.corner_of == cid
            if kn.cut_m > 0:
                arc_len = float(np.count_nonzero(idx) * DS)
                dt[idx] *= max(0.2, 1.0 - kn.cut_m / arc_len)
                surf[idx] = 0.0
                mat[idx] = 16.0
            if kn.kerb:
                c = next(c for c in track.corners if c.id == cid)
                a = int(c.apex_m / DS)
                mat[a:a + int(4 / DS)] = 12.0
        seg_dt.append(dt)
        surface.append(surf)
        material.append(mat)

    dt_all = np.concatenate(seg_dt)
    t_station = np.concatenate(([0.0], np.cumsum(dt_all)))[:-1]
    S_station = np.arange(len(dt_all)) * DS
    lap_times = [float(np.sum(dt)) for dt in seg_dt]

    # The partial final lap stops 40% of the way round.
    t_end = float(np.sum(lap_times[:-1]) + 0.4 * lap_times[-1])
    tick_t = (np.arange(int(t_end * TICK_RATE)) + phase_ticks) / TICK_RATE
    S = np.interp(tick_t, t_station, S_station)
    lap_idx = np.floor(S / track.length_m + 1e-12).astype(np.int64)
    s_in = S - lap_idx * track.length_m
    st_idx = np.clip(np.round(S / DS).astype(np.int64), 0, len(dt_all) - 1)
    loc = st_idx % N

    def g(name):
        return np.concatenate([d[name] for d, _ in per_lap])

    v = np.interp(S, S_station, g("v"))
    along = np.interp(S, S_station, g("along"))
    brake = np.interp(S, S_station, g("brake"))
    throttle = np.interp(S, S_station, g("throttle"))
    k_s = track.k_smooth[loc]
    heading = track.heading[loc]
    x = np.interp(s_in, track.s, track.x)
    y = np.interp(s_in, track.s, track.y)
    lat_acc = v * v * k_s
    yaw_rate = v * k_s
    steer = STEER_RATIO * np.arctan(WHEELBASE * k_s)
    vel_y = v * 0.01 * np.sign(k_s)
    lf = v.copy()
    vert = np.full(len(S), -G)
    surf = np.concatenate(surface)[st_idx]
    mat = np.concatenate(material)[st_idx]
    incidents = np.zeros(len(S))

    tick_lap = lap_idx
    n_inc = 0
    events = []
    for lap, (d, lk) in enumerate(per_lap):
        on_lap = tick_lap == lap
        for cid, kn in lk.items():
            c = next(c for c in track.corners if c.id == cid)
            near_apex = on_lap & (np.abs(s_in - c.apex_m) < 1.0)
            apex_ticks = np.flatnonzero(near_apex)
            brake_ticks = np.flatnonzero(on_lap & (brake > 0.3) & (s_in < c.start_m) & (s_in > c.start_m - 200))
            if kn.lockup and brake_ticks.size > 20:
                a = brake_ticks[brake_ticks.size // 3]
                lf[a:a + 15] = 0.35 * v[a:a + 15]
                events.append(("lockup", lap, cid))
            if kn.pump and brake_ticks.size > 30:
                a = brake_ticks[brake_ticks.size // 2]
                brake[a:a + 6] = 0.03
                events.append(("brake_pumping", lap, cid))
            if kn.slide and apex_ticks.size:
                a = apex_ticks[0]
                vel_y[a:a + 24] = -np.sign(k_s[a]) * v[a:a + 24] * 0.14
                steer[a + 4:a + 20] = -0.3 * steer[a + 4:a + 20]
                events.append(("oversteer", lap, cid))
            if kn.hesitate:
                pick = np.flatnonzero(on_lap & (s_in > c.end_m) & (throttle > 0.9))
                if pick.size > 40:
                    a = pick[10]
                    throttle[a:a + 24] = 0.25
                    events.append(("throttle_hesitation", lap, cid))
            if kn.kerb and apex_ticks.size:
                a = apex_ticks[0]
                vert[a:a + 3] = -G - 22.0
                events.append(("kerb_strike", lap, cid))
            if kn.incident and apex_ticks.size:
                n_inc += 1
                incidents[apex_ticks[0]:] += 1.0
                events.append(("incident", lap, cid))
            if kn.cut_m > 0:
                events.append(("off_track", lap, cid))
            if kn.coast_m > 0:
                events.append(("coasting", lap, cid))
            if kn.held_up:
                events.append(("held_up", lap, cid))
            if kn.tow > 0:
                events.append(("tow", lap, cid))

    if noise > 0:
        lat_acc = lat_acc + rng.normal(0, 0.05, len(S))
        along_n = along + rng.normal(0, 0.05, len(S))
        steer = steer + rng.normal(0, 0.0015, len(S))
    else:
        along_n = along

    gear = np.ones(len(S))
    for gi, vs in enumerate(GEAR_UP[1:], start=2):
        gear[v >= vs] = gi
    # Upshifts pass through neutral for two ticks (3 -> 0 -> 4).
    ups = np.flatnonzero(np.diff(gear) > 0) + 1
    for u in ups:
        gear[u:u + 2] = 0.0
    gi = gear.astype(np.int64)
    rpm = np.where(gi > 0, v * np.take(GEAR_RPM_PER_MS, gi), 3000.0)
    # A tidy driver: downshifts land below the redline.
    rpm = np.clip(rpm + 900.0, 900.0, REDLINE - 150.0)

    lat0, lon0 = 34.0, -84.0
    m_per_deg = 111320.0
    lat = lat0 + y / m_per_deg
    lon = lon0 + x / (m_per_deg * np.cos(np.radians(lat0)))

    n = len(S)
    on_pit = (tick_lap == 0) & (tick_t < 3.0)
    lap_crossings = np.cumsum([0.0] + lap_times)
    last_lap = np.zeros(n)
    for k in range(1, len(lap_crossings) - 1):
        last_lap[tick_t >= lap_crossings[k] + 10.0 / TICK_RATE] = lap_times[k - 1]

    ch: dict[str, np.ndarray] = {
        "Lap": tick_lap.astype(float),
        "LapDistPct": s_in / track.length_m,
        "Speed": v,
        "Throttle": throttle,
        "Brake": brake,
        "BrakeRaw": brake,
        "SteeringWheelAngle": steer,
        "Gear": gear,
        "RPM": rpm,
        "LatAccel": lat_acc,
        "LongAccel": along_n,
        "VertAccel": vert,
        "YawRate": yaw_rate,
        "Yaw": (heading + np.pi) % (2 * np.pi) - np.pi,
        "Lat": lat,
        "Lon": lon,
        "Alt": np.full(n, 250.0),
        "VelocityX": v,
        "VelocityY": vel_y,
        "FuelLevel": np.linspace(50.0, 50.0 - 2.4 * total_laps, n),
        "LFspeed": lf,
        "RFspeed": v.copy(),
        "LRspeed": v.copy(),
        "RRspeed": v.copy(),
        "BrakeABSactive": np.zeros(n),
        "BrakeABScutPct": np.zeros(n),
        "dcBrakeBias": np.full(n, 54.0),
        "ShiftIndicatorPct": np.zeros(n),
        "ShiftGrindRPM": np.zeros(n),
        "SteeringWheelPctTorque": np.clip(np.abs(steer) / 2.0, 0, 1),
        "SteeringWheelPctTorqueSignStops": np.clip(np.abs(steer) / 2.0, 0, 1),
        "SteeringWheelTorque": 8.0 * np.tanh(steer),
        "LFtempL": np.full(n, 82.0),
        "LFtempM": np.full(n, 86.0),
        "LFtempR": np.full(n, 89.0),
        "LFwearM": np.full(n, 1.0),
        "RRwearM": np.full(n, 1.0),
        "FrameRate": np.full(n, 120.0),
        "PlayerCarMyIncidentCount": incidents,
        "SessionNum": np.zeros(n),
        "OnPitRoad": on_pit.astype(float),
        "PlayerCarIdx": np.zeros(n),
        "PlayerTrackSurface": surf,
        "PlayerTrackSurfaceMaterial": mat,
    }
    if optional_channels:
        ch["SessionTime"] = 100.0 + tick_t
        ch["LapDist"] = s_in
        ch["LapLastLapTime"] = last_lap

    truth = _truth(track, per_lap, lap_times, events)
    return DrivenSession(channels=ch, track=track, lap_times=lap_times, truth=truth)


def _truth(track: Track, per_lap, lap_times, events) -> dict:
    """What was planted, measured on the station grid (no tick sampling)."""
    N = len(track.s)
    laps = {}
    for lap, (d, _) in enumerate(per_lap):
        rows = {}
        for c in track.corners:
            idx = np.flatnonzero(track.corner_of == c.id)
            a0 = idx[0]
            # The brake point: start of the braking run that ends at this corner.
            i = (a0 - 1) % N
            first = None
            steps = 0
            while (d["brake"][i] > 0.05 or d["braking"][i]) and steps < N:
                first = i
                i = (i - 1) % N
                steps += 1
            win = np.arange(a0 - int(200 / DS), idx[-1] + int(200 / DS)) % N
            vw = d["v"][win]
            floor = win[vw <= vw.min() + 0.05]
            vmin_i = int(floor[len(floor) // 2])  # middle of a constant-speed plateau
            lo = track.s[idx[0]]
            after = np.flatnonzero((track.s > lo) & (track.s < lo + 600) & (d["throttle"] > 0.5))
            rows[c.id] = {
                "brake_on_m": None if first is None else float(track.s[first]),
                "vmin": float(d["v"][vmin_i]),
                "vmin_at_m": float(track.s[vmin_i]),
                "pickup_m": None if after.size == 0 else float(track.s[after[0]]),
            }
        laps[lap] = rows
    return {
        "length_m": track.length_m,
        "corners": [vars(c) for c in track.corners],
        "lap_times": lap_times,
        "laps": laps,
        "events": events,
    }
