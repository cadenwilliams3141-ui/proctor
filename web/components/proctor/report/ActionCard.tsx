"use client";

/* One action: the corner, the instruction anchored to laps already driven,
 * what it is worth, and — always, never folded away — why it is shown.
 *
 * The sentence is built in lib/proctor/coach.ts from the parser's structured
 * action. This component only lays it out; it adds no words of its own about
 * the driving and no numbers that did not come from the payload. */

import { ChevronRight } from "lucide-react";

import TrackMap from "@/components/proctor/ui/TrackMap";
import { CH, dim } from "@/lib/proctor/channels";
import { describeAction } from "@/lib/proctor/coach";
import { cornerBundle, cornerRange, gridIndex, trackM } from "@/lib/proctor/cornerView";
import { useProctor } from "@/lib/proctor/store";
import type { CoachAction } from "@/lib/proctor/types";

const POSITIONAL = new Set(["brake_on", "release", "turn_in", "pickup", "full"]);

export default function ActionCard({
  action,
  rank,
  showMap = true,
  showOpen = true,
}: {
  action: CoachAction;
  rank?: number;
  showMap?: boolean;
  /** Off on the Corners screen, which is where the button would go. */
  showOpen?: boolean;
}) {
  const { bundle, dispatch } = useProctor();
  if (!bundle) return null;
  const seg = bundle.segments;
  const cb = cornerBundle(action.corner, seg, bundle.cornerLaps, bundle.coach);
  const L = seg?.length_m ?? null;
  const text = describeAction(action, cb?.corner ?? null, L);
  const n = bundle.map.x_m.length;

  const range = cb && L && n ? cornerRange(cb.corner, cb.runs, L, n) : null;
  const marker =
    cb && L && n && POSITIONAL.has(action.metric) ? gridIndex(trackM(cb.corner, action.target, L), L, n) : null;

  const open = () => {
    dispatch({ t: "corner", id: action.corner });
    dispatch({ t: "screen", screen: "corner" });
  };

  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: showMap && range ? "minmax(0, 1fr) 132px" : "minmax(0, 1fr)",
        gap: "var(--space-4)",
        padding: "var(--space-4)",
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-lg)",
        background: "var(--color-surface)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {rank != null && (
            <span className="num" style={{ font: "500 13px var(--font-heading)", color: dim(40) }}>
              {rank}
            </span>
          )}
          <span style={{ font: "500 13px var(--font-heading)", color: "var(--color-accent-300)" }}>{text.where}</span>
          <span className={text.confidence === "strong" ? "tag tag-accent" : "tag tag-neutral"}>
            {text.confidence} evidence
          </span>
          <span style={{ flex: 1 }} />
          <span className="num" style={{ font: "500 18px var(--font-heading)", color: CH.gain }}>
            −{action.gain_s.toFixed(2)} s
          </span>
        </div>

        <p style={{ margin: "var(--space-3) 0 0", fontSize: 15, lineHeight: 1.45, textWrap: "pretty" }}>{text.todo}</p>
        <p style={{ margin: "var(--space-2) 0 0", fontSize: 12.5, lineHeight: 1.5, color: dim(62), textWrap: "pretty" }}>
          {text.observed} {text.gain}
        </p>
        {text.comesWith && (
          <p style={{ margin: "var(--space-2) 0 0", fontSize: 11.5, color: dim(50), textWrap: "pretty" }}>
            {text.comesWith}
          </p>
        )}
        {/* The evidence is part of the action, so it is never behind a fold. */}
        <p style={{ margin: "var(--space-3) 0 0", fontSize: 10.5, lineHeight: 1.5, color: dim(38), textWrap: "pretty" }}>
          {text.because}
        </p>
        {showOpen && <button
          type="button"
          className="btn btn-secondary"
          onClick={open}
          style={{ marginTop: "var(--space-3)", padding: "5px 10px", fontSize: 11.5 }}
        >
          See every pass through {cb?.corner.name ?? `T${action.corner}`} <ChevronRight size={13} />
        </button>}
      </div>

      {showMap && range && (
        <div style={{ width: 132, height: 110, alignSelf: "center" }}>
          <TrackMap
            x={bundle.map.x_m}
            y={bundle.map.y_m}
            w={132}
            h={110}
            pad={10}
            baseWidth={6}
            highlight={{ ...range, color: CH.a }}
            car={marker}
            trail={0}
          />
        </div>
      )}
    </article>
  );
}
