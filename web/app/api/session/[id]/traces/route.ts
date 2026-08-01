import { NextResponse } from "next/server";

import { guarded } from "@/lib/proctor/server/respond";
import { traces } from "@/lib/proctor/server/queries";

/* Traces by lap number, for callers that load them lazily rather than taking
 * the whole bundle. Capped at four laps: an A/B comparison plus a lookahead is
 * what the surface asks for, and an uncapped list is an easy way to ask Neon
 * for every array in the session by accident. */

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: `not a session id: ${id}` }, { status: 400 });
  }

  const lapsParam = new URL(req.url).searchParams.get("laps") ?? "";
  const lapNumbers = lapsParam
    .split(",")
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v));
  if (lapNumbers.length === 0 || lapNumbers.length > 4) {
    return NextResponse.json({ error: "pass 1-4 lap numbers: ?laps=3,7" }, { status: 400 });
  }

  return guarded(async () =>
    NextResponse.json({ traces: await traces(id, lapNumbers) }),
  );
}
