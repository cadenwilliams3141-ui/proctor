import Link from "next/link";
import { sql } from "@/lib/db";
import type { LapRow, MetricPayloads } from "@/lib/types";
import ReportCard from "@/components/ReportCard";
import { readTier } from "@/lib/tier-server";

export const dynamic = "force-dynamic";

function fmtLap(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tier = await readTier();
  const [session] = await sql`
    SELECT s.*, f.filename FROM sessions s
    LEFT JOIN ingest_files f ON f.id = s.ingest_file_id
    WHERE s.id = ${id}
  `;
  if (!session) {
    return <p>Session not found.</p>;
  }
  const laps = (await sql`
    SELECT lap_number, lap_time_s, is_valid, is_out_lap, incident_delta, is_anomalous
    FROM laps WHERE session_id = ${id} ORDER BY id
  `) as unknown as LapRow[];
  const metricRows = (await sql`
    SELECT metric_key, payload FROM session_metrics WHERE session_id = ${id}
  `) as unknown as { metric_key: string; payload: Record<string, unknown> }[];
  const metrics: MetricPayloads = Object.fromEntries(
    metricRows.map((m) => [m.metric_key, m.payload]),
  );

  const best = laps.filter((l) => l.is_valid && l.lap_time_s != null)
    .reduce<number | null>((acc, l) => (acc == null || l.lap_time_s! < acc ? l.lap_time_s! : acc), null);

  return (
    <>
      <h1>
        {session.track_name ?? "unknown track"} — {session.car_name ?? "unknown car"}
        {session.wear_masked && <span className="badge warn">tire wear frozen by iRacing</span>}
      </h1>
      <p style={{ color: "var(--muted)" }}>
        {session.session_type ?? "session"} ·{" "}
        {session.recorded_at ? new Date(session.recorded_at).toLocaleString() : "time unknown"} ·{" "}
        <span className="mono">{session.filename}</span>
      </p>

      <div className="panel">
        <span className="stat"><span className="v">{laps.length}</span><br /><span className="l">laps</span></span>
        <span className="stat"><span className="v">{laps.filter((l) => l.is_valid).length}</span><br /><span className="l">valid</span></span>
        <span className="stat"><span className="v mono">{fmtLap(best)}</span><br /><span className="l">best valid</span></span>
        <span className="stat">
          <Link href={`/session/${id}/laps`}>lap analysis →</Link><br />
          <Link href={`/session/${id}/hardware`}>hardware panel →</Link>
        </span>
      </div>

      <ReportCard metrics={metrics} tier={tier} />

      <h2>Laps</h2>
      <div className="panel">
        <table>
          <thead>
            <tr><th>#</th><th>time</th><th>flags</th><th>incidents</th></tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lap_number} className={l.is_valid ? "" : "invalid"}>
                <td>{l.lap_number}</td>
                <td className="mono">{fmtLap(l.lap_time_s)}</td>
                <td>
                  {l.is_out_lap && <span className="badge">out/in</span>}
                  {!l.is_valid && !l.is_out_lap && <span className="badge">partial/short</span>}
                  {l.is_anomalous && <span className="badge warn">anomalous</span>}
                  {l.is_valid && !l.is_anomalous && <span className="badge good">clean</span>}
                </td>
                <td>{l.incident_delta > 0 ? `+${l.incident_delta}x` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="caveat">
          Out/in laps, partial laps, and laps with incidents or off-median speed
          profiles are excluded from comparisons — flagged, not judged.
        </p>
      </div>
    </>
  );
}
