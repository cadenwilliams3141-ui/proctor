"use client";

/* Rig health — what the hardware, the electronics and the contact patches did.
 *
 * Two things changed here beyond the layout.
 *
 * 1. THE NUMBERS ARE REAL. The four cards at the top used to carry a brake
 *    ceiling of "93.4", an ABS figure of "6.2", an FFB figure of "1.87" and a
 *    noise count of "41" as literals in this file's own source, with prose
 *    beneath them describing a session nobody had loaded. They now come off the
 *    hardware module, and where the module could not measure one, it says so
 *    instead of printing a number.
 *
 * 2. GRIP IS MEASURED, NOT GUESSED. "How much grip was there" has an honest
 *    answer in these channels: horizontal force over vertical force, both from
 *    the accelerometers, which is a friction coefficient in the mechanical
 *    sense. It is the grip that was USED — a careful lap reads low because the
 *    driver asked for less — and it is a whole-car figure, because there is one
 *    accelerometer and four tires. Both caveats are on screen, not just here.
 *
 * The lockup and wheelspin tables carry the inputs that were on the car when
 * each event began. That is the "what caused it" question answered as far as
 * telemetry can answer it: the conditions are measured, the intent is not. */

import { useMemo } from "react";
import { Ban, CircleAlert, Gauge, TriangleAlert } from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Explain from "@/components/proctor/ui/Explain";
import GripLoadCurve from "@/components/proctor/views/GripLoadCurve";
import Panel from "@/components/proctor/ui/Panel";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import { explainEvent, explainGrip, explainPattern, wheelName } from "@/lib/proctor/explain";
import { fixed } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import { isUsable, type GripData, type TrackEvent } from "@/lib/proctor/types";

export default function RigScreen() {
  const { bundle } = useProctor();

  const lockups = useMemo(
    () => (bundle ? bundle.events.filter((e) => e.kind === "lockup") : []),
    [bundle],
  );
  const spins = useMemo(
    () => (bundle ? bundle.events.filter((e) => e.kind === "wheelspin") : []),
    [bundle],
  );

  if (!bundle) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const hw = bundle.hardware;
  const grip = bundle.grip;

  /* Every card reads a measured value or reports itself unmeasured. `null`
     reaches the screen as an em dash and the bar stays empty — an absent
     channel must never be able to look like a measured zero. */
  const cards: {
    label: string;
    value: number | null;
    unit: string;
    /** 0-100 for the bar, or null for no bar. */
    bar: number | null;
    note: string;
    color?: string;
  }[] = [
    {
      label: "brake ceiling",
      value: hw?.brake_ceiling_pct ?? null,
      unit: "% of pedal travel",
      bar: hw?.brake_ceiling_pct ?? null,
      note:
        hw?.brake_ceiling_pct == null
          ? "The hardware module did not run on this session."
          : `Your own maximum while moving${
              hw.stationary_ticks_excluded != null
                ? `, with ${hw.stationary_ticks_excluded.toLocaleString()} stationary ticks excluded`
                : ""
            } — not a limit of the pedal.`,
      color: "var(--color-text)",
    },
    {
      label: "ABS engagement",
      value: hw?.abs.engaged_pct_of_braking ?? null,
      unit: "% of braking",
      bar: hw?.abs.engaged_pct_of_braking ?? null,
      note:
        hw?.abs.finding ??
        hw?.abs.reason ??
        (hw?.abs.activation_events != null
          ? `${hw.abs.activation_events} separate activations across ${hw.abs.braking_ticks?.toLocaleString() ?? "?"} braking ticks.`
          : "Not measured for this session."),
      color: CH.warn,
    },
    {
      label: "wheel against its stops",
      value: hw?.ffb.clipping_pct ?? null,
      unit: "% of moving",
      bar: hw?.ffb.clipping_pct ?? null,
      note:
        hw?.ffb.finding ??
        hw?.ffb.reason ??
        "While the wheel is saturated the force stops changing, so that detail never reached your hands.",
      color: CH.a,
    },
    {
      label: "pedal noise floor",
      value: hw?.pedal_noise.spike_ticks ?? null,
      unit:
        hw?.pedal_noise.qualifying_ticks != null
          ? `of ${hw.pedal_noise.qualifying_ticks.toLocaleString()} full-throttle ticks`
          : "spikes",
      bar:
        hw?.pedal_noise.spike_ticks != null && hw.pedal_noise.qualifying_ticks
          ? (hw.pedal_noise.spike_ticks / hw.pedal_noise.qualifying_ticks) * 100
          : null,
      note:
        hw?.pedal_noise.reason ??
        (hw?.pedal_noise.max_spike != null
          ? `Peak reading ${hw.pedal_noise.max_spike} where the pedal should be silent.`
          : "Not measured for this session."),
      color: "var(--color-text)",
    },
  ];

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
          gap: "var(--space-3)",
        }}
      >
        {cards.map((c, i) => (
          <Panel
            key={c.label}
            padding="var(--space-4)"
            style={{ animation: "fadeUp .4s both", animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s` }}
          >
            <Eyebrow size={9.5}>{c.label}</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
              <span
                className="num"
                style={{ font: "500 26px var(--font-heading)", color: c.value == null ? dim(35) : c.color }}
              >
                {c.value == null ? "—" : fixed(c.value, c.value >= 100 ? 0 : 2)}
              </span>
              <span style={{ fontSize: 10.5, color: dim(38) }}>{c.unit}</span>
            </div>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: dim(8),
                marginTop: "var(--space-3)",
                overflow: "hidden",
              }}
            >
              {c.bar != null && (
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, c.bar))}%`,
                    background: c.color,
                    transformOrigin: "left",
                    animation: "growX .6s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${(0.05 + i * 0.05).toFixed(2)}s`,
                  }}
                />
              )}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(50), marginTop: "var(--space-2)" }}>
              {c.note}
            </div>
          </Panel>
        ))}
      </div>

      {/* ── Grip ──────────────────────────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <h2 style={{ fontSize: 13, marginBottom: "var(--space-3)" }}>
          The grip between the car and the road
        </h2>
        {grip ? (
          <GripSection grip={grip} />
        ) : (
          <Panel padding="var(--space-4)">
            <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.65, maxWidth: 660 }}>
              {bundle.absences.find((a) => a.key === "grip")?.reason ??
                "This session was ingested before the module that measures grip existed. Re-ingest it and this section fills in — nothing about the file needs to change."}
            </div>
          </Panel>
        )}
      </section>

      {/* ── The g-g plot and the per-lap envelope ─────────────────────────── */}
      <div
        style={{
          marginTop: "var(--space-4)",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "var(--space-4)",
        }}
      >
        <TractionCircle />
        <EnvelopeBars />
      </div>

      {/* ── Lockups and wheelspin ─────────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <h2 style={{ fontSize: 13, marginBottom: "var(--space-3)" }}>
          When a wheel let go, and what was happening at the time
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
            gap: "var(--space-4)",
          }}
        >
          <SlipPanel kind="lockup" events={lockups} />
          <SlipPanel kind="wheelspin" events={spins} />
        </div>
      </section>

      <Panel padding="var(--space-4)" style={{ marginTop: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <Ban size={17} strokeWidth={1.6} color={dim(45)} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <div style={{ font: "500 12.5px var(--font-heading)", marginBottom: 4 }}>
              Not possible from disk telemetry — and it will not be faked.
            </div>
            <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6, maxWidth: 760 }}>
              {noteFor("racecraft")} {noteFor("brake.temperature")} Grip is measured
              for the car as a whole: there is one accelerometer and four contact
              patches, so nothing here can name which tire ran out first.
            </div>
          </div>
        </div>
      </Panel>

      {hw && hw.concerns.length > 0 && (
        <Panel
          title="Worth keeping an eye on"
          sub="watch items, not diagnoses"
          padding="var(--space-4)"
          style={{ marginTop: "var(--space-4)" }}
        >
          {hw.concerns.map((c) => (
            <div key={c.area} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 10 }}>
              <TriangleAlert size={13} strokeWidth={1.9} color={CH.warn} style={{ flex: "none", marginTop: 2 }} />
              <div>
                <div style={{ font: "500 12px var(--font-heading)", marginBottom: 2 }}>{c.area}</div>
                <div style={{ fontSize: 11.5, color: dim(62), lineHeight: 1.55 }}>{c.observation}</div>
                <div style={{ fontSize: 10.5, color: dim(38), marginTop: 2 }}>{c.watch}</div>
              </div>
            </div>
          ))}
        </Panel>
      )}
      {hw && hw.concerns.length === 0 && hw.concerns_finding && (
        <Caveat maxWidth={700}>{hw.concerns_finding}</Caveat>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grip
// ─────────────────────────────────────────────────────────────────────────────

function GripSection({ grip }: { grip: GripData }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--space-4)" }}>
      <Panel
        title="How it is measured"
        sub="force sideways over force downwards"
        padding="var(--space-4)"
        foot={<Caveat>{noteFor("grip.mu")}</Caveat>}
      >
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            color: dim(66),
            background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
            borderRadius: "var(--radius-sm)",
            padding: "9px 11px",
            lineHeight: 1.7,
            marginBottom: "var(--space-3)",
          }}
        >
          grip = √(lateral² + longitudinal²) ÷ vertical
        </div>
        <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: "0 0 var(--space-3)" }}>
          All three are accelerometer channels the file already carries. The top
          is the force the tires were putting into the road; the bottom is the
          force pressing them into it — weight plus downforce plus whatever the
          kerbs added. The ratio is a friction coefficient, measured rather than
          modelled.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
          <Figure label="peak grip" value={grip.session.peak_mu.toFixed(2)} unit="g per g" accent />
          <GripFigure
            label="peak lateral"
            g={grip.session.peak_lateral_g}
            ticks={grip.session.lateral_ticks}
            why={grip.session.lateral_reason}
          />
          <GripFigure
            label="peak braking"
            g={grip.session.peak_braking_g}
            ticks={grip.session.braking_ticks}
            why={grip.session.braking_reason}
          />
          <Figure label="median grip used" value={grip.session.median_mu.toFixed(2)} unit="g per g" />
          <GripFigure
            label="peak traction"
            g={grip.session.peak_traction_g}
            ticks={grip.session.traction_ticks}
            why={grip.session.traction_reason}
          />
          <Figure
            label="load at its peak"
            value={grip.session.peak_vertical_load_g.toFixed(2)}
            unit="g down"
          />
        </div>

        <div className="rule" style={{ "--fade": "20px", margin: "var(--space-4) 0 var(--space-3)" } as React.CSSProperties} />

        <Eyebrow size={9.5}>grip against speed</Eyebrow>
        <div style={{ marginTop: 7 }}>
          <SpeedBands grip={grip} />
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
        <GripLoadCurve grip={grip} />

        <Panel title="In plain English" padding="var(--space-4)">
          <Explain items={explainGrip(grip)} max={5} />
        </Panel>

        {grip.corners.length > 0 && (
          <Panel
            title="Grip corner by corner"
            sub="pooled across every clean lap"
            padding="var(--space-4)"
            foot={
              <Caveat>
                A corner low on this list is one where the car carried less force
                than it managed elsewhere. Whether that is the corner, the tires
                or the lap is not something one session can separate.
              </Caveat>
            }
          >
            <CornerGripBars grip={grip} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** A directional peak that the session may simply not contain enough of.
 *
 *  Renders the module's own reason instead of a number when the state was too
 *  rare to take a peak from — the figure it replaces used to be a hard 0.00,
 *  which reads as "the car never braked hard" rather than "you barely braked". */
function GripFigure({
  label,
  g,
  ticks,
  why,
}: {
  label: string;
  g: number | null;
  ticks: number;
  why: string | null;
}) {
  if (g == null) {
    return (
      <div>
        <Eyebrow size={9.5}>{label}</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
          <span style={{ font: "500 18px var(--font-heading)", color: dim(30) }}>&mdash;</span>
        </div>
        <div style={{ fontSize: 10, color: dim(38), lineHeight: 1.45, marginTop: 1 }}>
          {why ?? `only ${ticks} ticks`}
        </div>
      </div>
    );
  }
  return <Figure label={label} value={g.toFixed(2)} unit="g" />;
}

/* Grip against speed, in two columns rather than one.
 *
 * This used to plot the ratio alone, and the ratio FALLS with speed on any
 * winged car — so a reader saw "grip drops the faster I go" and had no way to
 * see the other half. Downforce does not raise the ratio; it raises the LOAD,
 * and load-sensitive rubber then returns a little less per unit of it. Both
 * columns together are the story; either one alone misleads.
 *
 * Two scales, so two sets of bars side by side with their own headers — never
 * one plot with two axes, which would invent a relationship between a ratio and
 * a force by whatever alignment the scales happened to land on.
 */
function SpeedBands({ grip }: { grip: GripData }) {
  const measured = grip.bands.filter((b) => b.measured && b.peak_mu != null);
  if (measured.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: dim(50) }}>
        No speed band carried enough ticks to measure grip in.
      </div>
    );
  }
  const muHi = Math.max(...measured.map((b) => b.peak_mu as number), 0.1);
  const loadHi = Math.max(
    ...measured.map((b) => b.median_vertical_load_g ?? 0),
    0.1,
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: 5 }}>
        <span style={{ width: 88 }} />
        <Eyebrow size={9} style={{ flex: 1, color: dim(38) }}>
          load pressing down
        </Eyebrow>
        <Eyebrow size={9} style={{ flex: 1, color: dim(38) }}>
          force back per g of load
        </Eyebrow>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {grip.bands.map((b) => (
          <div key={b.band} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ width: 88, fontSize: 10.5, color: dim(50), textAlign: "right" }}>
              {b.band}
            </span>
            <BandBar
              value={b.measured ? b.median_vertical_load_g ?? null : null}
              max={loadHi}
              color={CH.b}
              reason={b.reason}
            />
            <BandBar
              value={b.measured ? b.peak_mu ?? null : null}
              max={muHi}
              color={CH.a}
              reason={b.reason}
            />
          </div>
        ))}
      </div>

      {grip.downforce && (
        <p style={{ margin: "var(--space-3) 0 0", fontSize: 11, lineHeight: 1.55, color: dim(50) }}>
          {grip.downforce.downforce_note}. {grip.downforce.mu_note}.
        </p>
      )}
    </div>
  );
}

function BandBar({
  value,
  max,
  color,
  reason,
}: {
  value: number | null;
  max: number;
  color: string;
  reason?: string;
}) {
  return (
    <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
        {value != null && (
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${((value / max) * 100).toFixed(1)}%`,
              borderRadius: 5,
              background: color,
              transformOrigin: "left",
              animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
            }}
          />
        )}
      </span>
      <span
        className={value != null ? "num" : undefined}
        style={{
          width: 46,
          textAlign: "right",
          fontSize: 10.5,
          color: value != null ? dim(62) : dim(32),
        }}
        title={reason}
      >
        {value != null ? value.toFixed(2) : "—"}
      </span>
    </span>
  );
}

function CornerGripBars({ grip }: { grip: GripData }) {
  const rows = grip.corners.filter((c) => c.measured && c.peak_mu != null);
  if (rows.length === 0) {
    return <div style={{ fontSize: 11.5, color: dim(50) }}>No corner could be measured.</div>;
  }
  const hi = Math.max(...rows.map((r) => r.peak_mu as number), 0.1);

  return (
    <div className="scrollpane" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260 }}>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span style={{ width: 30, fontSize: 11, color: dim(60), fontWeight: 500 }}>T{r.id}</span>
          <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${(((r.peak_mu as number) / hi) * 100).toFixed(1)}%`,
                borderRadius: 5,
                background: CH.a,
                transformOrigin: "left",
                animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${(0.05 + i * 0.03).toFixed(2)}s`,
              }}
            />
          </span>
          <span className="num" style={{ width: 40, textAlign: "right", fontSize: 11, color: dim(62) }}>
            {(r.peak_mu as number).toFixed(2)}
          </span>
          <span style={{ width: 66, fontSize: 10, color: dim(36), textAlign: "right" }}>
            {r.radius_m != null ? `${r.radius_m} m` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <Eyebrow size={9}>{label}</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
        <span
          className="num"
          style={{ font: "500 17px var(--font-heading)", color: accent ? CH.a : "var(--color-text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 9.5, color: dim(36) }}>{unit}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slip events
// ─────────────────────────────────────────────────────────────────────────────

function SlipPanel({ kind, events }: { kind: "lockup" | "wheelspin"; events: TrackEvent[] }) {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const pattern = kind === "lockup" ? bundle.eventPatterns.lockup : bundle.eventPatterns.wheelspin;
  // `counts` in the module holds the true total; the event list is capped at 50
  // most-severe, so the two can legitimately disagree and the panel says which
  // number is which rather than quietly showing the shorter one as the total.
  const stored = pattern.measured && pattern.events != null ? pattern.events : events.length;
  const color = kind === "lockup" ? CH.loss : CH.warn;

  return (
    <Panel
      title={kind === "lockup" ? "Lockups" : "Wheelspin"}
      sub={`${events.length} shown`}
      padding="var(--space-4)"
      right={<CircleAlert size={14} strokeWidth={1.8} color={events.length ? color : dim(30)} />}
      foot={
        <Caveat>
          {kind === "lockup"
            ? "A lockup here is a wheel turning below half the car's ground speed while the brake pedal was loaded. The channels say when it happened and what was on the car; they cannot say why you were on the brake that hard."
            : "Wheelspin here is a wheel turning more than 10% faster than the ground while you were on power. The driven axle is not modelled, so this is whichever of the four ran away."}
        </Caveat>
      }
    >
      <div style={{ marginBottom: "var(--space-3)" }}>
        <Explain items={[explainPattern(pattern, kind, stored)]} />
      </div>

      {events.length > 0 && (
        <>
          {pattern.measured && pattern.wheel_counts && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
              {Object.entries(pattern.wheel_counts).map(([w, count]) => (
                <span
                  key={w}
                  className="tag tag-outline"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  title={`${wheelName(w)} was involved in ${count} of them`}
                >
                  {wheelName(w)} · {count}
                </span>
              ))}
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>lap</th>
                <th style={{ width: 56 }}>corner</th>
                <th>what was on the car</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 8).map((e, i) => {
                const corner = cornerFor(bundle.corners, e.pct);
                return (
                  <tr key={`${e.lap_number}-${e.pct}-${i}`}>
                    <td className="num">{e.lap_number}</td>
                    <td style={{ color }}>{corner ? `T${corner}` : `${(e.pct * 100).toFixed(0)}%`}</td>
                    <td style={{ color: dim(62), fontSize: 11, lineHeight: 1.5 }}>
                      {explainEvent(kind, e.inputs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {events.length > 8 && (
            <div style={{ fontSize: 10.5, color: dim(38), marginTop: 6 }}>
              The 8 most severe of {events.length} stored are listed. All of them are
              marked on the track map.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* An event is attributed to the corner it BELONGS to, not the corner whose
   geometry happens to contain it. A lockup lives in the braking zone, which is
   before the corner turns in, so matching on [start, end] alone leaves most
   lockups labelled "—". The lead-in below is the same padding the ledger uses. */
const LEAD_IN = 0.035;

function cornerFor(corners: { id: number; start_pct: number; end_pct: number }[], p: number) {
  return corners.find((c) => {
    const start = c.start_pct - LEAD_IN;
    // A corner near the start/finish line has a lead-in that wraps.
    return start < 0 ? p >= start + 1 || p <= c.end_pct : p >= start && p <= c.end_pct;
  })?.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// The g-g plot
// ─────────────────────────────────────────────────────────────────────────────

/** Ring spacing for the g-g plot.
 *
 *  A fixed 0.5 g step is right for a road car and wrong for anything that
 *  reaches 5 g: the labels stack on top of each other in the middle of the plot
 *  and none of them can be read. The step grows so the plot never carries more
 *  than five rings. */
function ringStep(maxG: number): number {
  if (maxG <= 2.5) return 0.5;
  if (maxG <= 5) return 1;
  return Math.ceil(maxG / 5);
}

function TractionCircle() {
  const { bundle } = useProctor();

  const geom = useMemo(() => {
    if (!bundle) return null;
    const maxG = Math.max(1, ...bundle.traction.envelope.map((e) => e.g));
    const s = (210 - 34) / maxG;
    const X = (lat: number) => 210 + lat * s;
    const Y = (lon: number) => 210 - lon * s;
    const rings: { r: number; g: number }[] = [];
    const step = ringStep(maxG);
    for (let g = step; g <= maxG; g += step) rings.push({ r: g * s, g });
    const poly = bundle.traction.envelope
      .map((e) => {
        const r = (e.angle_deg * Math.PI) / 180;
        return `${X(e.g * Math.cos(r)).toFixed(1)},${Y(e.g * Math.sin(r)).toFixed(1)}`;
      })
      .join(" ");
    // Perimeter, so the polygon can draw itself.
    const pts = poly.split(" ").map((p) => p.split(",").map(Number));
    let len = 0;
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return { X, Y, rings, poly, len };
  }, [bundle]);

  if (!bundle || !geom) return null;

  if (bundle.traction.envelope.length === 0) {
    return (
      <Panel title="Everything you demonstrated" padding="var(--space-4)">
        <div style={{ fontSize: 12, color: dim(58), lineHeight: 1.6 }}>
          {bundle.absences.find((a) => a.key === "traction_circle")?.reason ??
            "No g-g envelope was computed for this session."}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Everything you demonstrated"
      sub="every sample of every clean lap"
      padding="var(--space-4)"
      foot={<Caveat>{noteFor("traction.envelope")}</Caveat>}
    >
      <svg viewBox="0 0 420 420" style={{ width: "100%", height: 360, display: "block" }} aria-hidden>
        {geom.rings.map((r) => (
          <g key={r.g}>
            <circle cx={210} cy={210} r={r.r} fill="none" stroke={inkA(0.07)} />
            <text x={214} y={210 - r.r + 11} fill={inkA(0.26)} fontSize={9}>
              {r.g.toFixed(r.g < 10 ? 1 : 0)} g
            </text>
          </g>
        ))}
        <line x1={210} y1={20} x2={210} y2={400} stroke={inkA(0.07)} />
        <line x1={20} y1={210} x2={400} y2={210} stroke={inkA(0.07)} />

        {bundle.traction.scatter
          .filter((_, i) => i % 3 === 0)
          .map(([lat, lon], i) => (
            <circle key={i} cx={geom.X(lat)} cy={geom.Y(lon)} r={1.3} fill={CH.a} opacity={0.3} />
          ))}

        <polygon
          points={geom.poly}
          fill="none"
          stroke={CH.b}
          strokeWidth={1.8}
          style={
            {
              "--len": `${geom.len}px`,
              strokeDasharray: geom.len,
              strokeDashoffset: geom.len,
              animation: "drawIn 1.4s ease-out both",
              animationDirection: "reverse",
            } as React.CSSProperties
          }
        />

        <text x={216} y={30} fill={inkA(0.34)} fontSize={10}>accelerating</text>
        <text x={216} y={408} fill={inkA(0.34)} fontSize={10}>braking</text>
        <text x={22} y={202} fill={inkA(0.34)} fontSize={10}>left</text>
        <text x={366} y={202} fill={inkA(0.34)} fontSize={10}>right</text>
      </svg>
    </Panel>
  );
}

function EnvelopeBars() {
  const { bundle } = useProctor();
  if (!bundle) return null;

  const rows = bundle.laps
    .filter(isUsable)
    .map((l) => ({ n: l.lap_number, v: bundle.traction.laps[l.lap_number] }))
    .filter((r): r is { n: number; v: number } => r.v != null);

  return (
    <Panel
      title="Envelope use, lap by lap"
      sub="share of your own session boundary reached"
      padding="var(--space-4)"
      right={<Gauge size={14} strokeWidth={1.7} color={dim(38)} />}
      foot={
        <Caveat>
          Bars are scaled 0–100%, not normalised to the best lap. A lap at 80%
          reads as 80% — normalising would make every session look the same at a
          glance, which is the opposite of useful. Laps the module could not score
          are left out rather than drawn at zero.
        </Caveat>
      }
    >
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: dim(58) }}>
          No clean lap could be scored against this session&apos;s envelope.
        </div>
      ) : (
        <div className="scrollpane" style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 360 }}>
          {rows.map((r, i) => (
            <div key={r.n} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span className="num" style={{ width: 22, textAlign: "right", fontSize: 11, color: dim(50) }}>
                {r.n}
              </span>
              <span style={{ flex: 1, height: 9, borderRadius: 5, background: dim(7), overflow: "hidden" }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    // 0-100 of the axis, not of the maximum.
                    width: `${r.v.toFixed(1)}%`,
                    borderRadius: 5,
                    background: CH.a,
                    transformOrigin: "left",
                    animation: "growX .55s cubic-bezier(.2,.8,.2,1) both",
                    animationDelay: `${(0.1 + i * 0.03).toFixed(2)}s`,
                  }}
                />
              </span>
              <span className="num" style={{ width: 42, textAlign: "right", fontSize: 11, color: dim(62) }}>
                {fixed(r.v, 1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
