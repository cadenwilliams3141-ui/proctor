"use client";

/* What the rig reported in this session, by device: is it you, or your gear?
 *
 * Three devices, because those are what the file can speak for: the pedals
 * (the brake's top end, brief jumps, noise, the throttle's range), the wheel
 * (force at its limit, overall and by corner) and the PC (frame rate). Each
 * verdict comes from lib/proctor/gearCheck.ts with its numbers; the fixes are
 * general equipment advice and say so.
 *
 * The product names come from the rig builder below — the driver's own word,
 * because nothing in a .ibt names the hardware behind a channel. They are
 * tagged as such wherever they appear. */

import { Cpu, Disc3, Footprints } from "lucide-react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { EquipmentCards } from "@/components/proctor/panels/ForcesPanels";
import { GearFix, VerdictChip } from "@/components/proctor/panels/CoachBits";
import { dim } from "@/lib/proctor/channels";
import { gearCheck, type GearCheck, type GearFinding, type Verdict } from "@/lib/proctor/gearCheck";
import { noteFor } from "@/lib/proctor/provenance";
import { useProctor } from "@/lib/proctor/store";

const RANK: Record<Verdict, number> = { "looks-like-you": 0, "cant-tell": 1, "gear-first": 2 };

function Finding({ f }: { f: GearFinding }) {
  if (f.verdict === "gear-first") return <GearFix finding={f} />;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
      <VerdictChip verdict={f.verdict} />
      <span style={{ font: "500 12px var(--font-heading)" }}>{f.label}</span>
      <span style={{ fontSize: 12, color: dim(62), lineHeight: 1.55 }}>{f.detail}</span>
    </div>
  );
}

function Device({
  title,
  named,
  Icon,
  checks,
  extra,
}: {
  title: string;
  named: string | null;
  Icon: typeof Cpu;
  checks: GearCheck[];
  extra?: React.ReactNode;
}) {
  const findings = checks.flatMap((c) => c.findings);
  const verdict = findings.reduce<Verdict>((v, f) => (RANK[f.verdict] > RANK[v] ? f.verdict : v), "looks-like-you");
  return (
    <Panel padding="var(--space-4)">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-3)", flexWrap: "wrap" }}>
        <Icon size={16} strokeWidth={1.6} color={dim(60)} />
        <span style={{ font: "500 13.5px var(--font-heading)" }}>{title}</span>
        {named && (
          <span className="tag tag-outline" title="What you said is in this slot. The file cannot name hardware." style={{ fontSize: 10, padding: "1px 7px" }}>
            {named} · your word
          </span>
        )}
        <span style={{ flex: 1 }} />
        {findings.length > 0 && <VerdictChip verdict={verdict} />}
      </div>
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {findings.map((f) => (
          <Finding key={f.label} f={f} />
        ))}
        {extra}
      </div>
    </Panel>
  );
}

export default function GearReadings({ pedals, wheel }: { pedals: string | null; wheel: string | null }) {
  const { bundle } = useProctor();

  if (!bundle) {
    return (
      <Panel padding="var(--space-4)">
        <div style={{ fontSize: 12.5, color: dim(62) }}>
          Open a session to see what your pedals and wheel reported in it.
        </div>
      </Panel>
    );
  }

  const inp = { inputResponse: bundle.inputResponse, hardware: bundle.hardware, reportCard: bundle.reportCard };
  const braking = gearCheck("braking", inp);
  const throttle = gearCheck("throttle", inp);
  const wheelCheck = gearCheck("turn_in", inp);
  const fh = bundle.reportCard?.frame_health;

  return (
    <section>
      <Eyebrow style={{ marginBottom: "var(--space-3)" }}>
        Is it you or your gear? · {bundle.session.track_name ?? "this session"}
      </Eyebrow>
      <div className="gear-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "var(--space-4)" }}>
        <Device title="Pedals" named={pedals} Icon={Footprints} checks={[braking, throttle]} />
        <Device title="Wheel" named={wheel} Icon={Disc3} checks={[wheelCheck]} />
        <Panel padding="var(--space-4)">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-3)" }}>
            <Cpu size={16} strokeWidth={1.6} color={dim(60)} />
            <span style={{ font: "500 13.5px var(--font-heading)" }}>PC</span>
          </div>
          <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.6 }}>
            {!fh
              ? "Frame rate was not read for this session."
              : !fh.available
                ? fh.reason
                : fh.sub_60_seconds > 0
                  ? `Below 60 fps for ${fh.sub_60_seconds.toFixed(1)} s, lowest ${fh.min_fps.toFixed(0)} fps (average ${fh.mean_fps.toFixed(0)}). A dropped frame is a moment the sim and your inputs drift apart.`
                  : `Never below 60 fps (average ${fh.mean_fps.toFixed(0)}, lowest ${fh.min_fps.toFixed(0)}).`}
          </div>
        </Panel>
      </div>
      {/* Not folded: these cards state their own absences when a module did
          not run, and an absence never goes behind a disclosure. */}
      <Eyebrow style={{ margin: "var(--space-5) 0 var(--space-3)" }}>The raw readings</Eyebrow>
      <EquipmentCards hw={bundle.hardware} absences={bundle.absences} />
      <Caveat maxWidth={760}>{noteFor("gear.verdict")}</Caveat>
    </section>
  );
}
