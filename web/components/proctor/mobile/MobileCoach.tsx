"use client";

/* The coach, on the phone: the one thing to work on, then each part of the
 * driving as a row you can open. Same report, same words and the same labels
 * as the desktop (lib/proctor/coach.ts) — only the layout is the phone's. */

import { ChevronLeft, ChevronRight } from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { GearFix, SuggestionCard, VerdictChip, WorthBar } from "@/components/proctor/panels/CoachBits";
import FocusBanner from "@/components/proctor/panels/FocusBanner";
import GearReadings from "@/components/proctor/panels/GearReadings";
import { ASPECT_ICON } from "@/components/proctor/screens/CoachScreen";
import { CH, dim } from "@/lib/proctor/channels";
import { ASPECT_LABEL, aspectHeadline, worthLine } from "@/lib/proctor/coach";
import { fmtLap } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

const PAD = "var(--space-6)";

export default function MobileCoach() {
  const { bundle, coachReport: r, dispatch } = useProctor();
  if (!bundle || !r) {
    return <div style={{ padding: PAD, color: dim(45) }}>Reading…</div>;
  }
  const da = bundle.drivingAspects;
  const one = r.oneThing;
  const max = Math.max(...r.aspects.map((a) => a.atStakeS ?? 0), 1e-6);

  return (
    <div style={{ padding: `calc(env(safe-area-inset-top, 0px) + ${PAD}) ${PAD} 0` }}>
      <div style={{ font: "500 17px var(--font-heading)" }}>{bundle.session.track_name ?? "Unknown track"}</div>
      <div className="num" style={{ fontSize: 11.5, color: dim(50), marginTop: 2 }}>
        {bundle.session.car_name ?? "unknown car"}
        {da ? ` · typical ${fmtLap(da.median_lap_s)}` : ""}
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <FocusBanner compact />
      </div>
      <Panel padding="var(--space-4)" style={{ borderLeft: `3px solid ${one.kind === "gear" ? CH.warn : CH.a}` }}>
        <Eyebrow style={{ marginBottom: "var(--space-2)" }}>
          {one.kind === "gear" ? "Before technique: your gear" : "Your one thing for next session"}
        </Eyebrow>
        {one.kind === "suggestion" && <SuggestionCard s={one.suggestion} />}
        {one.kind === "gear" && (
          <>
            <GearFix finding={one.finding} />
            <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: dim(62), lineHeight: 1.55 }}>
              It stands in front of: {one.suggestion.title} — {worthLine(one.suggestion)}.
            </div>
          </>
        )}
        {one.kind === "none" && (
          <>
            <div style={{ font: "500 15px/1.4 var(--font-heading)", color: dim(80) }}>
              {r.available ? "No single habit stood out this session." : "No coaching for this session yet."}
            </div>
            <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.6, color: dim(66) }}>
              {one.reason.charAt(0).toUpperCase() + one.reason.slice(1)}
              {/[.!?]$/.test(one.reason) ? "" : "."}
            </div>
          </>
        )}
      </Panel>

      <Eyebrow style={{ margin: "var(--space-6) 0 var(--space-3)" }}>Your driving, part by part</Eyebrow>
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        {r.aspects.map((a) => {
          const Icon = ASPECT_ICON[a.key];
          return (
            <button
              key={a.key}
              type="button"
              className="tap"
              onClick={() => dispatch({ t: "aspect", aspect: a.key })}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 1fr auto 14px",
                alignItems: "center",
                gap: 10,
                minHeight: 56,
                padding: "10px 12px",
                border: 0,
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                boxShadow: "var(--shadow-sm)",
                color: "var(--color-text)",
                textAlign: "left",
              }}
            >
              <Icon size={17} strokeWidth={1.6} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", font: "500 13px var(--font-heading)" }}>{ASPECT_LABEL[a.key]}</span>
                <span style={{ display: "block", marginTop: 5 }}>
                  <WorthBar value={a.atStakeS} max={max} linked={a.linked} />
                </span>
              </span>
              <span className="num" style={{ fontSize: 12.5, color: a.atStakeS ? (a.linked ? CH.warn : CH.loss) : dim(40) }}>
                {a.atStakeS == null ? "—" : `${a.atStakeS.toFixed(2)} s`}
              </span>
              <ChevronRight size={14} strokeWidth={1.6} color={dim(40)} />
            </button>
          );
        })}
      </div>
      {da && <Caveat>{noteFor("aspect.at_stake")}</Caveat>}
    </div>
  );
}

export function MobileAspect() {
  const { coachReport: r, state, dispatch } = useProctor();
  const a = r?.aspects.find((x) => x.key === state.aspect);
  if (!r || !a) return <div style={{ padding: PAD, color: dim(45) }}>Reading…</div>;
  const tips = a.suggestions.filter((s) => s.key !== "drift.improving");

  return (
    <div style={{ padding: `calc(env(safe-area-inset-top, 0px) + ${PAD}) ${PAD} 0` }}>
      <button
        type="button"
        className="tap"
        onClick={() => dispatch({ t: "screen", screen: "coach" })}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", color: CH.a, padding: "6px 0", font: "500 12.5px var(--font-heading)" }}
      >
        <ChevronLeft size={15} strokeWidth={1.7} /> Coach
      </button>
      <div style={{ font: "500 18px/1.35 var(--font-heading)", marginTop: 4 }}>{aspectHeadline(a, r.gates)}</div>
      {a.tendency && <div style={{ marginTop: 6, fontSize: 12.5, color: dim(62) }}>{a.tendency}</div>}
      <Caveat>{noteFor(a.linked ? "coach.linked" : "aspect.at_stake")}</Caveat>

      <Eyebrow style={{ margin: "var(--space-6) 0 var(--space-3)" }}>What to try</Eyebrow>
      {tips.length ? (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {tips.map((s) => (
            <Panel key={`${s.key}-${s.corners.join(",")}`} padding="var(--space-4)">
              <SuggestionCard s={s} />
            </Panel>
          ))}
        </div>
      ) : (
        <Panel padding="var(--space-4)">
          <div style={{ fontSize: 13, lineHeight: 1.6, color: dim(66) }}>
            {r.available
              ? "None of your habits here went with quicker passes strongly enough, across enough laps, to point at."
              : r.reason}
          </div>
        </Panel>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "var(--space-6) 0 var(--space-3)" }}>
        <Eyebrow>You or your gear?</Eyebrow>
        {a.gear.findings.length > 0 && <VerdictChip verdict={a.gear.verdict} />}
      </div>
      <Panel padding="var(--space-4)">
        {a.gear.findings.length === 0 ? (
          <div style={{ fontSize: 12.5, color: dim(62) }}>Nothing on a rig decides this one.</div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {a.gear.findings.map((f) =>
              f.verdict === "gear-first" ? (
                <GearFix key={f.label} finding={f} />
              ) : (
                <div key={f.label}>
                  <VerdictChip verdict={f.verdict} />
                  <div style={{ marginTop: 4, font: "500 12.5px var(--font-heading)" }}>{f.label}</div>
                  <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.55 }}>{f.detail}</div>
                </div>
              ),
            )}
          </div>
        )}
        {a.gear.context && <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: dim(58) }}>{a.gear.context}</div>}
      </Panel>
    </div>
  );
}

export function MobileGear() {
  return (
    <div style={{ padding: `calc(env(safe-area-inset-top, 0px) + ${PAD}) ${PAD} 0` }}>
      <GearReadings pedals={null} wheel={null} />
    </div>
  );
}
