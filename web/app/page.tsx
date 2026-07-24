import Link from "next/link";
import { sql } from "@/lib/db";
import type { IngestRow, SessionSummary } from "@/lib/types";
import UploadBox from "@/components/UploadBox";

export const dynamic = "force-dynamic";

function fmtLap(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export default async function Home() {
  const sessions = (await sql`
    SELECT s.id, s.track_name, s.car_name, s.session_type, s.session_num,
           s.track_length_km, s.wear_masked, s.recorded_at, f.filename,
           count(l.id)::int AS lap_count,
           count(l.id) FILTER (WHERE l.is_valid)::int AS valid_laps,
           min(l.lap_time_s) FILTER (WHERE l.is_valid) AS best_lap_s
    FROM sessions s
    LEFT JOIN ingest_files f ON f.id = s.ingest_file_id
    LEFT JOIN laps l ON l.session_id = s.id
    GROUP BY s.id, f.filename
    ORDER BY s.recorded_at DESC NULLS LAST, s.id DESC
  `) as unknown as SessionSummary[];

  const problems = (await sql`
    SELECT id, filename, status, error_detail, uploaded_at
    FROM ingest_files WHERE status != 'done'
    ORDER BY uploaded_at DESC LIMIT 10
  `) as unknown as IngestRow[];

  return (
    <>
      <h1>Sessions</h1>
      <UploadBox />

      {problems.length > 0 && (
        <div className="panel">
          <h3>Ingest queue</h3>
          <table>
            <thead><tr><th>file</th><th>status</th><th>detail</th></tr></thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.filename}</td>
                  <td>
                    <span className={`badge ${p.status === "failed" ? "bad" : "warn"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="mono">{p.error_detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        {sessions.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No sessions yet — drop an .ibt above, or start the rig uploader.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>when</th><th>track</th><th>car</th><th>type</th>
                <th>laps</th><th>best (valid)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.recorded_at ? new Date(s.recorded_at).toLocaleString() : "—"}</td>
                  <td>
                    <Link href={`/session/${s.id}`}>{s.track_name ?? "unknown"}</Link>
                    {s.wear_masked && <span className="badge warn" title="tire wear frozen by iRacing in this session">wear masked</span>}
                  </td>
                  <td>{s.car_name ?? "—"}</td>
                  <td>{s.session_type ?? "—"}</td>
                  <td>{s.valid_laps}/{s.lap_count}</td>
                  <td className="mono">{fmtLap(s.best_lap_s)}</td>
                  <td><Link href={`/session/${s.id}/laps`}>analyze →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
