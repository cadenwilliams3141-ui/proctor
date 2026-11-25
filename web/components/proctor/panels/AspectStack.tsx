"use client";

/* "Your driving": the five aspects as a stack of cards, the one worth most at
 * the top. Shared by the Coach (beside the one thing, which is outlined), the
 * aspect screens (where it is the navigation, the current one outlined) and
 * the phone.
 *
 * Each card is the aspect's time, a bar against the largest, the top tip (or,
 * when nothing stood out, the headline that says so) and its "you or your
 * gear?" chip. Linked time — line and grip — is labelled "went with" and drawn
 * hatched, because it overlaps the billed time and is never added to it. */

import { ArrowRight } from "lucide-react";

import { ASPECT_ICON, GearChip, WorthBar } from "@/components/proctor/panels/CoachBits";
import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import { CH, dim } from "@/lib/proctor/channels";
import { aspectHeadline, type AspectKey, type AspectSummary } from "@/lib/proctor/coach";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

/** Worth first; an aspect with no measurement goes last. */
export function byWorth(aspects: AspectSummary[]): AspectSummary[] {
  return [...aspects].sort((a, b) => (b.atStakeS ?? -1) - (a.atStakeS ?? -1));
}

export default function AspectStack({
  outlined,
  showGap = false,
  title = "Your driving",
}: {
  /** The aspect to outline: the one thing's on the Coach, the open one on an aspect screen. */
  outlined?: AspectKey | null;
  /** The theoretical-vs-actual line and its caveat, under the stack. */
  showGap?: boolean;
  title?: string;
}) {
  const { bundle, coachReport: r, dispatch, state } = useProctor();
  if (!bundle || !r) return null;
  const da = bundle.drivingAspects;
  const aspects = byWorth(r.aspects);
  const max = Math.max(...aspects.map((a) => a.atStakeS ?? 0), 1e-6);

  return (
    <section aria-label="Your driving, part by part" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <Eyebrow>{title}</Eyebrow>
      {aspects.map((a) => (
        <AspectCard
          key={a.key}
          a={a}
          max={max}
          outlined={a.key === outlined}
          current={state.screen === "aspect" && state.aspect === a.key}
          onOpen={() => dispatch({ t: "aspect", aspect: a.key })}
        />
      ))}
      {showGap && da && (
        <>
          <div className="num" style={{ fontSize: 11.5, lineHeight: 1.55, color: dim(55), marginTop: 2 }}>
            Up to {da.theoretical_gap_s.toFixed(2)} s a lap if every stretch matched your own quick passes;{" "}
            {da.actual_gap_s.toFixed(2)} s between your typical and second-best laps.
          </div>
          <Caveat>{noteFor("aspect.at_stake")}</Caveat>
        </>
      )}
    </section>
  );
}

function AspectCard({
  a,
  max,
  outlined,
  current,
  onOpen,
}: {
  a: AspectSummary;
  max: number;
  outlined: boolean;
  current: boolean;
  onOpen: () => void;
}) {
  const { coachReport: r } = useProctor();
  const Icon = ASPECT_ICON[a.key];
  const top = a.suggestions.find((s) => s.key !== "drift.improving");
  const v = a.atStakeS;
  const tone = v == null || v <= 0 ? "var(--color-neutral-600)" : a.linked ? CH.warn : CH.loss;

  return (
    <button
      type="button"
      className="pk aspect-card"
      data-outlined={outlined || undefined}
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: outlined ? "var(--ch-a)" : "var(--color-neutral-500)", display: "inline-flex" }}>
          <Icon size={16} strokeWidth={1.7} />
        </span>
        <span style={{ font: "var(--font-heading-weight) 16px var(--font-heading)", flex: 1, minWidth: 0 }}>{a.label}</span>
        <span className="num" style={{ fontSize: 10.5, color: dim(45) }}>
          {v == null ? "not measured" : a.linked ? "went with" : "up to"}
        </span>
        <span className="num" style={{ fontSize: 18, color: tone }}>
          {v == null ? "—" : `${v.toFixed(2)} s`}
        </span>
      </span>
      {v != null && v > 0 && (
        <span style={{ display: "block", marginTop: 10 }}>
          <WorthBar value={v} max={max} linked={a.linked} />
        </span>
      )}
      <span style={{ display: "block", fontSize: 12.5, lineHeight: 1.5, color: "var(--color-neutral-300)", marginTop: 8 }}>
        {top ? top.title : aspectHeadline(a, r?.gates ?? null)}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <GearChip check={a.gear} />
        <span style={{ flex: 1 }} />
        {!current && <ArrowRight size={13} strokeWidth={1.6} color="var(--color-neutral-500)" aria-hidden />}
      </span>
    </button>
  );
}
