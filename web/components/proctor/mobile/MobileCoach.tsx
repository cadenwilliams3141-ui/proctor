"use client";

/* The coach, on the phone: the one thing to work on, then each part of the
 * driving as a card you can open. Same report, same words, the same labels and
 * the same Carbon pieces as the desktop (the stat row, the gear strip, the
 * aspect stack) — only the layout is the phone's. */

import { ChevronLeft } from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { GearFix, GearStrip, StatRow, SuggestionCard, VerdictChip } from "@/components/proctor/panels/CoachBits";
import AspectStack from "@/components/proctor/panels/AspectStack";
import FocusBanner from "@/components/proctor/panels/FocusBanner";
import GearReadings from "@/components/proctor/panels/GearReadings";
import { CH, dim } from "@/lib/proctor/channels";
import { aspectHeadline, heroFigures, worthLine } from "@/lib/proctor/coach";
import { fmtLap } from "@/lib/proctor/format";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

const PAD = "var(--space-6)";

export default function MobileCoach() {
  const { bundle, coachReport: r } = useProctor();
  if (!bundle || !r) {
    return <div style={{ padding: PAD, color: dim(45) }}>Reading…</div>;
  }
  const da = bundle.drivingAspects;
  const one = r.oneThing;
  const aspect = one.kind === "none" ? null : r.aspects.find((a) => a.key === one.suggestion.aspect) ?? null;

  return (
    <div style={{ padding: `calc(env(safe-area-inset-top, 0px) + ${PAD}) ${PAD} 0` }}>
      <div style={{ font: "var(--font-heading-weight) 19px var(--font-heading)" }}>{bundle.session.track_name ?? "Unknown track"}</div>
      <div className="num" style={{ fontSize: 12, color: "var(--color-neutral-500)", marginTop: 2 }}>
        {bundle.session.car_name ?? "unknown car"}
        {da ? ` · typical ${fmtLap(da.median_lap_s)}` : ""}
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <FocusBanner compact />
      </div>
      <section className="coach-hero" aria-label="Your one thing">
        <div className="coach-hero-text">
          <Eyebrow size={12} color={one.kind === "gear" ? CH.warn : one.kind === "none" ? undefined : CH.a} style={{ marginBottom: "var(--space-3)" }}>
            {one.kind === "gear" ? "Before technique: your gear" : "Your one thing"}
          </Eyebrow>
          {one.kind === "suggestion" && (
            <SuggestionCard
              s={one.suggestion}
              big
              figures={heroFigures(one.suggestion, aspect)}
              actions={aspect && <VerdictChip verdict={aspect.gear.verdict} label="Gear" />}
            />
          )}
          {one.kind === "gear" && (
            <>
              <StatRow figures={heroFigures(one.suggestion, aspect).slice(0, 2)} />
              <GearFix finding={one.finding} />
              <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: dim(62), lineHeight: 1.55 }}>
                It stands in front of: {one.suggestion.title} — {worthLine(one.suggestion)}.
              </div>
            </>
          )}
          {one.kind === "none" && (
            <>
              <div style={{ font: "var(--font-heading-weight) 17px/1.35 var(--font-heading)", color: dim(85) }}>
                {r.available ? "No single habit stood out this session." : "No coaching for this session yet."}
              </div>
              <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.6, color: "var(--color-neutral-300)" }}>
                {one.reason.charAt(0).toUpperCase() + one.reason.slice(1)}
                {/[.!?]$/.test(one.reason) ? "" : "."}
              </div>
            </>
          )}
        </div>
        <GearStrip />
      </section>

      <div style={{ marginTop: "var(--space-6)" }}>
        <AspectStack outlined={aspect?.key ?? null} />
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
      <div style={{ font: "var(--font-heading-weight) 21px/1.25 var(--font-heading)", marginTop: 4 }}>{aspectHeadline(a, r.gates)}</div>
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
