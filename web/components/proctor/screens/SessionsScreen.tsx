"use client";

import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, INK, dim } from "@/lib/proctor/channels";
import { data } from "@/lib/proctor/data-source";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
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

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "stretch" }}>
        <div
          style={{
            flex: 1,
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
          <div style={{ font: "500 14px var(--font-heading)" }}>Drop a .ibt file here</div>
          <div style={{ fontSize: 12, color: dim(50), maxWidth: 420 }}>
            You should not usually need to. The rig watcher sends each file the
            moment you leave the track.
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 4 }}>
            Choose a file
          </button>
        </div>

        <Panel style={{ width: 280, flex: "none" }} padding="var(--space-4)">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: CH.gain,
                boxShadow: "0 0 0 3px color-mix(in srgb, #6fbf8f 22%, transparent)",
                flex: "none",
              }}
            />
            <span style={{ font: "500 12.5px var(--font-heading)" }}>Rig watcher connected</span>
          </div>
          <div style={{ fontSize: 11.5, color: dim(52), marginTop: "var(--space-3)", lineHeight: 1.55 }}>
            Watching the iRacing telemetry folder. Files upload once the write has
            finished — size stable for five seconds — so a half-written file is
            never sent.
          </div>
          <div className="num" style={{ fontSize: 11, color: dim(38), marginTop: "var(--space-3)" }}>
            last seen 2 min ago · 41 files this month
          </div>
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
                <td>
                  <span style={{ font: "500 12.5px var(--font-heading)" }}>{s.track_name}</span>
                  {openId === String(s.id) && (
                    <span className="tag" style={{ marginLeft: 7, fontSize: 10, color: CH.a }}>
                      open
                    </span>
                  )}
                  {s.wear_masked && (
                    <span className="tag-warn" style={{ marginLeft: 7 }}>
                      wear masked
                    </span>
                  )}
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
