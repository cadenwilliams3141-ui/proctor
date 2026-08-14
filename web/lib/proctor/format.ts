/* Formatting. Every number that reaches the screen goes through here, so the
 * rounding is decided once rather than per component.
 *
 * Missing is not zero. A null reaches the screen as an em dash, never as 0 —
 * an absent channel must never be able to look like a measured zero. */

export const ABSENT = "—";

/** 137.075 -> "2:17.075" */
export function fmtLap(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return ABSENT;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

/** Signed to 3dp, always carrying its sign: 0.215 -> "+0.215" */
export function fmtDelta(s: number | null | undefined, dp = 3): string {
  if (s == null || !Number.isFinite(s)) return ABSENT;
  return `${s >= 0 ? "+" : ""}${s.toFixed(dp)}`;
}

/** Milliseconds, unsigned — the observation copy supplies the direction. */
export function fmtMs(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return ABSENT;
  return Math.abs(s * 1000).toFixed(0);
}

/** m/s -> km/h, rounded. The .ibt carries m/s; every display is km/h. */
export function kmh(ms: number | null | undefined, dp = 0): string {
  if (ms == null || !Number.isFinite(ms)) return ABSENT;
  return (ms * 3.6).toFixed(dp);
}

/** m/s^2 -> g. */
export function toG(accel: number | null | undefined, dp = 2): string {
  if (accel == null || !Number.isFinite(accel)) return ABSENT;
  return (accel / 9.81).toFixed(dp);
}

export function pct(v: number | null | undefined, dp = 0): string {
  if (v == null || !Number.isFinite(v)) return ABSENT;
  return (v * 100).toFixed(dp);
}

export function fixed(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return ABSENT;
  return v.toFixed(dp);
}

/** "180 m right". Both halves come from the same geometric fit, so if the fit
 *  did not land, neither half is claimed. */
export function fmtCornerGeometry(
  radius_m: number | null | undefined,
  dir: "left" | "right" | null | undefined,
): string {
  if (radius_m == null || dir == null) return "radius not fitted";
  return `${radius_m} m ${dir}`;
}

/** "29 Jul" — sessions are read within days of driving, so no year. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return ABSENT;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ABSENT;
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

/** Stagger helper. Entrance delays are written once as a string and never
 *  rebuilt per render — a changed `animation` string restarts the animation. */
export function stagger(index: number, from: number, step: number): string {
  return `${(from + index * step).toFixed(2)}s`;
}

/** "4 minutes ago", "3 days ago" — relative to now, in whole units.
 *
 *  Returns null for a missing or unparseable timestamp rather than a string,
 *  so a caller cannot accidentally render "NaN ago" or, worse, fall back to a
 *  plausible-looking default. */
export function fmtAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;

  const seconds = Math.max(0, (Date.now() - then) / 1000);
  /* Each row is "divide by THIS to reach THAT unit" — the divisor and the unit
     it produces. Pairing a divisor with the unit it came FROM instead labelled
     every result one step too small, so a file from twenty minutes ago
     reported as twenty seconds and fell through to "just now". */
  const steps: [number, string][] = [
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
    [4.35, "month"],
    [12, "year"],
  ];

  let value = seconds;
  let label = "second";
  for (const [divisor, unit] of steps) {
    if (value < divisor) break;
    value /= divisor;
    label = unit;
  }
  const n = Math.floor(value);
  if (label === "second" && n < 45) return "just now";
  return `${n} ${label}${n === 1 ? "" : "s"} ago`;
}
