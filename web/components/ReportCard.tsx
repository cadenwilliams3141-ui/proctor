import type { MetricPayloads } from "@/lib/types";
import { atLeast, hiddenNote, type Tier } from "@/lib/tier";

/* Renders the module-7 fingerprint findings plus headline blocks from other
   metric payloads. Every card leads with data and shows its honesty caveat
   inline. Payloads are loosely typed JSONB — render defensively, and when a
   module reported insufficient data, show that as a finding (missing ≠ zero). */

type Block = Record<string, unknown>;

function get(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in (obj as Block)) return (obj as Block)[key];
  return undefined;
}

function num(v: unknown, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function Insufficient({ block }: { block: unknown }) {
  const reason = get(block, "reason") ?? get(block, "note");
  return (
    <p style={{ color: "var(--muted)" }}>
      insufficient data{typeof reason === "string" ? ` — ${reason}` : ""}
    </p>
  );
}

function Card({ title, children, caveat }: {
  title: string; children: React.ReactNode; caveat?: unknown;
}) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {children}
      {typeof caveat === "string" && <p className="caveat">{caveat}</p>}
    </div>
  );
}

export default function ReportCard({ metrics, tier }: {
  metrics: MetricPayloads; tier: Tier;
}) {
  const rc = metrics["report_card"];
  const hw = metrics["hardware"];
  const tc = metrics["traction_circle"];

  // Fuel/pace and driving style are the headline findings — every tier sees
  // them. Rig-health and envelope detail step up from there.
  const showDetail = atLeast(tier, "intermediate");
  const showDeep = atLeast(tier, "advanced");
  // Count only cards that would actually have rendered, so the note never
  // claims something is hidden when the module simply produced nothing.
  const detailCards = [rc, rc, hw]; // fatigue curve, frame health, hw snapshot
  const deepCards = [tc];           // traction envelope
  const hidden =
    (showDetail ? 0 : detailCards.filter(Boolean).length) +
    (showDeep ? 0 : deepCards.filter(Boolean).length);

  if (!rc && !hw && !tc) {
    return (
      <div className="panel">
        <p style={{ color: "var(--muted)" }}>
          No metric blocks computed for this session yet — it may have been
          ingested before the analysis modules landed. Re-upload the file to
          recompute.
        </p>
      </div>
    );
  }

  const fuel = get(rc, "fuel_fade");
  const style = get(rc, "driving_style");
  const fatigue = get(rc, "fatigue_curve");
  const frame = get(rc, "frame_health");

  return (
    <>
      <h2>Session report card</h2>
      <div className="grid2">
        {rc && (
          <Card title="Fuel & pace trend" caveat={get(rc, "caveat")}>
            {get(fuel, "insufficient_data") ? <Insufficient block={fuel} /> : (
              <>
                <p>
                  Fuel burn ≈ <b>{num(get(fuel, "fuel_burn_l_per_lap_median"))} L/lap</b>
                  {" · "}total drop {num(get(fuel, "total_fuel_drop_l"), 1)} L across clean laps.
                </p>
                {get(get(fuel, "pace_trend"), "insufficient_data") ? (
                  <Insufficient block={get(fuel, "pace_trend")} />
                ) : (
                  <p>
                    Pace, first vs last clean laps:{" "}
                    <b>
                      {num(get(get(fuel, "pace_trend"), "first_laps_mean_s"), 3)}s →{" "}
                      {num(get(get(fuel, "pace_trend"), "last_laps_mean_s"), 3)}s
                    </b>{" "}
                    (Δ {num(get(fuel, "pace_delta_s"), 3)}s).
                  </p>
                )}
                {typeof get(fuel, "agreement") === "string" &&
                  get(fuel, "agreement") !== "insufficient_data" && (
                    <p>{String(get(fuel, "agreement"))}</p>
                  )}
                {typeof get(fuel, "weight_note") === "string" && (
                  <p style={{ color: "var(--muted)" }}>{String(get(fuel, "weight_note"))}</p>
                )}
              </>
            )}
          </Card>
        )}
        {rc && (
          <Card title="Driving style" caveat={get(rc, "caveat")}>
            {get(style, "insufficient_data") ? <Insufficient block={style} /> : (
              <>
                <p>
                  Median throttle-off → brake-on gap:{" "}
                  <b>{num(get(style, "median_release_to_brake_ms"), 0)} ms</b>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    over {String(get(style, "brake_applications") ?? "—")} brake applications
                  </span>
                </p>
                {typeof get(style, "style_observation") === "string" && (
                  <p>{String(get(style, "style_observation"))}</p>
                )}
              </>
            )}
          </Card>
        )}
        {rc && showDetail && (
          <Card title="Fatigue curve" caveat={get(rc, "caveat")}>
            {get(fatigue, "insufficient_data") ? <Insufficient block={fatigue} /> : (
              <>
                <p>
                  Steering reversal rate, early vs late:{" "}
                  <b>
                    {num(get(fatigue, "first_third_reversals_per_min"), 1)} →{" "}
                    {num(get(fatigue, "last_third_reversals_per_min"), 1)} /min
                  </b>
                </p>
                {typeof get(fatigue, "finding") === "string" && <p>{String(get(fatigue, "finding"))}</p>}
              </>
            )}
          </Card>
        )}
        {rc && showDetail && (
          <Card title="Frame-rate health">
            {get(frame, "available") === false ? (
              <p style={{ color: "var(--muted)" }}>
                {String(get(frame, "reason") ?? "not available")}
              </p>
            ) : (
              <>
                <p>
                  Min <b>{num(get(frame, "min_fps"), 0)} FPS</b> · mean{" "}
                  {num(get(frame, "mean_fps"), 0)} · sub-60 for{" "}
                  {num(get(frame, "sub_60_seconds"), 1)}s
                </p>
                {typeof get(frame, "finding") === "string" && (
                  <p className="neg">{String(get(frame, "finding"))}</p>
                )}
              </>
            )}
          </Card>
        )}
        {hw && showDetail && (
          <Card title="Hardware snapshot" caveat={get(hw, "caveat")}>
            <p>
              Brake sensor ceiling:{" "}
              <b>{num(get(get(hw, "brake_vs_raw"), "brake_ceiling_pct"), 1)}%</b>
              {" · "}FFB clipping:{" "}
              <b>{num(get(get(hw, "ffb"), "clipping_pct"), 2)}%</b>
            </p>
            <p style={{ color: "var(--muted)" }}>
              full detail on the hardware panel
            </p>
          </Card>
        )}
        {tc && showDeep && (
          <Card title="Traction envelope" caveat={get(tc, "caveat")}>
            {get(tc, "insufficient_data") ? <Insufficient block={tc} /> : (
              <p>
                Per-lap utilization of your own demonstrated g-g envelope is on
                the hardware panel.{" "}
                <span style={{ color: "var(--muted)" }}>
                  {String(get(tc, "basis") ?? "")}
                </span>
              </p>
            )}
          </Card>
        )}
      </div>
      {hiddenNote(tier, hidden) && (
        <p className="caveat">{hiddenNote(tier, hidden)}</p>
      )}
    </>
  );
}
