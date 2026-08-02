"use client";

/* Four views over the SAME data and the SAME selection.
 *
 * All the explored directions were kept rather than picked between, because
 * they answer different questions: "where it went" ranks, "ribbon" correlates,
 * "map & delta" locates, "racing line" shows the road you used and where on it
 * you put the car. They share one selection state — lap A, lap B, cursor,
 * selected corner — so switching view never loses your place. */

import { useMemo } from "react";
import { Info } from "lucide-react";

import MapDelta from "@/components/proctor/views/MapDelta";
import RacingLine from "@/components/proctor/views/RacingLine";
import Ribbon from "@/components/proctor/views/Ribbon";
import WhereItWent from "@/components/proctor/views/WhereItWent";
import { excludedReason } from "@/components/proctor/shell/LapRail";
import { CH, dim } from "@/lib/proctor/channels";
import { useProctor } from "@/lib/proctor/store";
import { atLeast, hiddenNote } from "@/lib/tier";

export default function AnalyzeScreen() {
  const { state, bundle } = useProctor();

  /* Hidden-by-preference must never look like missing data — and the count has
     to be RIGHT. Claiming a panel is hidden when none is teaches the reader to
     ignore the note, which costs more than the note ever buys. So this counts
     what each view actually suppresses, and nothing else. */
  const hidden = useMemo(() => {
    if (atLeast(state.tier, "deep")) return 0;
    if (state.view === "loss") return 1; // "what the car was doing here"
    if (state.view === "map") return 2; // tire strip + inputs
    return 0; // ribbon and racing line are each one panel; nothing to gate
  }, [state.tier, state.view]);

  const note = hiddenNote(state.tier, hidden);

  /* Both lap slots take any lap with a trace now, including the ones excluded
     from every automatic comparison. That is a deliberate capability — the
     flagged lap against the clean one either side of it is exactly the
     comparison you want when working out what the flagged lap did — and it
     comes with a duty to say so. An excluded lap in a comparison must never be
     able to pass for a clean one. */
  const flagged = useMemo(() => {
    if (!bundle) return [];
    return ([["A", state.lapA], ["B", state.lapB]] as const).flatMap(([slot, number]) => {
      const lap = bundle.laps.find((l) => l.lap_number === number);
      const reason = lap ? excludedReason(lap) : null;
      return reason ? [{ slot, number, reason }] : [];
    });
  }, [bundle, state.lapA, state.lapB]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {flagged.length > 0 && (
        <div
          style={{
            flex: "none",
            display: "flex",
            gap: 9,
            alignItems: "flex-start",
            margin: "var(--space-3) var(--space-6) 0",
            padding: "8px 11px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(224,183,106,.09)",
            boxShadow: "inset 0 0 0 1px rgba(224,183,106,.26)",
          }}
        >
          <Info size={13} strokeWidth={2} color={CH.warn} style={{ flex: "none", marginTop: 2 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: dim(72) }}>
            {flagged.map((f) => (
              <div key={f.slot}>
                <strong style={{ fontWeight: 500, color: CH.warn }}>
                  Lap {f.number} is in slot {f.slot}
                </strong>{" "}
                and it is {f.reason}.
              </div>
            ))}
            <div style={{ color: dim(50), marginTop: 3 }}>
              You asked for it, so it is being compared. It stays out of the
              session&apos;s averages, its spread and its reference lap either way.
            </div>
          </div>
        </div>
      )}

      {/* Keyed on the view so each arrives with its own entrance, once. */}
      <div key={state.view} style={{ flex: 1, minHeight: 0, display: "flex", animation: "fadeIn .25s both" }}>
        {state.view === "loss" && <WhereItWent />}
        {state.view === "ribbon" && <Ribbon />}
        {state.view === "map" && <MapDelta />}
        {state.view === "line" && <RacingLine />}
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
      {bundle && state.view === "loss" && bundle.absences.some((a) => a.permanent) && (
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
