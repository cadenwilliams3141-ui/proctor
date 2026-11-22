"use client";

/* The phone's home screen: the after-session read, answer first.
 *
 * On the sofa you have a minute. So: the lap within reach, the actions your
 * own fastest passes demonstrated (each one tap from its corner sheet), what
 * was watched, and the corners ranked by time on the table. Every action keeps
 * its evidence line — the rule travels with the words, phone or not. */

import { ChevronRight } from "lucide-react";

import { Eyebrow } from "@/components/proctor/ui/Caveat";
import { CH, dim } from "@/lib/proctor/channels";
import { coachHeadline, describeAction, watchHighlights } from "@/lib/proctor/coach";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";

export default function MobileReport() {
  const { bundle, dispatch } = useProctor();
  if (!bundle) return <div style={{ padding: "var(--space-6)", color: dim(45) }}>Reading…</div>;
  const { session, coach, segments: seg, watch } = bundle;

  return (
    <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + var(--space-6)) var(--space-6) 120px" }}>
      <Eyebrow color="var(--color-accent-300)">session report</Eyebrow>
      <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>{session.track_name ?? "Unknown track"}</h1>
      <div style={{ fontSize: 12, color: dim(48) }}>
        {[session.car_name, session.session_type, fmtDay(session.recorded_at)].filter(Boolean).join(" · ")}
      </div>

      {!coach ? (
        <p style={{ marginTop: "var(--space-6)", fontSize: 13.5, color: dim(70), lineHeight: 1.55 }}>
          {bundle.absences.find((a) => a.key === "coach")?.reason ?? "The coach did not run on this session."}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
            <div>
              <Eyebrow size={9.5}>typical lap</Eyebrow>
              <div className="num" style={{ font: "500 22px var(--font-heading)" }}>{fmtLap(coach.typical_lap_s)}</div>
            </div>
            <div>
              <Eyebrow size={9.5}>within reach</Eyebrow>
              <div className="num" style={{ font: "500 22px var(--font-heading)", color: CH.gain }}>
                {fmtLap(coach.achievable_lap_s)}
              </div>
            </div>
          </div>
          <p style={{ margin: "var(--space-3) 0 0", fontSize: 13, color: dim(72), lineHeight: 1.5 }}>
            {coachHeadline(coach).sentence}
          </p>

          <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            {coach.actions.slice(0, 3).map((a) => {
              const corner = seg?.corners.find((c) => c.id === a.corner) ?? null;
              const t = describeAction(a, corner, seg?.length_m ?? null);
              return (
                <button
                  key={`${a.corner}-${a.metric}`}
                  type="button"
                  className="tap"
                  onClick={() => dispatch({ t: "sheet", id: a.corner })}
                  style={{
                    all: "unset",
                    display: "block",
                    padding: "var(--space-4)",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-divider)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ font: "500 13px var(--font-heading)", color: "var(--color-accent-300)" }}>{t.where}</span>
                    <span style={{ flex: 1 }} />
                    <span className="num" style={{ font: "500 16px var(--font-heading)", color: CH.gain }}>
                      −{a.gain_s.toFixed(2)} s
                    </span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>{t.todo}</div>
                  <div style={{ fontSize: 10.5, color: dim(40), marginTop: 6, lineHeight: 1.5 }}>
                    {t.confidence} evidence · {a.evidence.n} passes · fastest {a.evidence.target_laps.length === 1 ? "lap" : "laps"}{" "}
                    {[...a.evidence.target_laps].sort((x, y) => x - y).join(", ")}
                  </div>
                </button>
              );
            })}
          </div>

          {watch && watchHighlights(watch, 3).length > 0 && (
            <div style={{ marginTop: "var(--space-6)" }}>
              <Eyebrow size={9.5}>what was watched</Eyebrow>
              <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: 18, fontSize: 12.5, color: dim(70), lineHeight: 1.6 }}>
                {watchHighlights(watch, 3).map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: "var(--space-6)" }}>
            <Eyebrow size={9.5}>every corner, by time on the table</Eyebrow>
            <div style={{ marginTop: "var(--space-2)" }}>
              {[...coach.corners]
                .sort((a, b) => (b.opportunity_s ?? -1) - (a.opportunity_s ?? -1))
                .map((c) => {
                  const name = seg?.corners.find((x) => x.id === c.id)?.name ?? `T${c.id}`;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="tap"
                      onClick={() => dispatch({ t: "sheet", id: c.id })}
                      style={{
                        all: "unset",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "10px 4px",
                        borderBottom: "1px solid var(--color-divider)",
                      }}
                    >
                      <span style={{ font: "500 14px var(--font-heading)", width: 40 }}>{name}</span>
                      <span style={{ flex: 1, fontSize: 12, color: dim(60) }}>
                        {c.status === "action"
                          ? "action"
                          : c.status === "unexplained"
                            ? "varies, no clear cause"
                            : c.status === "consistent"
                              ? "consistent"
                              : "too few passes"}
                      </span>
                      <span className="num" style={{ fontSize: 12.5, color: c.status === "action" ? CH.gain : dim(55) }}>
                        {c.opportunity_s == null ? "—" : `${c.opportunity_s.toFixed(2)} s`}
                      </span>
                      <ChevronRight size={14} color={dim(35)} />
                    </button>
                  );
                })}
            </div>
            <p style={{ fontSize: 10.5, color: dim(36), marginTop: "var(--space-3)", lineHeight: 1.5 }}>
              {seg?.numbering}. {coach.caveat}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
