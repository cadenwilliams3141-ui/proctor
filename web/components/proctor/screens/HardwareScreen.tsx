"use client";

/* Rig. Where the seven mounting slots are, and what is known about each.
 *
 * What is known about each is, today, nothing — and this screen says exactly
 * that rather than dressing the gap. Proctor has no table for what hardware is
 * mounted and nothing in a .ibt names the product behind a channel, so there is
 * no component list to show. What there IS to show is the rig itself: a generic
 * model you can walk round and sit in, with the slots a future inventory will
 * hang off.
 *
 * THE LAYOUT SWITCH. Not everyone drives from a cockpit, so the drawing comes
 * as a desk, a wheel stand or a cockpit, with one screen or three. That choice
 * is about which picture to look at. It is kept in this browser's storage and
 * nowhere else, it is not a record of the driver's rig, and nothing downstream
 * reads it.
 *
 * Three things were left out on purpose, because each would have been a control
 * or a figure with nothing behind it:
 *
 *   - no "add a component" button      there is nowhere to save one
 *   - no component names or dates      nothing has been recorded
 *   - no field-of-view figure          it would be the model's, not the driver's
 *
 * WHY THE ID IS `hardware` AND NOT `rig`. `rig` is taken: it is the Physics
 * screen's id, kept unchanged because it is in ?screen= links people have saved
 * (see shell/IconRail.tsx). This screen is labelled "Rig" and lives one item
 * below it.
 *
 * The 3D view pulls in three.js, which is most of a megabyte. It is loaded only
 * when this screen opens, so a driver who never comes here never downloads it. */

import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { dim } from "@/lib/proctor/channels";
import {
  RIG_LAYOUTS,
  RIG_PREFS_KEY,
  RIG_SLOTS,
  parseRigPrefs,
  rigLayout,
  type RigLayoutKey,
  type RigPrefs,
  type RigScreens,
  type RigSlotKey,
} from "@/lib/proctor/rig";

const SCREEN_CHOICES: readonly { key: RigScreens; label: string }[] = [
  { key: "single", label: "One screen" },
  { key: "triple", label: "Triples" },
];

/* Which layout's poster stands in while three.js is on its way. next/dynamic
   hands its loading component no props, so the layout reaches it this way.
   Null is the moment before the saved choice has been read. */
const PosterLayout = createContext<RigLayoutKey | null>(null);

/* The same box the scene will occupy, already showing the model, so the panel
   does not jump when the 3D view arrives. */
function StagePlaceholder() {
  const layout = useContext(PosterLayout);
  return (
    <div className="rig-stage" data-state="loading">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {layout && <img className="rig-poster" alt="" src={rigLayout(layout).poster} />}
      <span className="rig-note">loading the 3D view</span>
    </div>
  );
}

const RigScene = dynamic(() => import("@/components/proctor/views/RigScene"), {
  ssr: false,
  loading: StagePlaceholder,
});

export default function HardwareScreen() {
  const [selected, setSelected] = useState<RigSlotKey | null>(null);
  const slot = RIG_SLOTS.find((s) => s.key === selected) ?? null;

  /* Null until the saved choice has been read, which can only happen in the
     browser. Starting on a default and correcting it a moment later would draw
     the wrong rig first, and would not match what the server rendered. */
  const [prefs, setPrefs] = useState<RigPrefs | null>(null);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(RIG_PREFS_KEY);
    } catch {
      /* storage is switched off: the defaults stand */
    }
    setPrefs(parseRigPrefs(raw));
  }, []);

  function choose(next: RigPrefs) {
    setPrefs(next);
    try {
      localStorage.setItem(RIG_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* the choice lasts until the page is closed, which is all it can do */
    }
  }

  const layout = prefs ? rigLayout(prefs.layout) : null;
  const screens = prefs && layout ? prefs.screens[layout.key] : null;

  return (
    <div
      className="scrollpane screen-pad"
      style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}
    >
      <div className="rig-split">
        <Panel
          title="Rig layout"
          sub={`${RIG_SLOTS.length} mounting slots`}
          right={<Eyebrow>{slot ? slot.label : "click a part"}</Eyebrow>}
          foot={
            <Caveat>
              A generic rig, drawn to realistic proportions. It is not your hardware: picking a
              layout changes the drawing and records nothing about your rig, and the choice is
              remembered in this browser only. Nothing on this screen comes from telemetry. The
              road on the screens is decoration, not a replay of a session.
            </Caveat>
          }
        >
          <div className="rig-tools">
            <div className="seg" role="group" aria-label="Layout">
              {RIG_LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className="seg-opt"
                  title={l.blurb}
                  data-active={layout?.key === l.key}
                  aria-pressed={layout?.key === l.key}
                  disabled={!prefs}
                  onClick={() => prefs && choose({ ...prefs, layout: l.key })}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Screens">
              {SCREEN_CHOICES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="seg-opt"
                  data-active={screens === c.key}
                  aria-pressed={screens === c.key}
                  disabled={!prefs}
                  onClick={() =>
                    prefs && layout && choose({ ...prefs, screens: { ...prefs.screens, [layout.key]: c.key } })
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
            <span className="rig-tools-note">{layout?.blurb}</span>
          </div>

          <PosterLayout.Provider value={layout?.key ?? null}>
            {layout && screens ? (
              <RigScene layout={layout.key} screens={screens} selected={selected} onSelect={setSelected} />
            ) : (
              <StagePlaceholder />
            )}
          </PosterLayout.Provider>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
          <Panel title="Slots" sub="what is mounted where">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {RIG_SLOTS.map((s) => {
                const active = s.key === selected;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="pk"
                    aria-pressed={active}
                    onClick={() => setSelected(s.key)}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "var(--space-3)",
                      width: "100%",
                      padding: "var(--space-2)",
                      border: 0,
                      borderRadius: "var(--radius-sm)",
                      textAlign: "left",
                      font: "inherit",
                      color: "inherit",
                      background: active
                        ? "color-mix(in srgb, var(--color-accent) 13%, transparent)"
                        : "transparent",
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        width: 96,
                        font: "500 9.5px var(--font-heading)",
                        letterSpacing: ".09em",
                        textTransform: "uppercase",
                        color: active ? "var(--ch-a)" : dim(42),
                      }}
                    >
                      {s.label}
                    </span>
                    <span style={{ fontSize: 12.5, fontStyle: "italic", color: dim(34) }}>
                      nothing recorded
                    </span>
                  </button>
                );
              })}
            </div>
            <Caveat>
              Empty means nothing has been recorded for the slot. It does not mean nothing is
              mounted there, and it does not mean a reading is zero.
            </Caveat>
          </Panel>

          <Panel title={slot ? slot.label : "No slot selected"} sub={slot ? "nothing recorded" : undefined}>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: dim(58), textWrap: "pretty" }}>
              {slot
                ? "Proctor cannot record what is mounted on a rig yet, so there is no component to show for this slot."
                : "Click a part of the rig, a caption over it, or a slot in the list above."}
            </p>
            <Caveat>
              Nothing in a .ibt identifies which product produced a channel, so until a component
              is recorded here by hand, Proctor cannot tie a reading to a particular piece of
              hardware.
            </Caveat>
          </Panel>
        </div>
      </div>
    </div>
  );
}
