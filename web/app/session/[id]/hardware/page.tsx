import Link from "next/link";
import { sql } from "@/lib/db";
import TractionCircle from "@/components/TractionCircle";

export const dynamic = "force-dynamic";

type Block = Record<string, unknown>;

function get(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in (obj as Block)) return (obj as Block)[key];
  return undefined;
}

function num(v: unknown, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function StretchPanels({ metrics }: { metrics: Record<string, Block> }) {
  const lock = metrics["lockup_wheelspin"];
  const shift = metrics["shift_analysis"];
  const temps = metrics["tire_temps"];
  const balance = metrics["balance"];

  const missing: string[] = [];
  if (!lock) missing.push("lockup/wheelspin");
  if (!shift) missing.push("shift analysis");
  if (!temps) missing.push("tire temps");
  if (!balance) missing.push("balance indicator");

  const eventsTable = (events: unknown) =>
    Array.isArray(events) && events.length > 0 ? (
      <table>
        <thead>
          <tr><th>lap</th><th>at % of lap</th><th>wheels</th><th>ms</th></tr>
        </thead>
        <tbody>
          {(events as Block[]).slice(0, 8).map((e, i) => (
            <tr key={i}>
              <td>{String(e.lap)}</td>
              <td className="mono">{num(Number(e.start_pct) * 100, 1)}%</td>
              <td className="mono">{Array.isArray(e.wheels) ? (e.wheels as string[]).join(",") : "—"}</td>
              <td className="mono">{String(e.duration_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null;

  return (
    <>
      <div className="grid2">
        {lock && (
          <div className="panel">
            <h3>Lockups & wheelspin</h3>
            <p>
              <b>{String(get(get(lock, "counts"), "lockup_events") ?? 0)}</b> lockup ·{" "}
              <b>{String(get(get(lock, "counts"), "wheelspin_events") ?? 0)}</b> wheelspin events
            </p>
            {typeof get(lock, "lockups_finding") === "string" && (
              <p className="neg">{String(get(lock, "lockups_finding"))}</p>
            )}
            {typeof get(lock, "wheelspin_finding") === "string" && (
              <p className="neg">{String(get(lock, "wheelspin_finding"))}</p>
            )}
            {eventsTable(get(lock, "lockups"))}
            <p className="caveat">{String(get(lock, "caveat") ?? "")}</p>
          </div>
        )}
        {shift && (
          <div className="panel">
            <h3>Shift analysis</h3>
            {get(shift, "insufficient_data") ? (
              <p style={{ color: "var(--muted)" }}>{String(get(shift, "reason") ?? "insufficient data")}</p>
            ) : (
              <>
                <p>{String(get(shift, "observation") ?? "")}</p>
                <table>
                  <thead><tr><th>from gear</th><th>shifts</th><th>median rpm</th><th>% of redline</th></tr></thead>
                  <tbody>
                    {Object.entries((get(shift, "by_gear") as Block) ?? {}).map(([g, v]) => (
                      <tr key={g}>
                        <td>{g}</td>
                        <td>{String(get(v, "count"))}</td>
                        <td className="mono">{num(get(v, "median_rpm"), 0)}</td>
                        <td className="mono">{num(get(v, "pct_of_redline"), 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="caveat">{String(get(shift, "caveat") ?? "")}</p>
          </div>
        )}
        {temps && (
          <div className="panel">
            <h3>Tire temps (left-front)</h3>
            {get(temps, "insufficient_data") ? (
              <p style={{ color: "var(--muted)" }}>{String(get(temps, "reason") ?? "insufficient data")}</p>
            ) : (
              <p>
                Session median L/M/R:{" "}
                <b className="mono">
                  {num(get(get(temps, "session_median"), "left_c"), 1)} /{" "}
                  {num(get(get(temps, "session_median"), "middle_c"), 1)} /{" "}
                  {num(get(get(temps, "session_median"), "right_c"), 1)} °C
                </b>{" "}
                · spread {num(get(get(temps, "session_median"), "spread_c"), 1)} °C
              </p>
            )}
            <p style={{ color: "var(--muted)" }}>
              {String(get(get(temps, "other_corners"), "reason") ?? "")}
            </p>
            <p className="caveat">{String(get(temps, "caveat") ?? "")}</p>
          </div>
        )}
        {balance && (
          <div className="panel">
            <h3>Balance (over/understeer tendency)</h3>
            {get(balance, "insufficient_data") ? (
              <p style={{ color: "var(--muted)" }}>{String(get(balance, "reason") ?? "insufficient data")}</p>
            ) : (
              <>
                <p>
                  Divergences lean{" "}
                  <b>{num(get(get(balance, "tendency"), "understeer_pct"), 1)}% understeer</b> /{" "}
                  <b>{num(get(get(balance, "tendency"), "oversteer_pct"), 1)}% oversteer</b>{" "}
                  (fit r² {num(get(balance, "fit_r2"), 3)})
                </p>
                {typeof get(balance, "finding") === "string" && <p>{String(get(balance, "finding"))}</p>}
              </>
            )}
            <p className="caveat">{String(get(balance, "caveat") ?? "")}</p>
          </div>
        )}
      </div>
      {missing.length > 0 && (
        <div className="panel">
          <p style={{ color: "var(--muted)" }}>
            Not yet computed for this session: {missing.join(", ")} — re-upload
            the file to recompute once the modules land.
          </p>
        </div>
      )}
    </>
  );
}

export default async function HardwarePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const metricRows = (await sql`
    SELECT metric_key, payload FROM session_metrics WHERE session_id = ${id}
  `) as unknown as { metric_key: string; payload: Block }[];
  const metrics = Object.fromEntries(metricRows.map((m) => [m.metric_key, m.payload]));
  const hw = metrics["hardware"];
  const tc = metrics["traction_circle"];

  const bvr = get(hw, "brake_vs_raw");
  const abs = get(hw, "abs");
  const bias = get(hw, "brake_bias");
  const noise = get(hw, "pedal_noise_floor");
  const ffb = get(hw, "ffb");

  return (
    <>
      <p><Link href={`/session/${id}`}>← session report</Link></p>
      <h1>Hardware panel</h1>

      {!hw && (
        <div className="panel">
          <p style={{ color: "var(--muted)" }}>
            Hardware metrics not computed for this session — re-upload the file
            to recompute with the current modules.
          </p>
        </div>
      )}

      {hw && (
        <div className="grid2">
          <div className="panel">
            <h3>Brake pedal vs sensor</h3>
            <p>
              Demonstrated brake ceiling this session:{" "}
              <b>{num(get(bvr, "brake_ceiling_pct"), 1)}%</b>{" "}
              <span style={{ color: "var(--muted)" }}>
                (your own max, not a hardware limit)
              </span>
            </p>
            <p>
              Max divergence while moving: {num(get(bvr, "max_abs_diff"), 4)}
              {" · "}mean {num(get(bvr, "mean_abs_diff"), 4)}
            </p>
            <p style={{ color: "var(--muted)" }}>
              {String(get(bvr, "stationary_ticks_excluded") ?? 0)} stationary
              ticks excluded (the sim auto-brakes at 100% when stopped — those
              ticks say nothing about your pedal)
            </p>
          </div>

          <div className="panel">
            <h3>ABS</h3>
            <p>
              Engaged on <b>{num(get(abs, "engaged_pct_of_braking"), 1)}%</b> of
              braking ticks · {String(get(abs, "activation_events") ?? "—")}{" "}
              distinct activations
            </p>
            {typeof get(abs, "finding") === "string" && (
              <p className="neg">{String(get(abs, "finding"))}</p>
            )}
            <h3>Brake bias</h3>
            {get(bias, "available") === false ? (
              <p style={{ color: "var(--muted)" }}>{String(get(bias, "reason"))}</p>
            ) : (
              <p className="mono">
                {Array.isArray(get(bias, "values"))
                  ? (get(bias, "values") as unknown[]).join(" → ")
                  : "—"}
                {get(bias, "changed_during_session") === true && (
                  <span className="badge warn">changed during session</span>
                )}
              </p>
            )}
          </div>

          <div className="panel">
            <h3>Pedal noise floor</h3>
            <p>
              On full-throttle straights (pedal should read zero):{" "}
              <b>{String(get(noise, "spike_ticks") ?? "—")}</b> nonzero brake
              ticks of {String(get(noise, "qualifying_ticks") ?? "—")} · max
              spike {num(get(noise, "max_spike"), 4)}
            </p>
            <p className="caveat">{String(get(noise, "caveat") ?? "")}</p>
          </div>

          <div className="panel">
            <h3>Force feedback</h3>
            <p>
              Clipping on <b>{num(get(ffb, "clipping_pct"), 2)}%</b> of moving
              ticks
            </p>
            {typeof get(ffb, "finding") === "string" && (
              <p className="neg">{String(get(ffb, "finding"))}</p>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Traction circle — your own envelope</h3>
        <TractionCircle payload={tc as Record<string, any> | undefined} />
        {typeof get(tc, "basis") === "string" && (
          <p className="caveat">{String(get(tc, "basis"))} — {String(get(tc, "caveat") ?? "")}</p>
        )}
      </div>

      <StretchPanels metrics={metrics} />

      <div className="panel">
        <h3>Not possible from disk telemetry (won't be faked)</h3>
        <p style={{ color: "var(--muted)" }}>
          Racecraft/positioning tips need other-car channels the disk .ibt does
          not contain, and brake temperature has no channel at all — only line
          pressure exists.
        </p>
      </div>
      {hw && typeof get(hw, "caveat") === "string" && (
        <p className="caveat">{String(get(hw, "caveat"))}</p>
      )}
    </>
  );
}
