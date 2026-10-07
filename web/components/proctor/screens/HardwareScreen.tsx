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
import { useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { dim } from "@/lib/proctor/channels";
import { RIG_POSTER_URL, RIG_SLOTS, type RigSlotKey } from "@/lib/proctor/rig";

const RigScene = dynamic(() => import("@/components/proctor/views/RigScene"), {
  ssr: false,
  /* The same box the scene will occupy, already showing the model, so the
     panel does not jump when the 3D view arrives. */
  loading: () => (
    <div className="rig-stage" data-state="loading">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rig-poster" alt="" src={RIG_POSTER_URL} />
      <span className="rig-note">loading the 3D view</span>
    </div>
  ),
});

export default function HardwareScreen() {
  const [selected, setSelected] = useState<RigSlotKey | null>(null);
  const slot = RIG_SLOTS.find((s) => s.key === selected) ?? null;

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
              A generic rig, drawn to realistic proportions. It is not your hardware: nothing about
              your rig has been recorded, and nothing on this screen comes from telemetry. The road
              on the three screens is decoration, not a replay of a session.
            </Caveat>
          }
        >
          <RigScene selected={selected} onSelect={setSelected} />
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
