"use client";

/* Into the corner: trail braking against your own best entry. Lifted out of
 * WhereItWent so the Braking aspect screen shows the same panel for a corner,
 * rather than a second copy of it. */

import { Evidence } from "@/components/proctor/ui/Answer";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import Panel from "@/components/proctor/ui/Panel";
import { CH, dim } from "@/lib/proctor/channels";
import { fixed } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { TRAIL_TIE_S, explainTrailCorner } from "@/lib/proctor/explain";
import { useProctor } from "@/lib/proctor/store";
import type { TrailBrakingData, TrailCorner, TrailLap } from "@/lib/proctor/types";

// ─────────────────────────────────────────────────────────────────────────────
// Into the corner: trail braking against your own best entry
// ─────────────────────────────────────────────────────────────────────────────

export default function IntoTheCorner({
  trail,
  corner,
  id,
}: {
  trail: TrailBrakingData | null;
  corner: TrailCorner | null;
  id: number;
}) {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const head = (
    <Eyebrow size={9.5} style={{ letterSpacing: ".09em", marginBottom: "var(--space-3)" }}>
      into the corner
    </Eyebrow>
  );

  // The module never ran on this session, or could not: its own reason, never a blank.
  if (!trail) {
    const why =
      bundle.absences.find((a) => a.key === "trail_braking")?.reason ??
      "Trail braking was not measured for this session.";
    return (
      <Panel padding="var(--space-4)" style={{ flex: "none" }}>
        {head}
        <div style={{ fontSize: 12, lineHeight: 1.6, color: dim(58) }}>{why}</div>
      </Panel>
    );
  }
  if (!corner) {
    return (
      <Panel padding="var(--space-4)" style={{ flex: "none" }}>
        {head}
        <div style={{ fontSize: 12, lineHeight: 1.6, color: dim(58) }}>
          Turn {id} was not among the corners this session&apos;s entries were measured on.
        </div>
      </Panel>
    );
  }

  const th = trail.thresholds;
  const method = th
    ? `Brake counts as on at ${th.brake_on_pct}% and off below ${th.brake_off_pct}%; turn-in is where lateral g reaches ${th.turn_in_pct_of_peak_lat}% of that lap's own peak. ${noteFor("trail.method")}`
    : noteFor("trail.method");

  return (
    <Panel padding="var(--space-4)" style={{ flex: "none" }} foot={<Caveat>{method}</Caveat>}>
      {head}
      <Explain items={explainTrailCorner(corner)} max={3} />

      {corner.measured && (
        <>
          <div className="rule" style={{ "--fade": "20px", margin: "var(--space-4) 0 var(--space-3)" } as React.CSSProperties} />
          <BestVsTypical corner={corner} />
          <TrailContext corner={corner} trail={trail} />
          <Evidence
            label="Show every lap into this corner"
            hint={`${corner.per_lap.length} clean laps, quickest entry first`}
          >
            <TrailLaps rows={corner.per_lap} best={corner.best_entry.lap} />
          </Evidence>
        </>
      )}
    </Panel>
  );
}

const signedTrail = (s: number | null) =>
  s == null ? "held" : s >= 0 ? `+${s.toFixed(2)}` : s.toFixed(2);

export function BestVsTypical({ corner }: { corner: Extract<TrailCorner, { measured: true }> }) {
  const b = corner.best_entry;
  const m = corner.median;
  // No lap stood out (the headline says so): the table would name a winner
  // that won by nothing, so it does not render. The per-lap rows still do.
  if (b.gain_vs_median_s == null || b.gain_vs_median_s <= TRAIL_TIE_S) return null;
  const rows: { label: string; best: string; typical: string; unit: string }[] = [
    { label: "to the apex", best: fixed(b.entry_time_s, 2), typical: fixed(m.entry_time_s, 2), unit: "s" },
    { label: "brake at turn-in", best: fixed(b.brake_at_turn_in_pct, 0), typical: fixed(m.brake_at_turn_in_pct, 0), unit: "%" },
    { label: "trail after turn-in", best: signedTrail(b.trail_s), typical: signedTrail(m.trail_s), unit: "s" },
    { label: "coasting", best: fixed(b.coast_s, 2), typical: fixed(m.coast_s, 2), unit: "s" },
    { label: "grip at the dip", best: fixed(b.transition_min_pct, 0), typical: fixed(m.transition_min_pct, 0), unit: "% of yours" },
  ];
  return (
    <table className="table" style={{ marginBottom: "var(--space-3)" }}>
      <thead>
        <tr>
          <th />
          <th style={{ textAlign: "right", color: CH.gain }}>lap {b.lap}</th>
          <th style={{ textAlign: "right" }}>typical</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ color: dim(55), fontSize: 11 }}>{r.label}</td>
            <td className="num" style={{ textAlign: "right", color: CH.gain }}>{r.best}</td>
            <td className="num" style={{ textAlign: "right" }}>
              {r.typical} <span style={{ fontSize: 9.5, color: dim(35) }}>{r.unit}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* What else was true of this corner's entry. Context only — it describes the
   conditions, it does not explain the driving. Brake temperature is named so
   its absence is stated where a driver would look for it, not left silent. */
export function TrailContext({
  corner,
  trail,
}: {
  corner: Extract<TrailCorner, { measured: true }>;
  trail: TrailBrakingData;
}) {
  const ctx = corner.context;
  const chips: string[] = [];
  if (ctx.grade_pct != null) {
    chips.push(
      Math.abs(ctx.grade_pct) < 0.5
        ? "flat braking zone"
        : `${ctx.grade_pct < 0 ? "downhill" : "uphill"} ${Math.abs(ctx.grade_pct).toFixed(1)}%`,
    );
  }
  if (ctx.load_g_onset != null && ctx.load_g_turn_in != null) {
    chips.push(`load ${ctx.load_g_onset.toFixed(2)} → ${ctx.load_g_turn_in.toFixed(2)} g`);
  }
  if (corner.median.abs_in_trail_pct != null) {
    chips.push(`ABS ${corner.median.abs_in_trail_pct.toFixed(0)}% of the trail`);
  }
  if (trail.lf_temp_available && ctx.lf_temp_middle_c != null) {
    chips.push(`LF middle ${ctx.lf_temp_middle_c.toFixed(0)} °C`);
  }
  chips.push("brake temp: not in the file");

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
      {chips.map((c) => (
        <span key={c} className="tag tag-outline" style={{ fontSize: 10, padding: "2px 8px" }}>
          {c}
        </span>
      ))}
    </div>
  );
}

export function TrailLaps({ rows, best }: { rows: TrailLap[]; best: number }) {
  const sorted = [...rows].sort((a, b) => a.entry_time_s - b.entry_time_s);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>lap</th>
          <th style={{ textAlign: "right" }}>apex s</th>
          <th style={{ textAlign: "right" }}>brake %</th>
          <th style={{ textAlign: "right" }}>trail s</th>
          <th style={{ textAlign: "right" }}>dip %</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.lap} style={r.lap === best ? { color: CH.gain } : undefined}>
            <td className="num">{r.lap}</td>
            <td className="num" style={{ textAlign: "right" }}>{fixed(r.entry_time_s, 2)}</td>
            <td className="num" style={{ textAlign: "right" }}>{fixed(r.brake_at_turn_in_pct, 0)}</td>
            <td className="num" style={{ textAlign: "right" }}>{signedTrail(r.trail_s)}</td>
            <td className="num" style={{ textAlign: "right" }}>{fixed(r.transition_min_pct, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
