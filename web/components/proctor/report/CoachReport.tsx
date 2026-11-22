"use client";

/* The top of the session report: where the time is and what to do about it.
 *
 *   glance       the headline lap figures, the top three actions, what was
 *                watched — the answer, readable in a minute
 *   deep         every action, and every corner ranked by the time on the
 *                table there, with why the corners without an action have none
 *   everything   the same, plus the method the numbers were made by
 *
 * A session the coach could not speak for says so here, in its own words,
 * rather than leaving an empty space where the actions would be. */

import { ChevronRight } from "lucide-react";

import ActionCard from "@/components/proctor/report/ActionCard";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import { CH, dim } from "@/lib/proctor/channels";
import { KIND_LABEL, METRIC_LABEL, coachHeadline, describeAction, watchHighlights } from "@/lib/proctor/coach";
import { fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import type { CoachCorner, WatchKind } from "@/lib/proctor/types";
import { atLeast } from "@/lib/tier";

const STATUS: Record<CoachCorner["status"], { label: string; color: string }> = {
  action: { label: "action", color: CH.gain },
  unexplained: { label: "varies, no clear cause", color: CH.warn },
  consistent: { label: "consistent", color: dim(55) },
  insufficient: { label: "too few passes", color: dim(40) },
};

export default function CoachReport() {
  const { bundle, state } = useProctor();
  if (!bundle) return null;
  const deep = atLeast(state.tier, "deep");
  const everything = atLeast(state.tier, "everything");
  const coach = bundle.coach;

  if (!coach) {
    const why = bundle.absences.find((a) => a.key === "coach");
    return (
      <section style={{ marginTop: "var(--space-6)" }}>
        <Eyebrow color="var(--color-accent-300)">where the time is</Eyebrow>
        <p style={{ margin: "var(--space-2) 0 0", fontSize: 14, color: dim(70), maxWidth: 720, textWrap: "pretty" }}>
          {why?.reason ?? "The coach did not run on this session."}
        </p>
      </section>
    );
  }

  const head = coachHeadline(coach);
  const shown = coach.actions.slice(0, deep ? coach.actions.length : 3);

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <Eyebrow color="var(--color-accent-300)">where the time is</Eyebrow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          gap: "var(--space-4)",
          marginTop: "var(--space-3)",
        }}
      >
        {[
          { l: "your typical lap", v: fmtLap(head.typical), sub: "median of your clean laps" },
          {
            l: "within reach",
            v: fmtLap(head.achievable),
            sub: "typical lap with the actions below",
            c: CH.gain,
          },
          {
            l: "every best corner",
            v: fmtLap(head.theoretical),
            sub: "your best pass at every corner, stitched — optimistic",
          },
        ].map((s) => (
          <div key={s.l}>
            <Eyebrow size={9.5}>{s.l}</Eyebrow>
            <div className="num" style={{ font: "500 24px var(--font-heading)", color: s.c, marginTop: 2 }}>
              {s.v}
            </div>
            <div style={{ fontSize: 10.5, color: dim(40), marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: "var(--space-4) 0 0", fontSize: 14, color: dim(78), maxWidth: 760, textWrap: "pretty" }}>
        {head.sentence}
      </p>

      {shown.length > 0 && (
        <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {shown.map((a, i) => (
            <ActionCard key={`${a.corner}-${a.metric}`} action={a} rank={i + 1} />
          ))}
          {!deep && coach.actions.length > shown.length && (
            <div style={{ fontSize: 11.5, color: dim(45) }}>
              {coach.actions.length - shown.length} more at the &ldquo;deep&rdquo; detail level.
            </div>
          )}
        </div>
      )}

      <WatchSummary />
      {deep && <CornerRanking />}

      <Caveat maxWidth={760}>
        {coach.caveat} Actions need at least {String(coach.method.min_passes ?? "")} usable passes and must
        survive a false-discovery check across all {coach.tests_run} comparisons this session; passes off the
        track, in a tow, after an incident or held up by traffic are left out of every comparison.
      </Caveat>
      {everything && (
        <Caveat maxWidth={760}>
          Gain is the part an input explains — the robust slope of time against that input, times how far
          short of your fastest passes the others fell — never the raw gap to your best, which includes luck.
          Time and inputs are detrended against lap order first. Brake points are compared at matched entry
          speed.
        </Caveat>
      )}
    </section>
  );
}

function WatchSummary() {
  const { bundle } = useProctor();
  const w = bundle?.watch;
  if (!w) return null;
  const kinds = Object.entries(w.counts) as [WatchKind, number][];
  const highlights = watchHighlights(w, 4);
  const unavailable = Object.entries(w.unavailable) as [WatchKind, string][];
  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 13, margin: 0 }}>What was watched</h2>
        <span style={{ fontSize: 11, color: dim(42) }}>
          every tick of {w.laps_watched.length} laps, corner by corner
        </span>
      </div>
      {kinds.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "var(--space-3)" }}>
          {kinds
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <span key={k} className="tag tag-neutral">
                {KIND_LABEL[k]} · <span className="num" style={{ marginLeft: 4 }}>{n}</span>
              </span>
            ))}
        </div>
      ) : (
        <p style={{ margin: "var(--space-2) 0 0", fontSize: 12.5, color: dim(60) }}>
          Nothing flagged on any lap.
        </p>
      )}
      {highlights.length > 0 && (
        <ul style={{ margin: "var(--space-3) 0 0", paddingLeft: 18, fontSize: 12.5, color: dim(70), lineHeight: 1.6 }}>
          {highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {w.none_observed.length > 0 && (
        <p style={{ margin: "var(--space-2) 0 0", fontSize: 11.5, color: dim(48) }}>
          None observed: {w.none_observed.map((k) => KIND_LABEL[k].toLowerCase()).join(", ")}.
        </p>
      )}
      {unavailable.length > 0 && (
        <p style={{ margin: "var(--space-1) 0 0", fontSize: 11.5, color: dim(48) }}>
          Not checkable on this file:{" "}
          {unavailable.map(([k, why]) => `${KIND_LABEL[k].toLowerCase()} (${why})`).join("; ")}.
        </p>
      )}
    </div>
  );
}

function CornerRanking() {
  const { bundle, dispatch } = useProctor();
  const coach = bundle?.coach;
  const seg = bundle?.segments;
  if (!coach || !seg) return null;
  const rows = [...coach.corners].sort((a, b) => (b.opportunity_s ?? -1) - (a.opportunity_s ?? -1));
  const max = Math.max(...rows.map((r) => r.opportunity_s ?? 0), 0.001);
  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 13, margin: 0 }}>Every corner</h2>
        <span style={{ fontSize: 11, color: dim(42) }}>
          ranked by time on the table per lap — how far your passes fell short of your fastest ones there
        </span>
      </div>
      <div style={{ marginTop: "var(--space-3)", display: "grid", gap: 2 }}>
        {rows.map((c) => {
          const corner = seg.corners.find((x) => x.id === c.id);
          const st = STATUS[c.status];
          const lead = coach.actions.find((a) => a.corner === c.id);
          const leadText = lead ? describeAction(lead, corner ?? null, seg.length_m).todo : null;
          const excluded = Object.values(c.excluded ?? {}).reduce((s, v) => s + v, 0);
          const diff = c.differences?.[0];
          return (
            <button
              key={c.id}
              type="button"
              className="crow"
              onClick={() => {
                dispatch({ t: "corner", id: c.id });
                dispatch({ t: "screen", screen: "corner" });
              }}
              style={{
                all: "unset",
                display: "grid",
                gridTemplateColumns: "56px minmax(80px, 140px) minmax(0, 1fr) 20px",
                gap: "var(--space-3)",
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
              }}
            >
              <span style={{ font: "500 14px var(--font-heading)" }}>{corner?.name ?? `T${c.id}`}</span>
              <span>
                <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--color-neutral-800)" }}>
                  <span
                    style={{
                      display: "block",
                      height: 6,
                      borderRadius: 3,
                      width: `${Math.max(2, ((c.opportunity_s ?? 0) / max) * 100)}%`,
                      background: c.status === "action" ? CH.gain : st.color,
                    }}
                  />
                </span>
                <span className="num" style={{ fontSize: 11, color: dim(55) }}>
                  {c.opportunity_s == null ? "—" : `${c.opportunity_s.toFixed(2)} s`}
                </span>
              </span>
              <span style={{ minWidth: 0, fontSize: 12, color: dim(68), textWrap: "pretty" }}>
                <span style={{ color: st.color, marginRight: 8 }}>{st.label}</span>
                {leadText ??
                  (c.status === "unexplained" && diff
                    ? `Your fastest passes differed most in ${METRIC_LABEL[diff.metric]} — not enough to say it caused the gap.`
                    : c.reason ?? "")}
                <span style={{ color: dim(40) }}>
                  {" "}
                  · {c.n} usable passes{excluded ? `, ${excluded} left out` : ""}
                </span>
              </span>
              <ChevronRight size={14} color={dim(40)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
