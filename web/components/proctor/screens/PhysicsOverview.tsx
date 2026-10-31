"use client";

/* Physics, at a glance: what the car did with what you asked of it.
 *
 * The full chain — five numbered steps, every chart and every sentence — is
 * still here as the "Full breakdown" part (ForcesScreen). This is the page a
 * driver reads first: the grip they used as a picture, six numbers each with a
 * few words, where on the track a wheel let go, how each corner was entered,
 * and whether the rig itself sent anything that was not them.
 *
 * NOTHING HERE IS NEW MEASUREMENT. Every figure comes off the same module
 * payloads the breakdown reads, through the same helpers (pedals.ts,
 * equipment.ts, explain.ts), so the two parts cannot disagree.
 *
 * THE ABSENCES STILL GET SAID. A tile whose module did not run shows an em
 * dash and the short reason; the full reason is in the block at the foot,
 * which lists everything not voiced in full on this page and is never
 * tier-gated. */

import { useMemo } from "react";

import Absences from "@/components/proctor/ui/Absences";
import CircuitMap from "@/components/proctor/ui/CircuitMap";
import Tile from "@/components/proctor/ui/Tile";
import { EquipmentCards, TractionCircle } from "@/components/proctor/screens/ForcesScreen";
import { CH, dim } from "@/lib/proctor/channels";
import { explainPattern, explainTrailSession } from "@/lib/proctor/explain";
import { fixed } from "@/lib/proctor/format";
import { brakeCeiling } from "@/lib/proctor/pedals";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import type { TrailBrakingData } from "@/lib/proctor/types";
import { atLeast, hiddenNote } from "@/lib/tier";

/** Absences this page voices IN FULL where the reader looks for them. Only
 *  these two: TractionCircle prints its module's reason as its own empty state,
 *  and EquipmentCards prints hardware's. A tile's short form does not count —
 *  the full sentence must be reachable, so those fall through to the block. */
const VOICED = new Set(["traction_circle", "hardware"]);

export default function PhysicsOverview() {
  const { bundle, state, dispatch } = useProctor();

  const events = useMemo(() => bundle?.events ?? [], [bundle]);
  if (!bundle) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const grip = bundle.grip;
  const ir = bundle.inputResponse;
  const hw = bundle.hardware;
  const deep = atLeast(state.tier, "deep");
  const short = (k: string) => bundle.absences.find((a) => a.key === k)?.short;

  const ceiling = brakeCeiling(hw, ir);
  const brake = ir?.brake.measured ? ir.brake : null;
  const throttle = ir?.throttle.measured ? ir.throttle : null;
  const steering = ir?.steering.measured ? ir.steering : null;
  const irWhy = short("input_response") ?? (ir && !ir.brake.measured ? ir.brake.reason : undefined);

  const lockups = events.filter((e) => e.kind === "lockup");
  const spins = events.filter((e) => e.kind === "wheelspin");

  const openCorner = (id: number) => {
    dispatch({ t: "view", view: "track" });
    dispatch({ t: "corner", id });
    dispatch({ t: "screen", screen: "analyze" });
  };

  // At a glance: the picture, the six numbers and the rig. The track map of
  // slips and the corner entries are the two panels "glance" leaves out.
  const hidden = deep ? 0 : 2;

  return (
    <div className="scrollpane ov">
      {/* ── The grip you used, and the numbers that go with it ─────────── */}
      <div className="ov-hero">
        <div className="ov-gg">
          <TractionCircle />
        </div>
        <div className="ov-tiles">
          <Tile
            label="Grip used"
            value={grip ? grip.session.peak_mu.toFixed(2) : null}
            unit="g per g"
            sub={grip ? "your most, measured" : short("grip")}
            tone={CH.a}
            title={noteFor("grip.mu")}
          />
          <Tile
            label="Brake ceiling"
            value={ceiling.pct == null ? null : fixed(ceiling.pct, 1)}
            unit="% pedal"
            sub={ceiling.pct == null ? ceiling.reason : "your hardest press, moving"}
            bar={ceiling.pct}
            tone={CH.loss}
          />
          <Tile
            label="ABS working"
            value={brake?.abs ? fixed(brake.abs.engaged_pct_of_braking, 0) : null}
            unit="% of braking"
            sub={brake?.abs ? `${brake.abs.activation_events} times it came in` : irWhy ?? "no ABS channel in this car"}
            bar={brake?.abs?.engaged_pct_of_braking}
            tone={CH.warn}
          />
          <Tile
            label="Wheelspin"
            value={throttle?.slip ? fixed(throttle.slip.share_of_on_power_pct, 1) : null}
            unit="% on power"
            sub={throttle?.slip ? "a driven wheel ahead of the ground" : irWhy}
            bar={throttle?.slip?.share_of_on_power_pct}
            tone={CH.warn}
          />
          <Tile
            label="Most lock"
            value={steering ? fixed(steering.peak_steer_deg, 0) : null}
            unit="°"
            sub={steering ? "the most steering you used" : irWhy}
          />
          <Tile
            label="Stopping per pedal"
            value={brake?.decel_per_pedal_g != null ? fixed(brake.decel_per_pedal_g, 2) : null}
            unit="g"
            sub={brake?.decel_per_pedal_g != null ? "median, pedal past half travel" : irWhy}
          />
        </div>
      </div>

      {deep && (
        <div className="ov-row2">
          {/* ── Where on the lap a wheel let go ────────────────────────── */}
          <section className="ov-panel">
            <div className="ov-h">
              <span>Where the wheels let go</span>
              <span className="ov-h-count" style={{ color: CH.loss }}>{lockups.length} lockups</span>
              <span className="ov-h-count" style={{ color: CH.warn }}>{spins.length} wheelspin</span>
            </div>
            <CircuitMap
              label="Every lockup and moment of wheelspin, placed where on the lap it happened"
              circuit={bundle.map}
              corners={bundle.corners.map((c) => ({ corner: c, color: null }))}
              dots={[
                ...spins.map((e) => ({ pct: e.pct, color: CH.warn })),
                ...lockups.map((e) => ({ pct: e.pct, color: CH.loss })),
              ]}
              onCorner={openCorner}
              height={260}
            />
            <div className="ov-lines">
              <div>{explainPattern(bundle.eventPatterns.lockup, "lockup", lockups.length).headline}</div>
              <div>{explainPattern(bundle.eventPatterns.wheelspin, "wheelspin", spins.length).headline}</div>
            </div>
          </section>

          {/* ── How each corner was entered ────────────────────────────── */}
          <section className="ov-panel">
            <div className="ov-h">
              <span>Into the corners</span>
              <span className="ov-h-sub">median of your clean laps · click a corner to open it</span>
            </div>
            {bundle.trailBraking ? (
              <CornerEntries tb={bundle.trailBraking} onCorner={openCorner} />
            ) : (
              <div className="ov-lines">{short("trail_braking") ?? "Not measured for this session."}</div>
            )}
          </section>
        </div>
      )}

      {/* ── The rig, not the driver ──────────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-6)" }}>
        <div className="ov-h">
          <span>Your equipment</span>
          <span className="ov-h-sub">signals from the rig, not from you</span>
        </div>
        <EquipmentCards hw={hw} absences={bundle.absences} />
      </section>

      <Wall />

      {hiddenNote(state.tier, hidden) && <div className="ov-hidden">{hiddenNote(state.tier, hidden)}</div>}

      <section style={{ marginTop: "var(--space-6)" }}>
        <Absences absences={bundle.absences} exclude={VOICED} />
      </section>
    </div>
  );
}

/** One column per corner: how much brake was still on at turn-in, and how long
 *  it stayed on past it. Medians over clean laps, from trail_braking. */
function CornerEntries({ tb, onCorner }: { tb: TrailBrakingData; onCorner: (id: number) => void }) {
  const line = explainTrailSession(tb);
  return (
    <>
      <div className="ov-entries" role="list">
        {tb.corners.map((c) => {
          const m = c.measured ? c.median : null;
          const pct = m?.brake_at_turn_in_pct ?? null;
          const trail = m?.trail_s ?? null;
          return (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className="pk ov-entry"
              onClick={() => onCorner(c.id)}
              title={
                c.measured
                  ? `Turn ${c.id}: ${pct == null ? "no reading" : `${pct.toFixed(0)}% brake at turn-in`}${trail == null ? "" : trail >= 0 ? `, off it ${trail.toFixed(2)} s later` : `, off it ${Math.abs(trail).toFixed(2)} s before turning in`}`
                  : `Turn ${c.id}: ${c.reason}`
              }
            >
              <span className="ov-entry-bar">
                <span style={{ height: `${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%` }} />
              </span>
              <span className="num ov-entry-pct">{pct == null ? "—" : `${pct.toFixed(0)}%`}</span>
              <span className="num ov-entry-trail" style={{ color: trail != null && trail < 0 ? CH.gain : undefined }}>
                {trail == null ? "—" : `${trail >= 0 ? "+" : "−"}${Math.abs(trail).toFixed(2)}`}
              </span>
              <span className="ov-entry-id">T{c.id}</span>
            </button>
          );
        })}
      </div>
      <div className="ov-key">
        bar and % · brake still on at turn-in &nbsp;&nbsp; +s · how long it stayed on after &nbsp;&nbsp;
        <span style={{ color: CH.gain }}>−s</span> · off before turning in
      </div>
      {line && <div className="ov-lines">{line.headline}</div>}
    </>
  );
}

/** The walls, never tier-gated: what no disk .ibt carries and what is never
 *  estimated in its place. Short on screen; the full sentence on hover and in
 *  the breakdown. */
function Wall() {
  const items: [string, string][] = [
    ["brake temperature", noteFor("brake.temperature")],
    ["racecraft", noteFor("racecraft")],
    ["per-tyre load in kg", noteFor("tire.load_kg")],
  ];
  return (
    <div className="ov-wall">
      Not in the file, and never estimated:{" "}
      {items.map(([label, why], i) => (
        <span key={label} title={why} className="ov-wall-item">
          {label}
          {i < items.length - 1 ? " · " : ""}
        </span>
      ))}
    </div>
  );
}
