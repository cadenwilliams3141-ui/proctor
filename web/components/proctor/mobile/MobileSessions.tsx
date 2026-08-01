"use client";

import { useEffect, useState } from "react";

import Caveat from "@/components/proctor/ui/Caveat";
import { CH, INK, dim } from "@/lib/proctor/channels";
import { data } from "@/lib/proctor/data-source";
import { fmtDay, fmtLap } from "@/lib/proctor/format";
import { useProctor } from "@/lib/proctor/store";
import type { SessionRow } from "@/lib/proctor/types";

export default function MobileSessions() {
  const { dispatch, bundle } = useProctor();
  const [rows, setRows] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    data.listSessions().then(setRows).catch(() => setRows([]));
  }, []);

  // The ring marks the session the app is actually reading, not simply the
  // newest one — the app opens on the newest, but the driver can pick another.
  const openId = bundle ? String(bundle.session.id) : null;

  return (
    <div>
      <header style={{ padding: "var(--space-3) var(--space-6) var(--space-4)" }}>
        <h1 style={{ font: "500 24px var(--font-heading)", margin: 0 }}>Sessions</h1>
        <div style={{ fontSize: 12, color: dim(45), marginTop: 2 }}>
          the rig watcher sends each file as you leave the track
        </div>
      </header>

      <div style={{ padding: "0 var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {rows?.map((s, i) => (
          <button
            key={String(s.id)}
            type="button"
            className="tap"
            title="Open this session"
            onClick={() => dispatch({ t: "session", id: String(s.id) })}
            style={{
              background: "var(--color-surface)",
              borderRadius: "var(--radius-md)",
              border: 0,
              textAlign: "left",
              boxShadow:
                openId === String(s.id)
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)"
                  : "var(--shadow-sm)",
              padding: "var(--space-4)",
              animation: "fadeUp .4s both",
              animationDelay: `${(0.05 + i * 0.06).toFixed(2)}s`,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
              <span style={{ font: "500 15px var(--font-heading)" }}>{s.track_name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: dim(40) }}>{fmtDay(s.recorded_at)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: dim(45), marginTop: 2 }}>
              {s.car_name} · {s.session_type} · {s.valid_laps} laps clean
              {s.wear_masked && (
                <span className="tag-warn" style={{ marginLeft: 7 }}>
                  wear masked
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>
              <div>
                <div
                  style={{
                    font: "500 9.5px var(--font-heading)",
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: dim(40),
                  }}
                >
                  best valid
                </div>
                <div className="num" style={{ font: "500 19px var(--font-heading)", color: CH.a, marginTop: 1 }}>
                  {fmtLap(s.best_lap_s)}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              <Spark times={s.pace} />
            </div>
          </button>
        ))}
      </div>

      <div style={{ padding: "0 var(--space-6)" }}>
        <Caveat>
          Each sparkline is on its own scale — two different tracks are not
          comparable, and drawing them on a shared axis would imply they were.
        </Caveat>
      </div>
    </div>
  );
}

function Spark({ times }: { times: number[] }) {
  if (!times || times.length < 2) return null;
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const pts = times.map((t, i) => ({
    x: (i / (times.length - 1)) * 130,
    y: 31 - ((hi - t) / Math.max(hi - lo, 1e-6)) * 28,
  }));
  const best = times.indexOf(lo);

  return (
    <svg viewBox="0 0 130 34" preserveAspectRatio="none" style={{ width: 130, height: 34, display: "block" }}>
      <polyline
        points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={CH.a}
        strokeWidth={1.6}
      />
      <circle cx={pts[best].x} cy={pts[best].y} r={2.6} fill={INK.text} />
    </svg>
  );
}
