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

import { CH, dim } from "@/lib/proctor/channels";
import { useProctor } from "@/lib/proctor/store";

import LapRail from "@/components/proctor/shell/LapRail";
import IconRail from "@/components/proctor/shell/IconRail";
import LaunchScreen from "@/components/proctor/shell/LaunchScreen";
import TopBar from "@/components/proctor/shell/TopBar";

import AnalyzeScreen from "@/components/proctor/screens/AnalyzeScreen";
import LiveScreen from "@/components/proctor/screens/LiveScreen";
import ReportScreen from "@/components/proctor/screens/ReportScreen";
import ForcesScreen from "@/components/proctor/screens/ForcesScreen";
import SessionsScreen from "@/components/proctor/screens/SessionsScreen";
import UploadScreen from "@/components/proctor/screens/UploadScreen";

/* Screens that do not read a session bundle.
 *
 * Everything else is a view OF a session, so a failed load has to replace it.
 * These two are not: Sessions lists what exists, and Upload is how a session
 * comes to exist in the first place. Blanking them on a load failure locked the
 * driver out of the only screen that could fix the failure — and with an empty
 * database it locked them out permanently, because "latest" has nothing to
 * resolve to until something has been uploaded. */
const SCREENS_WITHOUT_A_SESSION = new Set(["upload", "sessions"]);

export default function AppShell() {
  const { state, error } = useProctor();

  // The lap rail is only meaningful where a lap is being chosen.
  const showLapRail = state.screen === "analyze" || state.screen === "live";
  const needsSession = !SCREENS_WITHOUT_A_SESSION.has(state.screen);

  return (
    <div
      className="app-shell"
      style={{
        /* dvh, not vh: on a mobile browser 100vh is the viewport WITHOUT the
           address bar, so the last centimetre of every screen sat under it.
           The phone app already used dvh; this one never did. */
        height: "100dvh",
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

        {error && needsSession ? (
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
            {/* The load still failed even though this screen can render without
                it. Said quietly at the top rather than dropped — a driver on the
                Upload screen after a failed load should know the app is not
                reading their sessions, and this is the screen they came to in
                order to do something about it. */}
            {error && (
              <div
                style={{
                  flex: "none",
                  margin: "var(--space-3) var(--space-6) 0",
                  padding: "8px 11px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(224,104,94,.08)",
                  boxShadow: "inset 0 0 0 1px rgba(224,104,94,.22)",
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: dim(70),
                }}
              >
                <strong style={{ fontWeight: 500, color: CH.loss }}>
                  The current session could not be read.
                </strong>{" "}
                This screen does not need one, so it is still here.{" "}
                <span className="mono" style={{ fontSize: 10.5, color: dim(50) }}>
                  {error}
                </span>
              </div>
            )}

            {state.screen === "analyze" && <AnalyzeScreen />}
            {state.screen === "live" && <LiveScreen />}
            {state.screen === "sessions" && <SessionsScreen />}
            {state.screen === "report" && <ReportScreen />}
            {state.screen === "rig" && <ForcesScreen />}
            {state.screen === "upload" && <UploadScreen />}
          </div>
        )}
      </main>
    </div>
  );
}
