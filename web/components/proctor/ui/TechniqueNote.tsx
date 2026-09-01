"use client";

/* The labelled half.
 *
 * Everything else on a screen is a reading of THIS driver's file. This block is
 * not, and the whole design job here is making that impossible to miss without
 * making it look like a warning or an error — it is useful content, it is just
 * a different KIND of content.
 *
 * How it is kept apart:
 *  - it never sits inside a measurement panel, always after one;
 *  - it carries an accent-ghost ground and a left rule, so it reads as an aside
 *    rather than as another finding in the same list;
 *  - the eyebrow says what it is before the first sentence is read;
 *  - LABEL is rendered verbatim under every block, from technique.ts, so the
 *    label cannot drift out of sync between screens or be dropped by one of
 *    them. It travels with the data for exactly that reason.
 *
 * A block with no notes renders NOTHING — no heading, no empty box. Unlike an
 * absence, silence here is correct: a technique note is not a measurement, so
 * its absence is not a fact being withheld from the reader. */

import { dim } from "@/lib/proctor/channels";
import { LABEL, type TechniqueNote as Note } from "@/lib/proctor/technique";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";

export default function TechniqueNotes({
  notes,
  title = "What this shape usually means",
  showBecause = true,
}: {
  notes: Note[];
  title?: string;
  showBecause?: boolean;
}) {
  if (!notes.length) return null;

  return (
    <section
      aria-label={title}
      style={{
        marginTop: "var(--space-4)",
        padding: "var(--space-4)",
        borderRadius: "var(--radius-md)",
        borderLeft: `2px solid ${dim(22)}`,
        background: dim(4),
      }}
    >
      <Eyebrow>{title}</Eyebrow>

      <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>
        {notes.map((note, i) => (
          <div key={i}>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: dim(72),
                textWrap: "pretty",
              }}
            >
              {note.body}
            </p>
            {showBecause && (
              /* The measured finding this note hangs off. It is shown, not
                 hidden, so the reader can always see that the note was
                 triggered by something in their own data even though the note
                 itself is not about their data. */
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                  color: dim(34),
                }}
              >
                Shown because {note.because}.
              </p>
            )}
          </div>
        ))}
      </div>

      <Caveat style={{ marginTop: "var(--space-4)" }}>{LABEL}</Caveat>
    </section>
  );
}
