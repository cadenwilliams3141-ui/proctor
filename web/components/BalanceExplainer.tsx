"use client";

/* Descriptive balance explainer: how the car's rotation diverged from what the
   steering asked for, broken down by input phase and by corner, plus the brake
   bias in use. Observations only — Proctor describes where the balance leaned,
   it does not prescribe a setup change. All numbers are self-calibrated from the
   driver's own low-slip data (see the balance module). */

type Loose = Record<string, any>;

function pctText(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(0)}%` : "—";
}

function leanBadge(lean: string) {
  const cls = lean === "understeer" ? "warn" : lean === "oversteer" ? "bad" : "";
  return <span className={`badge ${cls}`}>{lean}</span>;
}

export default function BalanceExplainer({ payload }: { payload: Loose | undefined }) {
  if (!payload) {
    return (
      <p style={{ color: "var(--muted)" }}>
        balance not computed for this session — re-upload to compute
      </p>
    );
  }
  if (payload.insufficient_data) {
    return (
      <p style={{ color: "var(--muted)" }}>
        {String(payload.reason ?? "steer–yaw relationship too weak to calibrate balance")}
      </p>
    );
  }

  const states: { key: string; label: string }[] = [
    { key: "braking", label: "under braking" },
    { key: "on_throttle", label: "on throttle" },
    { key: "coasting", label: "coasting" },
  ];
  const byState: Loose = payload.by_input_state ?? {};
  const byCorner = payload.by_corner;
  const bias = payload.brake_bias;

  return (
    <div>
      <p>
        Across the session, divergences from your steering lean{" "}
        <b>{pctText(payload.tendency?.understeer_pct)} understeer</b> /{" "}
        <b>{pctText(payload.tendency?.oversteer_pct)} oversteer</b>{" "}
        <span style={{ color: "var(--muted)" }}>(fit r² {String(payload.fit_r2 ?? "—")})</span>.
      </p>
      {typeof payload.finding === "string" && <p>{payload.finding}</p>}

      <h3>By input phase</h3>
      <table>
        <thead><tr><th>phase</th><th>understeer</th><th>oversteer</th><th>ticks</th></tr></thead>
        <tbody>
          {states.map((s) => {
            const b = byState[s.key] ?? {};
            return (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className="mono">{pctText(b.understeer_pct)}</td>
                <td className="mono">{pctText(b.oversteer_pct)}</td>
                <td className="mono">{String(b.ticks ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>By corner</h3>
      {byCorner?.available ? (
        <table>
          <thead><tr><th>corner</th><th>at % of lap</th><th>lean</th><th>U / O</th></tr></thead>
          <tbody>
            {(byCorner.corners as Loose[]).map((c) => (
              <tr key={String(c.id)}>
                <td>T{String(c.id)}</td>
                <td className="mono">{(Number(c.apex_pct) * 100).toFixed(0)}%</td>
                <td>{leanBadge(String(c.lean))}</td>
                <td className="mono">{pctText(c.understeer_pct)} / {pctText(c.oversteer_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: "var(--muted)" }}>
          {String(byCorner?.reason ?? "no corners on the reference lap to place balance against")}
        </p>
      )}

      <h3>Brake bias</h3>
      {bias?.available ? (
        <>
          <p className="mono">
            {Array.isArray(bias.front_pct_values) ? bias.front_pct_values.join(" → ") : "—"}% front
            {bias.changed_during_session && <span className="badge warn">changed during session</span>}
          </p>
          <p className="caveat">{String(bias.note ?? "")}</p>
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>{String(bias?.reason ?? "brake bias unavailable")}</p>
      )}

      <p className="caveat">{String(payload.caveat ?? "")}</p>
    </div>
  );
}
