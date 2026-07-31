"use client";

/* Three views over the SAME data and the SAME selection.
 *
 * All three explored directions were kept rather than picked between, because
 * they answer different questions: "where did it go" ranks, "ribbon" correlates,
 * "map & delta" locates. They share one selection state — lap A, lap B, cursor,
 * selected corner — so switching view never loses your place. */

import { useMemo } from "react";

import MapDelta from "@/components/proctor/views/MapDelta";
import Ribbon from "@/components/proctor/views/Ribbon";
import WhereItWent from "@/components/proctor/views/WhereItWent";
import { dim } from "@/lib/proctor/channels";
import { useProctor } from "@/lib/proctor/store";
import { atLeast, hiddenNote } from "@/lib/tier";

export default function AnalyseScreen() {
  const { state, bundle } = useProctor();

  /* Hidden-by-preference must never look like missing data — and the count has
     to be RIGHT. Claiming a panel is hidden when none is teaches the reader to
     ignore the note, which costs more than the note ever buys. So this counts
     what each view actually suppresses, and nothing else. */
  const hidden = useMemo(() => {
    if (atLeast(state.tier, "deep")) return 0;
    if (state.view === "loss") return 1; // "what the car was doing here"
    if (state.view === "map") return 2; // tire strip + inputs
    return 0; // the ribbon is all one panel; nothing to gate
  }, [state.tier, state.view]);

  const note = hiddenNote(state.tier, hidden);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Keyed on the view so each arrives with its own entrance, once. */}
      <div key={state.view} style={{ flex: 1, minHeight: 0, display: "flex", animation: "fadeIn .25s both" }}>
        {state.view === "loss" && <WhereItWent />}
        {state.view === "ribbon" && <Ribbon />}
        {state.view === "map" && <MapDelta />}
      </div>

      {note && (
        <div
          style={{
            flex: "none",
            padding: "6px var(--space-6) 8px",
            fontSize: 10.5,
            color: dim(42),
            boxShadow: `inset 0 1px 0 ${dim(7)}`,
          }}
        >
          {note}
        </div>
      )}

      {/* Absences travel with the session and are NOT tier-gated. A negative
          result is a finding; hiding it at a lower detail level would leave a
          gap the reader has to notice for themselves. */}
      {bundle && state.view === "loss" && (
        <div
          style={{
            flex: "none",
            padding: "6px var(--space-6) 10px",
            fontSize: 10.5,
            color: dim(34),
            boxShadow: `inset 0 1px 0 ${dim(7)}`,
          }}
        >
          Not shown, because the file does not carry it:{" "}
          {bundle.absences
            .filter((a) => a.permanent)
            .map((a) => a.title.toLowerCase())
            .join(" · ")}
          .
        </div>
      )}
    </div>
  );
}
