import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [session] = await sql`SELECT * FROM sessions WHERE id = ${id}`;
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const laps = await sql`
    SELECT lap_number, lap_time_s, is_valid, is_out_lap, incident_delta, is_anomalous
    FROM laps WHERE session_id = ${id} ORDER BY id
  `;
  const metricRows = await sql`
    SELECT metric_key, payload FROM session_metrics WHERE session_id = ${id}
  `;
  const metrics = Object.fromEntries(
    (metricRows as { metric_key: string; payload: unknown }[]).map((m) => [m.metric_key, m.payload]),
  );
  return NextResponse.json({ session, laps, metrics });
}
