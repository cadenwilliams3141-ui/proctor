"use client";

/* The session, at a glance: how quick, how consistent, and where on the track
 * your laps usually fall behind your best one.
 *
 * The module-by-module report — every card, every sentence, every chart — is
 * still here as the "Full breakdown" part (ReportScreen). This page is the one
 * a driver reads first, and it leads with the track: each corner coloured by
 * what your other clean laps typically lost there against your best, with the
 * worst three named and one click from the corner view.
 *
 * "Best corners combined" is your best lap with every corner taken at your own
 * quickest pass through it this session. It was never driven as one lap and
 * the tile says so; it is a sum of your own corners, never an outside target. */

import { useMemo } from "react";

import Absences from "@/components/proctor/ui/Absences";
import CircuitMap from "@/components/proctor/ui/CircuitMap";
import Tile from "@/components/proctor/ui/Tile";
import { LapChart, TREND_ROWS } from "@/components/proctor/screens/ReportScreen";
import { CH, MATCHED_BAND_S, alpha, dim } from "@/lib/proctor/channels";
import { fixed, fmtDay, fmtDelta, fmtLap } from "@/lib/proctor/format";
import { sessionCorners } from "@/lib/proctor/sessionCorners";
import { useProctor } from "@/lib/proctor/store";
import { isUsable } from "@/lib/proctor/types";
import { atLeast, hiddenNote } from "@/lib/tier";

export default function ReportOverview() {
  const { bundle, state, dispatch, referenceLap, cleanLaps } = useProctor();

  const stats = useMemo(() => {
    if (!bundle) return null;
    const clean = bundle.laps.filter(isUsable);
    const times = clean.map((l) => l.lap_time_s as number);
    if (times.length === 0) return { clean, best: null as number | null, sd: 0 };
    const mean = times.reduce((s, v) => s + v, 0) / times.length;
    const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / times.length);
    return { clean, best: Math.min(...times), sd };
  }, [bundle]);

  const where = useMemo(
    () =>
      bundle && referenceLap != null
        ? sessionCorners(bundle.corners, bundle.traces, referenceLap, cleanLaps)
        : null,
    [bundle, referenceLap, cleanLaps],
  );

  if (!bundle || !stats) {
    return <div style={{ padding: "var(--space-8) var(--space-6)", color: dim(45) }}>Reading…</div>;
  }

  const { session } = bundle;
  const deep = atLeast(state.tier, "deep");
  const stint = bundle.stint;

  const openCorner = (id: number) => {
    dispatch({ t: "view", view: "track" });
    dispatch({ t: "corner", id });
    dispatch({ t: "screen", screen: "analyze" });
  };

  // Corners coloured by what the other clean laps typically lost there. The
  // scale is this session's own worst corner, so the reddest corner is always
  // "your most", never measured against anyone else.
  const worstTypical = where ? Math.max(MATCHED_BAND_S, ...where.corners.map((c) => c.typical)) : 0;
  const ranked = where ? [...where.corners].sort((a, b) => b.typical - a.typical) : [];
  const top = ranked.filter((c) => c.typical > MATCHED_BAND_S).slice(0, 3);

  const trends = stint?.trends.measured
    ? TREND_ROWS.map((r) => ({ row: r, s: stint.trends.series?.[r.key] }))
        .filter((x) => x.s?.measured && x.s.change != null)
        .slice(0, 4)
    : [];

  // At a glance: the numbers and the track. The lap chart and the run's
  // trends are what "glance" leaves out.
  const hidden = deep ? 0 : 2;

  return (
    <div className="scrollpane ov">
      <header className="ov-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>{session.track_name ?? "Unknown track"}</h1>
          <div style={{ fontSize: 12, color: dim(50), display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              {[session.car_name, session.session_type, fmtDay(session.recorded_at), `${session.lap_count} ${session.lap_count === 1 ? "lap" : "laps"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {session.wear_masked && <span className="tag-warn">wear masked</span>}
          </div>
        </div>
      </header>

      <div className="ov-tiles ov-tiles-row">
        <Tile label="Best lap" value={stats.best == null ? null : fmtLap(stats.best)} sub={referenceLap != null ? `lap ${referenceLap}` : "no clean lap"} tone={CH.a} />
        <Tile
          label="Best corners combined"
          value={where ? fmtLap(where.combined) : null}
          sub={
            !where
              ? "needs two clean laps"
              : stats.best != null && where.combined > stats.best - 0.0005
                ? "no lap beat your best in any corner"
                : `${fmtDelta(where.combined - (stats.best ?? where.combined))} · never driven as one lap`
          }
          tone={CH.gain}
          title="Your best lap with every corner taken at your own quickest pass through it this session. The straights are your best lap's own."
        />
        <Tile label="Clean laps" value={`${stats.clean.length}`} unit={`of ${bundle.laps.length}`} sub="out, in, partial and flagged left out" />
        <Tile label="Spread" value={stats.clean.length ? stats.sd.toFixed(3) : null} unit="s" sub={stats.clean.length ? "one standard deviation, clean laps" : "no clean laps"} />
        <Tile
          label="Fuel used"
          value={stint?.fuel.measured && stint.fuel.total_used_l != null ? fixed(stint.fuel.total_used_l, 1) : null}
          unit="L"
          sub={
            stint?.fuel.measured
              ? stint.fuel.mean_per_lap_l != null
                ? `${fixed(stint.fuel.mean_per_lap_l, 2)} L a lap`
                : "this session"
              : stint?.fuel.reason ?? "not measured"
          }
        />
      </div>

      {/* ── Where on the track your laps fall behind ─────────────────────── */}
      <section className="ov-panel" style={{ marginTop: "var(--space-4)" }}>
        <div className="ov-h">
          <span>Where your laps lose time</span>
          <span className="ov-h-sub">
            {where ? `your other ${cleanLaps.length - 1} clean laps against your best · click a corner to open it` : ""}
          </span>
        </div>
        {where ? (
          <div className="ov-where">
            <CircuitMap
              label="Each corner coloured by what your other clean laps typically lost there"
              circuit={bundle.map}
              corners={where.corners.map((c) => {
                const corner = bundle.corners.find((x) => x.id === c.id)!;
                const share = c.typical > MATCHED_BAND_S ? c.typical / worstTypical : 0;
                return {
                  corner,
                  color: share > 0 ? alpha(CH.loss, 0.25 + share * 0.75) : null,
                  note: c.typical > MATCHED_BAND_S ? `+${c.typical.toFixed(2)}` : undefined,
                  strong: top.some((t) => t.id === c.id),
                };
              })}
              onCorner={openCorner}
              height={320}
            />
            <div className="ov-top">
              {top.length === 0 ? (
                <div className="ov-lines">Your other clean laps matched your best in every corner, inside {Math.round(MATCHED_BAND_S * 1000)} ms.</div>
              ) : (
                top.map((c, i) => (
                  <button key={c.id} type="button" className="pk ov-toprow" onClick={() => openCorner(c.id)}>
                    <span className="ov-toprow-rank">{i + 1}</span>
                    <span className="ov-toprow-id">Turn {c.id}</span>
                    <span className="num" style={{ color: CH.loss, fontWeight: 600 }}>+{c.typical.toFixed(3)} s</span>
                    <span className="ov-toprow-sub">typical, over {c.laps} laps</span>
                  </button>
                ))
              )}
              <div className="ov-key">
                Colour and number: the median your other clean laps lost in that corner against lap {where.bestLap}.
              </div>
            </div>
          </div>
        ) : (
          <div className="ov-lines">
            {cleanLaps.length === 0
              ? "No clean lap in this session, so there is nothing to measure the others against."
              : "Only one clean lap, so there is no other lap to compare it with."}
          </div>
        )}
      </section>

      {deep && stats.best != null && (
        <section className="ov-panel" style={{ marginTop: "var(--space-4)" }}>
          <div className="ov-h">
            <span>Every lap against your best</span>
            <span className="ov-h-sub">a short bar is a quick lap</span>
          </div>
          <LapChart best={stats.best} sd={stats.sd} />
        </section>
      )}

      {deep && trends.length > 0 && (
        <section style={{ marginTop: "var(--space-4)" }}>
          <div className="ov-h">
            <span>How the run changed</span>
            <span className="ov-h-sub">first third of your clean laps against the last third</span>
          </div>
          <div className="ov-tiles ov-tiles-row">
            {trends.map(({ row, s }) => (
              <Tile
                key={row.key}
                label={row.label}
                value={fmtDelta(s!.change!, row.key === "lap_time_s" ? 3 : 2)}
                unit={s!.unit}
                sub={`${fixed(s!.first_third, 2)} → ${fixed(s!.last_third, 2)}`}
              />
            ))}
          </div>
        </section>
      )}

      {hiddenNote(state.tier, hidden) && <div className="ov-hidden">{hiddenNote(state.tier, hidden)}</div>}

      <section style={{ marginTop: "var(--space-6)" }}>
        <Absences absences={bundle.absences} />
      </section>
    </div>
  );
}
