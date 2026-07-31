"use client";

/* The shell. One ground, three columns, six screens.
 *
 * What this replaces: web/app/layout.tsx plus the four routes under
 * web/app/session/[id]/. Those were separate pages you navigated between and
 * lost state in — lap selection, cursor position and scroll all reset on every
 * move. Here the lap rail and workspace are siblings under one state, so
 * switching screen or view keeps your place.
 *
 * Designed for >= 1440x900. The phone gets its own app at /m, not this one
 * squeezed: a shared-axis lane stack needs a pointer and a wide viewport. */

import { dim } from "@/lib/proctor/channels";
import { useProctor } from "@/lib/proctor/store";

import LapRail from "@/components/proctor/shell/LapRail";
import IconRail from "@/components/proctor/shell/IconRail";
import LaunchScreen from "@/components/proctor/shell/LaunchScreen";
import TopBar from "@/components/proctor/shell/TopBar";

import AnalyseScreen from "@/components/proctor/screens/AnalyseScreen";
import LiveScreen from "@/components/proctor/screens/LiveScreen";
import ReportScreen from "@/components/proctor/screens/ReportScreen";
import RigScreen from "@/components/proctor/screens/RigScreen";
import SessionsScreen from "@/components/proctor/screens/SessionsScreen";
import UploadScreen from "@/components/proctor/screens/UploadScreen";

export default function AppShell() {
  const { state, error } = useProctor();

  // The lap rail is only meaningful where a lap is being chosen.
  const showLapRail = state.screen === "analyse" || state.screen === "live";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        overflow: "hidden",
        fontSize: 13,
        background: "var(--color-bg)",
      }}
    >
      <LaunchScreen />
      <IconRail />
      {showLapRail && <LapRail />}

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar />

        {error ? (
          /* A failure is a finding. It says what went wrong, in the words the
             system actually produced — never an empty panel. */
          <div style={{ padding: "var(--space-8) var(--space-6)", maxWidth: 620 }}>
            <div style={{ font: "500 15px var(--font-heading)", marginBottom: 6 }}>
              This session could not be read.
            </div>
            <div style={{ fontSize: 13, color: dim(62), lineHeight: 1.6 }}>
              Nothing is being shown in its place, because a blank screen would
              look like a session with nothing in it.
            </div>
            <pre
              className="mono"
              style={{
                marginTop: "var(--space-4)",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                boxShadow: "var(--shadow-sm)",
                fontSize: 11.5,
                color: "var(--ch-loss)",
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </pre>
          </div>
        ) : (
          /* Keyed so a view change replays its own entrance once, rather than
             the shell's. */
          <div
            key={state.screen}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              animation: "fadeIn .25s both",
            }}
          >
            {state.screen === "analyse" && <AnalyseScreen />}
            {state.screen === "live" && <LiveScreen />}
            {state.screen === "sessions" && <SessionsScreen />}
            {state.screen === "report" && <ReportScreen />}
            {state.screen === "rig" && <RigScreen />}
            {state.screen === "upload" && <UploadScreen />}
          </div>
        )}
      </main>
    </div>
  );
}
