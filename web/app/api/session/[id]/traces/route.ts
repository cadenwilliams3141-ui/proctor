import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const lapsParam = new URL(req.url).searchParams.get("laps") ?? "";
  const lapNumbers = lapsParam
    .split(",")
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v));
  if (lapNumbers.length === 0 || lapNumbers.length > 4) {
    return NextResponse.json({ error: "pass 1-4 lap numbers: ?laps=3,7" }, { status: 400 });
  }
  const rows = await sql`
    SELECT l.lap_number, t.grid_pct, t.speed, t.throttle, t.brake, t.brake_raw,
           t.steer, t.gear, t.rpm, t.lat_accel, t.long_accel, t.lat_gps,
           t.lon_gps, t.abs_active
    FROM lap_traces t
    JOIN laps l ON l.id = t.lap_id
    WHERE l.session_id = ${id} AND l.lap_number = ANY(${lapNumbers})
  `;
  return NextResponse.json({ traces: rows });
}
