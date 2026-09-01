"use client";

/* The home screen. The ANSWER leads: the gap, what it is made of, then the
   ranked corners. Everything below the fold is evidence, and the corner detail
   is a tap away in a sheet rather than a page you have to come back from. */

import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, deltaColor, dim } from "@/lib/proctor/channels";
import { fixed, fmtDelta, fmtLap } from "@/lib/proctor/format";
import { observationShort, ranked } from "@/lib/proctor/ledger";
import NotDrawable from "@/components/proctor/ui/NotDrawable";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";

export default function MobileLap() {
  const { bundle, state, dispatch, ledger, traceA, traceB, readiness } = useProctor();

  const rows = useMemo(() => (ledger ? ranked(ledger) : []), [ledger]);

  const stack = useMemo(() => {
    if (!ledger) return null;
    const losses = ledger.corners.filter((c) => c.delta > 0.004);
    const total = losses.reduce((s, c) => s + c.delta, 0) + Math.max(0, ledger.remainder);
    const worst = Math.max(...ledger.corners.map((c) => c.delta), 1e-6);
    return { losses, total: total || 1, worst, rest: Math.max(0, ledger.remainder) };
  }, [ledger]);

  const brief = useMemo(() => {
    if (!bundle || !traceA) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    const mean = times.reduce((s, v) => s + v, 0) / Math.max(times.length, 1);
    const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(times.length, 1));
    return [
      { label: "best valid", value: fmtLap(Math.min(...times)), unit: "", color: CH.a },
      { label: "clean laps", value: String(clean.length), unit: `of ${bundle.laps.length}` },
      { label: "spread", value: sd.toFixed(3), unit: "s σ" },
      {
        label: "envelope use",
        value: fixed(bundle.traction.laps[traceA.lap_number] ?? 0, 1),
        unit: "%",
      },
    ];
  }, [bundle, traceA]);

  /* The phone carried the bug the desktop views had fixed in August: one
     "Reading the session…" for four different conditions, only one of which is
     a load. A session with no clean lap can never produce a ledger, so this
     screen promised a result that was never coming. `readiness` is the same
     derivation the desktop uses, so the two now say the same thing. */
  if (readiness.state !== "ready" || !bundle || !ledger || !traceA || !traceB || !stack || !brief) {
    return (
      <NotDrawable readiness={readiness.state === "ready" ? { state: "loading" } : readiness} />
    );
  }

  const clean = bundle.laps.filter(isUsable);
  const best = Math.min(...clean.map((l) => l.lap_time_s as number));

  return (
    <div>
      <header style={{ padding: "var(--space-3) var(--space-6) 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Eyebrow size={10} color="var(--color-accent-300)" style={{ letterSpacing: ".12em" }}>
            session
          </Eyebrow>
          <span style={{ flex: 1 }} />
          {bundle.session.wear_masked && <span className="tag-warn">wear masked</span>}
        </div>
        <h1 style={{ font: "500 21px/1.2 var(--font-heading)", margin: "5px 0 0" }}>
          {bundle.session.track_name}
        </h1>
        <div style={{ fontSize: 12, color: dim(45), marginTop: 3 }}>
          {[bundle.session.car_name, bundle.session.session_type, `${bundle.session.lap_count} ${bundle.session.lap_count === 1 ? "lap" : "laps"}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </header>

      {/* The gap, big. */}
      <Panel style={{ margin: "var(--space-4) var(--space-6) 0" }} padding="var(--space-4)">
        <Eyebrow size={10}>lap {state.lapB} against your best</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
          <span
            className="num"
            style={{
              font: "500 42px/1 var(--font-heading)",
              color: ledger.lapDelta > 0 ? CH.loss : CH.gain,
            }}
          >
            {fmtDelta(ledger.lapDelta)}
          </span>
          <span style={{ fontSize: 14, color: dim(45) }}>s</span>
        </div>
        <div className="num" style={{ fontSize: 12, color: dim(48), marginTop: 3 }}>
          {fmtLap(traceB.lap_time_s)} against {fmtLap(traceA.lap_time_s)}
        </div>

        <div
          style={{
            display: "flex",
            gap: 2,
            height: 20,
            marginTop: "var(--space-4)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {stack.losses.map((c, i) => {
            const share = (c.delta / stack.total) * 100;
            return (
              <div
                key={c.corner.id}
                style={{
                  width: `${share.toFixed(2)}%`,
                  background: `rgba(224,104,94,${(0.3 + 0.55 * (c.delta / stack.worst)).toFixed(2)})`,
                  display: "grid",
                  placeItems: "center",
                  transformOrigin: "left",
                  animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${(0.15 + i * 0.05).toFixed(2)}s`,
                }}
              >
                {share > 8 && (
                  <span style={{ font: "500 8.5px var(--font-heading)", color: "rgba(255,240,238,.9)" }}>
                    T{c.corner.id}
                  </span>
                )}
              </div>
            );
          })}
          {stack.rest > 0 && (
            <div
              style={{
                width: `${((stack.rest / stack.total) * 100).toFixed(2)}%`,
                background: dim(14),
                display: "grid",
                placeItems: "center",
                transformOrigin: "left",
                animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
                animationDelay: `${(0.15 + stack.losses.length * 0.05).toFixed(2)}s`,
              }}
            >
              <span style={{ font: "500 8.5px var(--font-heading)", color: dim(60) }}>rest</span>
            </div>
          )}
        </div>

        <Caveat icon={false} style={{ marginTop: "var(--space-2)" }}>
          Blocks are corners, sized by what each cost. What is left over went to
          the parts of the lap that are not corners.
        </Caveat>
      </Panel>

      {/* Lap B picker — a scrolling chip row instead of a rail. */}
      <div
        className="scrollpane-x"
        style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-4) var(--space-6) 0" }}
      >
        {clean
          .filter((l) => l.lap_number !== state.lapA && bundle.traces[l.lap_number])
          .map((l) => {
            const on = l.lap_number === state.lapB;
            return (
              <button
                key={l.lap_number}
                type="button"
                className="tap"
                onClick={() => dispatch({ t: "lapB", lap: l.lap_number })}
                style={{
                  flex: "none",
                  padding: "8px 11px",
                  borderRadius: "var(--radius-md)",
                  border: 0,
                  fontSize: 11.5,
                  background: on ? "rgba(224,168,106,.14)" : dim(5),
                  boxShadow: on
                    ? "inset 0 0 0 1px rgba(224,168,106,.45)"
                    : `inset 0 0 0 1px ${dim(9)}`,
                  color: on ? CH.b : dim(60),
                }}
              >
                <span style={{ fontWeight: 500 }}>lap {l.lap_number}</span>{" "}
                <span className="num" style={{ opacity: 0.7 }}>
                  +{((l.lap_time_s as number) - best).toFixed(2)}
                </span>
              </button>
            );
          })}
      </div>

      {/* The ranked list. */}
      <section style={{ padding: "var(--space-4) var(--space-6) 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
          <span style={{ font: "500 13px var(--font-heading)" }}>Where it went</span>
          <span style={{ fontSize: 10.5, color: dim(40) }}>tap a corner</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {rows.map((c, i) => (
            <button
              key={c.corner.id}
              type="button"
              className="tap"
              onClick={() => dispatch({ t: "sheet", id: c.corner.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                // 9px padding + content => comfortably over 44px tall.
                padding: "9px var(--space-2)",
                borderRadius: 8,
                border: 0,
                width: "100%",
                textAlign: "left",
                background: i === 0 ? "rgba(224,104,94,.09)" : "transparent",
                animation: "fadeUp .4s both",
                animationDelay: `${(0.2 + i * 0.035).toFixed(2)}s`,
              }}
            >
              <span
                style={{
                  width: 26,
                  flex: "none",
                  font: "500 14px var(--font-heading)",
                  color: i === 0 ? CH.loss : "var(--color-text)",
                }}
              >
                T{c.corner.id}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    height: 7,
                    borderRadius: 4,
                    background: dim(7),
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      borderRadius: 4,
                      width: `${Math.max(2, (Math.abs(c.delta) / ledger.maxAbs) * 100).toFixed(1)}%`,
                      background: deltaColor(c.delta),
                      transformOrigin: "left",
                      animation: "growX .45s cubic-bezier(.2,.8,.2,1) both",
                      animationDelay: `${(0.2 + i * 0.035).toFixed(2)}s`,
                    }}
                  />
                </span>
                {/* Simplified, not truncated: the same claim in fewer words. */}
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: dim(50),
                    marginTop: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {observationShort(c)}
                </span>
              </span>

              <span
                className="num"
                style={{
                  width: 52,
                  flex: "none",
                  textAlign: "right",
                  font: "500 13px var(--font-heading)",
                  color: deltaColor(c.delta),
                }}
              >
                {fmtDelta(c.delta)}
              </span>
              <ChevronRight size={14} color={dim(28)} style={{ flex: "none" }} />
            </button>
          ))}
        </div>
      </section>

      <section style={{ padding: "var(--space-6) var(--space-6) 0" }}>
        <div style={{ font: "500 13px var(--font-heading)", marginBottom: "var(--space-2)" }}>
          The session, briefly
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
          {brief.map((s) => (
            <Panel key={s.label} padding="var(--space-3) var(--space-4)">
              <Eyebrow size={9.5}>{s.label}</Eyebrow>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <span
                  className="num"
                  style={{ font: "500 19px var(--font-heading)", color: s.color ?? "var(--color-text)" }}
                >
                  {s.value}
                </span>
                <span style={{ fontSize: 10, color: dim(38) }}>{s.unit}</span>
              </div>
            </Panel>
          ))}
        </div>
        <Caveat>
          Every comparison here is you against you: the reference is your own
          fastest clean lap of this session.
        </Caveat>
      </section>
    </div>
  );
}
