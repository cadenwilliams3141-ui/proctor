"use client";

/* The pieces the coach is drawn with, shared by the Coach screen, the aspect
 * screens and the phone.
 *
 * TWO KINDS OF WRITING, KEPT APART. A suggestion card says what to try and
 * quotes the driver's own numbers (lib/proctor/coach.ts). The "why" under it is
 * general technique and carries technique.ts's LABEL, via TechniqueNotes. An
 * equipment fix carries GEAR_FIX_LABEL. None of the three is ever rendered
 * without its label. */

import { ArrowRight, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import { CH, dim } from "@/lib/proctor/channels";
import { ASPECT_LABEL, aspectHeadline, worthLine, type AspectSummary, type Suggestion } from "@/lib/proctor/coach";
import { GEAR_FIX_LABEL, type GearCheck, type GearFinding, type Verdict } from "@/lib/proctor/gearCheck";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";
import type { CoachGates } from "@/lib/proctor/types";

export const VERDICT_TONE: Record<Verdict, string> = {
  "gear-first": CH.warn,
  "looks-like-you": CH.gain,
  "cant-tell": "rgba(232,234,246,.5)",
};

const VERDICT_WORDS: Record<Verdict, string> = {
  "gear-first": "your gear first",
  "looks-like-you": "looks like you",
  "cant-tell": "can't tell",
};

export function VerdictChip({ verdict, label }: { verdict: Verdict; label?: string }) {
  const Icon = verdict === "gear-first" ? TriangleAlert : verdict === "looks-like-you" ? CircleCheck : CircleHelp;
  const tone = VERDICT_TONE[verdict];
  return (
    <span
      className="tag"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        padding: "2px 8px",
        borderRadius: 999,
        color: tone,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 30%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={11} strokeWidth={1.8} aria-hidden />
      {label ? `${label}: ` : ""}
      {VERDICT_WORDS[verdict]}
    </span>
  );
}

/** The median lap by time: the "typical" lap a quick one is compared with. */
export function typicalLap(times: Record<string, number> | undefined): number | null {
  if (!times) return null;
  const sorted = Object.entries(times).sort((a, b) => a[1] - b[1]);
  if (!sorted.length) return null;
  return Number(sorted[Math.floor(sorted.length / 2)][0]);
}

/** "Compare lap 4 with lap 6" — opens Laps on that pair, at that corner. */
export function CompareButton({ lap, corner }: { lap: number; corner?: number }) {
  const { bundle, dispatch } = useProctor();
  const typical = typicalLap(bundle?.drivingAspects?.lap_times_s);
  if (typical == null || typical === lap) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => {
        dispatch({ t: "lapA", lap });
        dispatch({ t: "lapB", lap: typical });
        if (corner != null) dispatch({ t: "corner", id: corner });
        dispatch({ t: "view", view: "loss" });
        dispatch({ t: "screen", screen: "analyze" });
      }}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "5px 10px" }}
    >
      Compare lap {lap} with lap {typical}
      <ArrowRight size={13} strokeWidth={1.7} aria-hidden />
    </button>
  );
}

export function GearFix({ finding }: { finding: GearFinding }) {
  return (
    <div
      style={{
        marginTop: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        background: `color-mix(in srgb, ${CH.warn} 7%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${CH.warn} 22%, transparent)`,
      }}
    >
      <div style={{ font: "500 12.5px var(--font-heading)", color: CH.warn, marginBottom: 4 }}>
        {finding.label}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: dim(78) }}>{finding.detail}</div>
      {finding.fix && (
        <>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: dim(78), marginTop: 6 }}>{finding.fix}</div>
          <Caveat>{GEAR_FIX_LABEL}</Caveat>
        </>
      )}
    </div>
  );
}

/** One suggestion: what to try, what it is worth, the driver's own evidence,
 *  and — kept visibly apart — why it usually helps. */
export function SuggestionCard({
  s,
  showWhy = true,
  big = false,
}: {
  s: Suggestion;
  showWhy?: boolean;
  big?: boolean;
}) {
  return (
    <article>
      <div
        style={{
          font: `500 ${big ? 22 : 15}px/1.25 var(--font-heading)`,
          letterSpacing: big ? "-.01em" : undefined,
          textWrap: "balance",
          color: s.blocked ? dim(55) : "var(--color-text)",
          textDecoration: s.blocked ? "line-through" : undefined,
          textDecorationColor: s.blocked ? dim(30) : undefined,
        }}
      >
        {s.title}
      </div>
      <div
        className="num"
        style={{ marginTop: 6, fontSize: big ? 13 : 11.5, color: s.linked ? CH.warn : CH.loss }}
      >
        {s.linked ? "" : "seems to be "}
        {worthLine(s)}
      </div>
      <p style={{ margin: "var(--space-2) 0 0", fontSize: big ? 13.5 : 12.5, lineHeight: 1.6, color: dim(72), maxWidth: 680 }}>
        {s.evidence}
      </p>
      {s.laps.length > 0 && !s.blocked && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <CompareButton lap={s.laps[0]} corner={s.corners[0]} />
        </div>
      )}
      {s.blocked && (
        <>
          <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: dim(60) }}>
            Not offered as technique yet — the rig is in the way:
          </div>
          <GearFix finding={s.blocked} />
        </>
      )}
      {showWhy && s.why && !s.blocked && (
        <TechniqueNotes notes={[s.why]} title="Why this usually helps" showBecause={false} />
      )}
      <Caveat maxWidth={680}>{noteFor(s.linked ? "coach.linked" : "coach.suggestion")}</Caveat>
    </article>
  );
}

/** "0.59 s" against the largest billed aspect, as a bar. Linked time is drawn
 *  hatched: it overlaps the billed time and is never added to it. */
export function WorthBar({ value, max, linked }: { value: number | null; max: number; linked: boolean }) {
  const w = value == null || max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div style={{ height: 6, borderRadius: 3, background: dim(6), overflow: "hidden" }}>
      <div
        style={{
          width: `${w}%`,
          height: "100%",
          borderRadius: 3,
          background: linked
            ? `repeating-linear-gradient(135deg, ${CH.warn} 0 4px, transparent 4px 7px)`
            : CH.loss,
          transition: "width .5s ease",
        }}
      />
    </div>
  );
}

export function AspectTile({
  a,
  max,
  gates,
  Icon,
}: {
  a: AspectSummary;
  max: number;
  gates: CoachGates | null;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  const { dispatch } = useProctor();
  const top = a.suggestions.find((s) => s.key !== "drift.improving");
  return (
    <button
      type="button"
      className="pk coach-tile"
      onClick={() => dispatch({ t: "aspect", aspect: a.key })}
      style={{
        textAlign: "left",
        border: 0,
        cursor: "pointer",
        background: "var(--color-surface)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        color: "var(--color-text)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: dim(60) }}>
        <Icon size={16} strokeWidth={1.6} />
        <span style={{ font: "500 12.5px var(--font-heading)", color: "var(--color-text)" }}>{ASPECT_LABEL[a.key]}</span>
        <span style={{ flex: 1 }} />
        <ArrowRight size={13} strokeWidth={1.6} />
      </div>
      <div className="num" style={{ font: "500 22px var(--font-heading)", color: a.atStakeS ? (a.linked ? CH.warn : CH.loss) : dim(40) }}>
        {a.atStakeS == null ? "—" : `${a.atStakeS.toFixed(2)} s`}
        <span style={{ fontSize: 11, marginLeft: 6, color: dim(42), fontWeight: 400 }}>
          {a.atStakeS == null ? "not measured" : a.linked ? "went with" : "up to, a lap"}
        </span>
      </div>
      <WorthBar value={a.atStakeS} max={max} linked={a.linked} />
      <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(70), minHeight: 36 }}>
        {top ? top.title : aspectHeadline(a, gates)}
      </div>
      {a.tendency && <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(46) }}>{a.tendency}</div>}
      <div style={{ marginTop: "auto", paddingTop: 4 }}>
        <GearChip check={a.gear} />
      </div>
    </button>
  );
}

export function GearChip({ check }: { check: GearCheck }) {
  if (!check.findings.length) return <span style={{ fontSize: 10.5, color: dim(38) }}>nothing on the rig decides this</span>;
  return <VerdictChip verdict={check.verdict} />;
}
