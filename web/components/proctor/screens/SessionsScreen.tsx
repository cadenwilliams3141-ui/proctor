"use client";

import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim } from "@/lib/proctor/channels";
import { data } from "@/lib/proctor/data-source";
import { fmtAgo, fmtDay, fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import type { IngestRow, SessionRow } from "@/lib/proctor/types";

export default function SessionsScreen() {
  const { dispatch, bundle } = useProctor();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [ingest, setIngest] = useState<IngestRow[] | null>(null);

  useEffect(() => {
    data.listSessions().then(setSessions).catch(() => setSessions([]));
    data.listIngest().then(setIngest).catch(() => setIngest([]));
  }, []);

  // Which row the analysis surface is currently reading. The shell opens on
  // "latest", so this is only known once that session has actually loaded.
  const openId = bundle ? String(bundle.session.id) : null;

  /* What the watcher panel is allowed to say.
   *
   * It used to say "Rig watcher connected", under a green dot, above
   * "last seen 2 min ago · 41 files this month" — and every one of those was a
   * literal in this file. They described nothing, would have described the
   * wrong thing forever, and never looked wrong.
   *
   * Nothing here can see the watcher. It is a process on a machine this app
   * has no channel to; the only evidence of it is files ARRIVING. So that is
   * what gets reported: when one last did, and how many this month, both
   * counted off the ingest rows already loaded above. */
  const watcher = (() => {
    if (ingest == null) return null;
    const times = ingest
      .map((f) => Date.parse(f.uploaded_at))
      .filter((t) => Number.isFinite(t));
    if (times.length === 0) {
      return { lastAgo: null, thisMonth: 0, latest: null as string | null };
    }
    const latest = Math.max(...times);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return {
      lastAgo: fmtAgo(new Date(latest).toISOString()),
      thisMonth: times.filter((t) => t >= monthStart).length,
      latest: new Date(latest).toISOString(),
    };
  })();

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "stretch" }}>
        {/* This whole box used to be a mockup. The button had no onClick, and
            the words "Drop a .ibt file here" sat on an element with no drop
            handler — so both affordances it advertised were fiction.

            It is one control now, and it goes to the Upload screen rather than
            growing a second copy of the picker. A second copy is exactly how
            this happened: the Upload screen's identical dead button was fixed,
            and this one was not, because nothing tied them together. */}
        <button
          type="button"
          onClick={() => dispatch({ t: "screen", screen: "upload" })}
          style={{
            all: "unset",
            boxSizing: "border-box",
            flex: 1,
            cursor: "pointer",
            border: "1px dashed var(--color-neutral-700)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-2)",
            textAlign: "center",
          }}
        >
          <FileUp size={26} strokeWidth={1.4} color={CH.a} />
          <div style={{ font: "500 14px var(--font-heading)" }}>Add a session by hand</div>
          <div style={{ fontSize: 12, color: dim(50), maxWidth: 420 }}>
            You should not usually need to. The rig watcher sends each file the
            moment you leave the track.
          </div>
          <span className="btn btn-primary" style={{ marginTop: 4 }}>
            Choose a file
          </span>
        </button>

        <Panel style={{ width: 280, flex: "none" }} padding="var(--space-4)">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Amber, not green, and never a claim of "connected": a file
                arriving is evidence the watcher ran, not evidence it is
                running now. */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: watcher?.lastAgo ? CH.gain : dim(28),
                boxShadow: watcher?.lastAgo
                  ? "0 0 0 3px color-mix(in srgb, #6fbf8f 22%, transparent)"
                  : "none",
                flex: "none",
              }}
            />
            <span style={{ font: "500 12.5px var(--font-heading)" }}>The rig watcher</span>
          </div>
          <div style={{ fontSize: 11.5, color: dim(52), marginTop: "var(--space-3)", lineHeight: 1.55 }}>
            Watches the iRacing telemetry folder and sends each file once the
            write has finished — size stable for five seconds — so a half-written
            file is never sent.
          </div>
          <div style={{ fontSize: 11, color: dim(45), marginTop: "var(--space-3)", lineHeight: 1.6 }}>
            {watcher == null ? (
              "Reading the ingest history\u2026"
            ) : watcher.lastAgo == null ? (
              "No file has ever arrived, so there is nothing here that could say whether the watcher is running."
            ) : (
              <>
                Last file arrived{" "}
                <span className="num" style={{ color: dim(66) }}>
                  {watcher.lastAgo}
                </span>
                .{" "}
                <span className="num" style={{ color: dim(66) }}>
                  {watcher.thisMonth}
                </span>{" "}
                {watcher.thisMonth === 1 ? "file" : "files"} this month.
              </>
            )}
          </div>
          <Caveat>
            This describes files arriving, not the watcher itself. Nothing here
            can see whether that process is running on the rig — only what it
            has sent.
          </Caveat>
        </Panel>
      </div>

      {/* Ingest queue. A failure ALWAYS shows its reason. */}
      {ingest && ingest.length > 0 && (
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ fontSize: 13, marginBottom: "var(--space-2)" }}>Ingest queue</h2>
          <table className="table">
            <thead>
              <tr>
                <th>file</th>
                <th style={{ width: 100 }}>status</th>
                <th>detail</th>
                <th style={{ width: 90 }}>uploaded</th>
              </tr>
            </thead>
            <tbody>
              {ingest.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{f.filename}</td>
                  <td>
                    <span
                      className="tag"
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        border: `1px solid ${
                          f.status === "failed"
                            ? "color-mix(in srgb, #e0685e 55%, transparent)"
                            : f.status === "parsing"
                              ? "color-mix(in srgb, #e0b76a 55%, transparent)"
                              : dim(20)
                        }`,
                        color:
                          f.status === "failed" ? CH.loss : f.status === "parsing" ? CH.warn : dim(55),
                      }}
                    >
                      {f.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: f.error_detail ? CH.loss : dim(35) }}>
                    {f.error_detail ?? "—"}
                  </td>
                  <td className="num" style={{ fontSize: 11, color: dim(45) }}>
                    {fmtDay(f.uploaded_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={{ marginTop: "var(--space-8)" }}>
        <h2 style={{ fontSize: 13, marginBottom: "var(--space-2)" }}>Sessions</h2>
        <table className="table">
          <thead>
            <tr>
              <th>track</th>
              <th style={{ width: 130 }}>car</th>
              <th style={{ width: 80 }}>type</th>
              <th style={{ width: 70 }}>laps</th>
              <th style={{ width: 90 }}>best valid</th>
              <th style={{ width: 130 }}>pace</th>
              <th style={{ width: 80 }}>when</th>
            </tr>
          </thead>
          <tbody>
            {sessions?.map((s) => (
              <tr
                key={String(s.id)}
                data-clickable="true"
                title="Open this session"
                onClick={() => dispatch({ t: "session", id: String(s.id) })}
              >
                {/* A wrapping ROW, not a run of inline tags. Inline, a tag that
                    wrapped broke mid-phrase and its padded, bordered box rode
                    up over the track name on the line above — on a 768px
                    tablet the first column reads "Testland" with "wear masked"
                    printed through it. Wrapping whole tags onto their own line
                    costs a row of height and stays legible. */}
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
                    <span style={{ font: "500 12.5px var(--font-heading)" }}>{s.track_name}</span>
                    {openId === String(s.id) && (
                      <span className="tag" style={{ fontSize: 10, color: CH.a }}>
                        open
                      </span>
                    )}
                    {s.wear_masked && <span className="tag-warn">wear masked</span>}
                  </div>
                </td>
                <td style={{ color: dim(62) }}>{s.car_name}</td>
                <td style={{ color: dim(62) }}>{s.session_type}</td>
                <td className="num" style={{ color: dim(62) }}>
                  {s.valid_laps} of {s.lap_count}
                </td>
                <td className="num" style={{ color: CH.a }}>
                  {fmtLap(s.best_lap_s)}
                </td>
                <td>
                  <PaceSpark times={s.pace} />
                </td>
                <td className="num" style={{ color: dim(45) }}>
                  {fmtDay(s.recorded_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Caveat maxWidth={760}>
          &ldquo;Wear masked&rdquo; means iRacing froze tire wear for that session, so
          nothing about wear is claimed from it. Each pace sparkline is on its own
          scale — two different tracks are not comparable, and drawing them on a
          shared axis would imply they were.
        </Caveat>
      </section>
    </div>
  );
}

function PaceSpark({ times }: { times: number[] }) {
  if (!times || times.length < 2) return <span style={{ color: dim(30) }}>—</span>;
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const pts = times.map((t, i) => ({
    x: (i / (times.length - 1)) * 110,
    y: 19 - ((hi - t) / Math.max(hi - lo, 1e-6)) * 16,
  }));
  const best = times.indexOf(lo);

  return (
    <svg viewBox="0 0 110 22" preserveAspectRatio="none" style={{ width: 110, height: 22, display: "block" }}>
      <polyline
        points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={CH.a}
        strokeWidth={1.4}
      />
      <circle cx={pts[best].x} cy={pts[best].y} r={2.4} fill={INK.text} />
    </svg>
  );
}
