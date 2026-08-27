# Analysis module contract (read fully before writing code)

Every analysis module is a **pure function over the parser output contract**:
`ParsedSession` in → JSON-serializable `dict` out. No DB, no HTTP, no file I/O,
no reaching back into the binary. Modules live in
`parser/proctor_parser/analysis/<name>.py` and expose exactly:

```python
METRIC_KEY: str                              # the session_metrics.metric_key
def compute(session: ParsedSession) -> dict  # JSON-serializable payload
```

Do NOT touch `analysis/__init__.py` — registration is wired by the integrator.

## The lap object (input contract — import from `proctor_parser.session`)

```python
ParsedSession:
  meta: SessionMeta   # track_name, car_name, session_type, session_num,
                      # track_length_km, car_redline_rpm, tick_rate,
                      # recorded_at, wear_masked
  laps: list[ParsedLap]

ParsedLap:
  lap_number: int
  lap_time_s: float | None      # None for partial laps
  is_valid: bool                # False for out/in/partial/short laps
  is_out_lap: bool
  incident_delta: int
  is_anomalous: bool            # incident or speed-profile outlier
  raw: dict[str, np.ndarray]    # per-tick arrays, all equal length within a lap
  grid: dict[str, np.ndarray]   # resampled onto fixed 1000-pt distance grid
```

### `raw` keys (per-tick, at `meta.tick_rate` Hz = 60)

| key | source channel | unit |
|---|---|---|
| dist | LapDistPct | 0..1 |
| speed | Speed | m/s |
| throttle, brake, brake_raw | Throttle/Brake/BrakeRaw | 0..1 |
| steer | SteeringWheelAngle | rad |
| gear | Gear | int (-1 R, 0 N, 1..) |
| rpm | RPM | rev/min |
| lat_accel, long_accel, vert_accel | *Accel | m/s² |
| yaw_rate | YawRate | rad/s |
| yaw | Yaw | rad (heading) |
| vel_x, vel_y | VelocityX/Y | m/s, car frame (forward, lateral) |
| lat_gps, lon_gps | Lat/Lon | deg |
| alt | Alt | m |
| lf_speed, rf_speed, lr_speed, rr_speed | ??speed | m/s (wheel) |
| abs_active | BrakeABSactive | bool |
| abs_cut | BrakeABScutPct | % |
| ffb_stops | SteeringWheelPctTorqueSignStops | 0..1 (FFB saturation) |
| ffb_pct | SteeringWheelPctTorque | 0..1 |
| steer_torque | SteeringWheelTorque | N·m (absolute, comparable across sessions) |
| fuel | FuelLevel | liters |
| lf_temp_l/m/r | LFtempL/M/R | °C |
| brake_bias | dcBrakeBias | % front |
| frame_rate | FrameRate | fps |

### `grid` keys (all float32, length exactly 1000)

`grid_pct` (bin centers, (i+0.5)/1000), `speed`, `throttle`, `brake`,
`brake_raw`, `steer`, `gear`, `rpm`, `lat_accel`, `long_accel`, `lat_gps`,
`lon_gps`, `abs_active`. Two laps' grid arrays are index-aligned by distance.

## Hard rules

1. **Stationary auto-brake guard (CRITICAL).** The sim forces `Brake=1.0`
   with `BrakeRaw=0` whenever the car is stopped. Any Brake-vs-BrakeRaw
   logic MUST exclude ticks with speed ≤ 5 m/s. Use
   `from proctor_parser.laps import moving_mask` (`moving_mask(raw["speed"])`).
2. **Honor `meta.wear_masked`.** When true, tire-wear analysis is skipped
   entirely and the payload says so.
3. **JSON-serializable output only.** psycopg's `json.dumps` rejects numpy
   scalars/arrays. Cast every number with `float()`/`int()`, every array with
   `[float(v) for v in arr]`. Round floats sensibly (e.g. 4 decimals) to keep
   payloads compact.
4. **Reference lap** = fastest lap with `is_valid and not is_anomalous`
   (fall back to fastest valid; if no valid laps, return an honest
   "insufficient data" payload — never crash, never fabricate).
5. Guard every division (speeds can be 0; clip to ≥1.0 m/s where inverting).

## Honesty rules (bake into every payload)

- **Observations, not verdicts.** One session describes; it does not
  diagnose. Findings that need more sessions to be trustworthy must carry a
  `"caveat"` string saying so.
- **Describe, don't prescribe.** Report what the channels show and where —
  never why the driver did it or what to do differently.
- **Missing ≠ zero.** Absent/insufficient data → explicit
  `{"insufficient_data": true, "reason": ...}` style fields, never silent zeros.
- **Report negative results.** "No clipping detected" is a finding; include it.
- **Self-comparison framing.** Limits/ideals come from the driver's own data
  in this session; every payload carries
  `"basis": "self-comparison within this session"` (or more specific).

## Tests

Write pytest tests in `parser/tests/test_<name>.py`. Build inputs with:

```python
from tests.synthetic import build_ibt, make_core_channels
from proctor_parser import parse_ibt
sessions = parse_ibt(build_ibt(make_core_channels()))
```

(`make_core_channels()` gives 7 laps: lap 0 out-lap w/ stationary auto-brake
ticks, laps 1–5 valid — lap 3 slow-anomalous, lap 5 incident-anomalous —
lap 6 partial. See `parser/tests/synthetic.py` for knobs.)

Every test must pass with `python -m pytest tests -q` from `parser/`.
Also assert your payload survives `json.dumps`.

## Style

Match the existing code: type hints, module docstring stating what the module
observes, small pure helpers, no classes unless state demands it, comments
only for non-obvious constraints. numpy vectorized — no per-tick Python loops.
