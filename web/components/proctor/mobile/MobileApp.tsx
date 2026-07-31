"use client";

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD 2 — THE PHONE APP
   The after-session read. You are on the sofa, not at the rig.

   The divergences from desktop are DECISIONS, not omissions:

   1. The ranked corner list is the HOME SCREEN, not a tab you find. On a phone
      you have seconds of attention, so the answer comes first and the evidence
      is one tap behind it.
   2. The ribbon is not here AT ALL. A shared-axis lane stack needs a pointer
      and a wide viewport; on a phone it would be five illegible strips. It was
      dropped deliberately rather than shrunk into uselessness.
   3. Corner detail is a BOTTOM SHEET, not a route. You come back to the list,
      not to a new page, so the ranking never leaves the screen behind you.
   4. Every caveat survives, at the foot of the panel that owns it, in the same
      words as desktop. None were dropped for space.
   ═══════════════════════════════════════════════════════════════════════════ */

import { dim } from "@/lib/proctor/channels";
import { IS_FIXTURE } from "@/lib/proctor/data-source";
import { useProctor } from "@/lib/proctor/store";

import CornerSheet from "@/components/proctor/mobile/CornerSheet";
import MobileLap from "@/components/proctor/mobile/MobileLap";
import MobileLive from "@/components/proctor/mobile/MobileLive";
import MobileRig from "@/components/proctor/mobile/MobileRig";
import MobileSessions from "@/components/proctor/mobile/MobileSessions";
import TabBar from "@/components/proctor/mobile/TabBar";
import LaunchScreen from "@/components/proctor/shell/LaunchScreen";

export default function MobileApp() {
  const { state, error } = useProctor();

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
        fontSize: 13,
        overflowX: "hidden",
      }}
    >
      <LaunchScreen />

      {IS_FIXTURE && (
        <div
          style={{
            flex: "none",
            padding: "calc(env(safe-area-inset-top, 0px) + 6px) var(--space-6) 0",
          }}
        >
          <span className="tag-warn">sample data — nothing here came from a .ibt</span>
        </div>
      )}

      {error ? (
        <div style={{ padding: "var(--space-6)" }}>
          <div style={{ font: "500 15px var(--font-heading)", marginBottom: 6 }}>
            This session could not be read.
          </div>
          <div style={{ fontSize: 12.5, color: dim(62), lineHeight: 1.6 }}>
            Nothing is shown in its place, because a blank screen would look like a
            session with nothing in it.
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ch-loss)", marginTop: "var(--space-3)" }}>
            {error}
          </div>
        </div>
      ) : (
        <div
          key={state.screen}
          className="scrollpane"
          style={{ flex: 1, minHeight: 0, animation: "fadeIn .25s both" }}
        >
          {state.screen === "analyse" && <MobileLap />}
          {state.screen === "sessions" && <MobileSessions />}
          {state.screen === "live" && <MobileLive />}
          {state.screen === "rig" && <MobileRig />}
          {/* Space for the tab bar, which floats over the scroll. */}
          <div style={{ height: 120 }} />
        </div>
      )}

      <CornerSheet />
      <TabBar />
    </div>
  );
}
