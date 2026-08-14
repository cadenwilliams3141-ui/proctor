"use client";

/* What a session does not show, in one block instead of eleven.
 *
 * The honesty rules say a negative result is a finding and an empty panel must
 * never be able to mean "no data". That was already true — every absence
 * carried its own sentence. What went wrong was the WEIGHT: eleven absences
 * rendered as eleven full-size cards, next to five cards that had numbers in
 * them, so a session with plenty to say looked mostly broken. Missing data was
 * louder than present data, which is exactly backwards.
 *
 * So nothing here is deleted or hidden — every title and every reason is still
 * reachable. What changes is that they are grouped by WHY, and only the group
 * lead is loud. The three kinds are genuinely different facts:
 *
 *   permanent — a wall in the file format. Nothing will ever fill it.
 *   stale     — the measurement exists; this session predates it. Re-ingest.
 *   this_run  — the module ran and said it could not measure. Drive more.
 *
 * Telling them apart is the whole value: one is a dead end, one is a chore, one
 * is a lap count. Collapsed into a single "not available" they are all three
 * indistinguishable from a bug.
 */

import { useState } from "react";
import { ChevronDown, Ban, RefreshCw, CircleSlash } from "lucide-react";

import Panel from "@/components/proctor/ui/Panel";
import { Eyebrow } from "@/components/proctor/ui/Caveat";
import { dim } from "@/lib/proctor/channels";
import type { AbsenceKind, ModuleAbsence } from "@/lib/proctor/types";

const GROUPS: {
  kind: AbsenceKind;
  label: string;
  Icon: typeof Ban;
  lead: string;
}[] = [
  {
    kind: "stale",
    label: "Waiting on a re-ingest",
    Icon: RefreshCw,
    lead:
      "These measurements exist, but this session was ingested before they did. The file is complete — re-ingesting it from the rig computes these from the same bytes.",
  },
  {
    kind: "this_run",
    label: "Not measurable in this run",
    Icon: CircleSlash,
    lead:
      "The module ran and reported that it could not measure. That is a finding about this outing, not a fault.",
  },
  {
    kind: "permanent",
    label: "Never available from a disk .ibt",
    Icon: Ban,
    lead:
      "Walls in the file format itself. No future upload fills these in, and nothing is estimated in their place.",
  },
];

export default function Absences({
  absences,
  exclude,
  title = "What this session does not show",
}: {
  absences: ModuleAbsence[];
  /* Keys the calling screen renders itself, in the place the reader went
     looking for that number. Every absence used to appear twice on the Report
     screen — once in the section that owns it and again as a card at the
     bottom — and saying one missing thing twice reads as two missing things.
     Excluding it here does not hide it; it de-duplicates it. */
  exclude?: ReadonlySet<string>;
  title?: string;
}) {
  const shown = exclude ? absences.filter((a) => !exclude.has(a.key)) : absences;

  const groups = GROUPS.map((g) => ({
    ...g,
    items: shown.filter((a) => a.kind === g.kind),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <Panel
      title={title}
      sub={`${shown.length} ${shown.length === 1 ? "measurement" : "measurements"}`}
      padding="var(--space-4)"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {groups.map((g) => (
          <Group key={g.kind} {...g} />
        ))}
      </div>
    </Panel>
  );
}

function Group({
  label,
  Icon,
  lead,
  items,
}: {
  label: string;
  Icon: typeof Ban;
  lead: string;
  items: ModuleAbsence[];
}) {
  /* Collapsed shows every TITLE plus the group's reason, so the reader can
     always see what is missing and why without a click. Expanding adds each
     module's own sentence. Nothing is behind the toggle that changes the
     meaning of what is in front of it. */
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          all: "unset",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          cursor: "pointer",
          padding: "3px 0",
        }}
      >
        <Icon size={13} strokeWidth={1.7} color={dim(45)} style={{ flex: "none" }} aria-hidden />
        <Eyebrow size={9.5} style={{ color: dim(52) }}>
          {label}
        </Eyebrow>
        <span style={{ fontSize: 10.5, color: dim(34) }}>{items.length}</span>
        <span style={{ flex: 1 }} />
        <ChevronDown
          size={13}
          strokeWidth={1.7}
          color={dim(38)}
          style={{
            flex: "none",
            transition: "transform .18s ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
          aria-hidden
        />
      </button>

      <p
        style={{
          margin: "2px 0 0",
          paddingLeft: 20,
          fontSize: 11,
          lineHeight: 1.55,
          color: dim(44),
          textWrap: "pretty",
        }}
      >
        {lead}
      </p>

      {/* Titles are always visible: the reader must be able to see WHAT is
          missing without opening anything. */}
      <div
        style={{
          paddingLeft: 20,
          marginTop: 6,
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 6px",
        }}
      >
        {items.map((a) => (
          <span
            key={a.key}
            style={{
              fontSize: 11,
              lineHeight: 1.45,
              color: dim(62),
              padding: "2px 7px",
              borderRadius: "var(--radius-sm)",
              background: dim(5),
              boxShadow: `inset 0 0 0 1px ${dim(8)}`,
            }}
          >
            {a.title}
          </span>
        ))}
      </div>

      {open && (
        <dl
          style={{
            paddingLeft: 20,
            margin: "var(--space-3) 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            animation: "fadeIn .18s both",
          }}
        >
          {items.map((a) => (
            <div key={a.key}>
              <dt style={{ font: "500 11.5px var(--font-heading)", color: dim(70) }}>{a.title}</dt>
              <dd
                style={{
                  margin: "1px 0 0",
                  fontSize: 11,
                  lineHeight: 1.55,
                  color: dim(48),
                  textWrap: "pretty",
                }}
              >
                {a.reason}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
