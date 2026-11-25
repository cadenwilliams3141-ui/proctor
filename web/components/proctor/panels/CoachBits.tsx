"use client";

/* The pieces the coach is drawn with, shared by the Coach screen, the aspect
 * screens and the phone.
 *
 * TWO KINDS OF WRITING, KEPT APART. A suggestion card says what to try and
 * quotes the driver's own numbers (lib/proctor/coach.ts). The "why" under it is
 * general technique and carries technique.ts's LABEL, via TechniqueNotes. An
 * equipment fix carries GEAR_FIX_LABEL. None of the three is ever rendered
 * without its label. */

import { ArrowRight, CircleCheck, CircleHelp, Disc3, RotateCw, Route, Target, TrendingUp, TriangleAlert, Waves } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import TechniqueNotes from "@/components/proctor/ui/TechniqueNote";
import { CH, dim, inkA } from "@/lib/proctor/channels";
import { worthLine, type AspectKey, type Figure, type Suggestion } from "@/lib/proctor/coach";
import { PINNABLE } from "@/lib/proctor/focus";
import { allGearChecks, frameCell, GEAR_FIX_LABEL, type GearCheck, type GearFinding, type Verdict } from "@/lib/proctor/gearCheck";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

/* Lucide has no steering wheel or brake pedal, so the aspect glyphs are the
   nearest honest picture: a brake disc, rotation, the throttle's rising line,
   a route, and the friction of the road. */
export const ASPECT_ICON: Record<AspectKey, typeof Disc3> = {
  braking: Disc3,
  turn_in: RotateCw,
  throttle: TrendingUp,
  line: Route,
  grip: Waves,
};

export const VERDICT_TONE: Record<Verdict, string> = {
  "gear-first": CH.warn,
  "looks-like-you": CH.gain,
  "cant-tell": inkA(0.5),
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
export function CompareButton({ lap, corner, primary = false }: { lap: number; corner?: number; primary?: boolean }) {
  const { bundle, dispatch } = useProctor();
  const typical = typicalLap(bundle?.drivingAspects?.lap_times_s);
  if (typical == null || typical === lap) return null;
  return (
    <button
      type="button"
      className={primary ? "btn btn-primary" : "btn btn-secondary"}
      onClick={() => {
        dispatch({ t: "lapA", lap });
        dispatch({ t: "lapB", lap: typical });
        if (corner != null) dispatch({ t: "corner", id: corner });
        dispatch({ t: "view", view: "loss" });
        dispatch({ t: "screen", screen: "analyze" });
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: primary ? 13 : 11.5,
        fontWeight: primary ? 600 : undefined,
        padding: primary ? "8px 14px" : "5px 10px",
      }}
    >
      Compare lap {lap} with lap {typical}
      <ArrowRight size={13} strokeWidth={1.7} aria-hidden />
    </button>
  );
}

/** Make this suggestion the one thing to carry into the next session. */
export function PinButton({ s, big = false }: { s: Suggestion; big?: boolean }) {
  const { focus, pinFocus } = useProctor();
  if (!PINNABLE.includes(s.key)) return null;
  const pinned = focus != null && focus.rule_key === s.key && focus.title === s.title;
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pinned}
      aria-pressed={pinned}
      onClick={() => pinFocus(s)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: big ? 13 : 11.5,
        fontWeight: big ? 600 : undefined,
        padding: big ? "8px 14px" : "5px 10px",
        color: pinned ? CH.a : undefined,
      }}
    >
      <Target size={13} strokeWidth={1.7} aria-hidden />
      {pinned ? "Your focus" : "Make this my focus"}
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
  figures,
  actions,
}: {
  s: Suggestion;
  showWhy?: boolean;
  big?: boolean;
  /** The hero's stat row: replaces the worth line, which it contains. */
  figures?: Figure[];
  /** Drawn after the buttons, on their row (the hero's gear chip). */
  actions?: React.ReactNode;
}) {
  return (
    <article>
      <div
        style={{
          font: big
            ? "var(--font-heading-weight) clamp(22px, 2.4vw + 12px, 30px)/1.14 var(--font-heading)"
            : "var(--font-heading-weight) 15px/1.25 var(--font-heading)",
          textWrap: "balance",
          color: s.blocked ? dim(55) : "var(--color-text)",
          textDecoration: s.blocked ? "line-through" : undefined,
          textDecorationColor: s.blocked ? dim(30) : undefined,
        }}
      >
        {s.title}
      </div>
      {figures && figures.length > 0 ? (
        <StatRow figures={figures} />
      ) : (
        <div
          className="num"
          style={{ marginTop: 6, fontSize: big ? 13 : 11.5, color: s.linked ? CH.warn : CH.loss }}
        >
          {s.linked ? "" : "seems to be "}
          {worthLine(s)}
        </div>
      )}
      <p
        style={{
          margin: "var(--space-3) 0 0",
          fontSize: big ? 14 : 12.5,
          lineHeight: 1.6,
          color: big ? "var(--color-neutral-300)" : dim(72),
          maxWidth: 680,
        }}
      >
        {s.evidence}
      </p>
      {((!s.blocked && (s.laps.length > 0 || PINNABLE.includes(s.key))) || actions) && (
        <div style={{ marginTop: "var(--space-4)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!s.blocked && s.laps.length > 0 && <CompareButton lap={s.laps[0]} corner={s.corners[0]} primary={big} />}
          {!s.blocked && <PinButton s={s} big={big} />}
          {actions}
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

export function GearChip({ check }: { check: GearCheck }) {
  if (!check.findings.length) return <span style={{ fontSize: 10.5, color: dim(38) }}>nothing on the rig decides this</span>;
  return <VerdictChip verdict={check.verdict} />;
}

const FIGURE_TONE: Record<Figure["tone"], string> = {
  loss: CH.loss,
  warn: CH.warn,
  gain: CH.gain,
  neutral: "var(--color-text)",
};

/** Up to four figures between hairlines: a muted label over a mono value in
 *  its tone. Every value is formatted in coach.ts from the report. On a phone
 *  it is a two-by-two grid (`.stat-row` in globals.css). */
export function StatRow({ figures }: { figures: Figure[] }) {
  return (
    <div className="stat-row">
      {figures.map((f) => (
        <div key={f.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, lineHeight: 1.35, color: "var(--color-neutral-500)" }}>{f.label}</div>
          <div className="num" style={{ fontSize: 22, marginTop: 2, color: FIGURE_TONE[f.tone], whiteSpace: "nowrap" }}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const DEVICE: Record<"braking" | "throttle" | "turn_in", string> = {
  braking: "Brake pedal",
  throttle: "Throttle",
  turn_in: "Wheel",
};

/** You or your gear, one cell a device: what each pedal and the wheel
 *  reported, then the PC's frame rate as context. Opens the Gear screen. */
export function GearStrip() {
  const { bundle, dispatch } = useProctor();
  if (!bundle) return null;
  const checks = allGearChecks({
    inputResponse: bundle.inputResponse,
    hardware: bundle.hardware,
    reportCard: bundle.reportCard,
  });
  const pc = frameCell(bundle.reportCard);
  const cells = [
    ...checks.map((g) => ({
      key: g.aspect,
      title: DEVICE[g.aspect as keyof typeof DEVICE] ?? g.aspect,
      tone: g.findings.length ? VERDICT_TONE[g.verdict] : "var(--color-text)",
      line: g.findings.length ? VERDICT_WORDS[g.verdict] : "nothing measured",
    })),
    { key: "pc", title: "PC", tone: pc.dipped ? CH.warn : "var(--color-text)", line: pc.line },
  ];
  return (
    <div className="gear-strip" role="list" aria-label="You or your gear?">
      {cells.map((c) => (
        <button
          key={c.key}
          type="button"
          role="listitem"
          className="pk gear-cell"
          onClick={() => dispatch({ t: "screen", screen: "hardware" })}
          title="Open Gear"
        >
          <span style={{ display: "block", color: c.tone, fontWeight: 600 }}>{c.title}</span>
          <span style={{ display: "block", color: "var(--color-neutral-500)", marginTop: 2 }}>{c.line}</span>
        </button>
      ))}
    </div>
  );
}
