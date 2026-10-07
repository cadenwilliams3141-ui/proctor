"use client";

/* The first step of the guided setup: how much detail.
 *
 * A plain first visit opens here instead of on the launch screen. The driver
 * picks glance, deep or everything, and is taken on to the Rig screen to say
 * what they drive on (the second step, which lives in HardwareScreen.tsx).
 *
 * It asks one question because it has one thing to set. The answer is the same
 * tier the top bar's switch has always set, written the same way, so nothing
 * chosen here is out of reach afterwards. The copy says so: a first-run screen
 * that reads as a commitment gets second-guessed, and this is not one.
 *
 * Nothing here is a reading. The three little stacks of lines are a picture of
 * "less" and "more", not a count of panels. */

import { useEffect, useRef } from "react";

import { Eyebrow } from "@/components/proctor/ui/Caveat";
import { useProctor } from "@/lib/proctor/store";
import { stepOf } from "@/lib/setup";
import { TIER_BLURB, TIERS, type Tier } from "@/lib/tier";

/** How many lines each tier's glyph draws. A picture of density, nothing more. */
const GLYPH_LINES: Record<Tier, number> = { glance: 2, deep: 4, everything: 7 };

function TierGlyph({ tier }: { tier: Tier }) {
  const lines = GLYPH_LINES[tier];
  return (
    <svg className="setup-glyph" viewBox="0 0 56 40" aria-hidden>
      {Array.from({ length: lines }, (_, i) => {
        const gap = 36 / lines;
        return (
          <rect
            key={i}
            x={2}
            y={2 + i * gap}
            // the top line is the answer; the rest trail off under it
            width={i === 0 ? 52 : 52 - ((i * 13) % 27)}
            height={Math.min(4, gap - 2)}
            rx={1.5}
            opacity={i === 0 ? 1 : 0.42}
          />
        );
      })}
    </svg>
  );
}

export default function SetupScreen() {
  const { state, dispatch, setTier } = useProctor();
  const open = state.setup === "detail";

  /* Focus goes to the screen itself, not to one of the three answers: a ring
     round "glance" on arrival would read as a suggestion. From here the first
     Tab lands on the first answer. */
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="setup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-title"
    >
      <div className="setup-glow" aria-hidden />

      <div className="setup-body">
        <Eyebrow>Setup · {stepOf("detail")}</Eyebrow>
        <h1 id="setup-title" className="setup-title">
          How much do you want to see?
        </h1>
        <p className="setup-lede">
          Proctor reads the same session whichever you pick. This only sets how much of it is on
          screen at once, and the switch stays in the top bar, so you can change your mind at any
          time.
        </p>

        <div className="setup-tiers">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className="setup-tier"
              onClick={() => {
                setTier(t);
                dispatch({ t: "setup", step: "rig" });
              }}
            >
              <TierGlyph tier={t} />
              <span className="setup-tier-name">{t}</span>
              <span className="setup-tier-blurb">{TIER_BLURB[t]}</span>
            </button>
          ))}
        </div>

        <div className="setup-foot">
          <span>Next, you build your rig: the layout you drive from and what is bolted to it.</span>
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ t: "setup", step: null })}>
            Skip the setup
          </button>
        </div>
      </div>
    </div>
  );
}
