"use client";

import { FileUp, Monitor, ShieldCheck } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, dim } from "@/lib/proctor/channels";

export default function UploadScreen() {
  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 780 }}>
        <div
          style={{
            border: "1px dashed var(--color-neutral-700)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-2)",
            textAlign: "center",
          }}
        >
          <FileUp size={26} strokeWidth={1.4} color={CH.a} />
          <div style={{ font: "500 15px var(--font-heading)" }}>Drop a .ibt file here</div>
          <div style={{ fontSize: 12.5, color: dim(52), maxWidth: 460, lineHeight: 1.6 }}>
            iRacing writes these to your telemetry folder at the end of every
            session. Proctor reads them directly — nothing is installed inside the
            sim and no setting changes.
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: "var(--space-2)" }}>
            Choose a file
          </button>
        </div>

        <div
          style={{
            marginTop: "var(--space-4)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Panel padding="var(--space-4)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Monitor size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>The rig watcher</span>
            </div>
            <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: 0 }}>
              A small folder-watcher on the rig sends each file as it appears, so
              you rarely need this screen. It waits for the write to finish — file
              size stable for five seconds — before uploading, so a half-written
              file is never sent.
            </p>
          </Panel>

          <Panel padding="var(--space-4)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <ShieldCheck size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>What happens to it</span>
            </div>
            <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: 0 }}>
              The file is parsed into laps and channels, and the analysis modules
              run over the result. Your telemetry stays yours: it is never pooled
              into anyone else&apos;s comparison, because every comparison in this
              app is you against you.
            </p>
          </Panel>
        </div>

        <Caveat maxWidth={640}>
          A file that cannot be read will appear in the ingest queue on the Sessions
          screen with the reason it failed, rather than disappearing quietly.
        </Caveat>
      </div>
    </div>
  );
}
