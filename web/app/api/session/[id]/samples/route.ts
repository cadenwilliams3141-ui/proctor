import { NextResponse } from "next/server";

import { guarded } from "@/lib/proctor/server/respond";
import { samples } from "@/lib/proctor/server/queries";
import { buildContainer } from "@/lib/proctor/samples";

/* Full-rate laps, binary, at most four per request.
 *
 * A lap is ~30-90 KB compressed, so four laps sit far below Vercel's response
 * limit — and the cap below is a hard stop rather than a hope: a response over
 * it is refused with a reason, never truncated. Telemetry only ever flows OUT
 * through here; nothing large is ever POSTed through Vercel. */

export const dynamic = "force-dynamic";

const MAX_LAPS = 4;
const MAX_BYTES = 3 * 1024 * 1024;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: `not a session id: ${id}` }, { status: 400 });
  }
  const lapNumbers = (new URL(req.url).searchParams.get("laps") ?? "")
    .split(",")
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isInteger(v));
  if (lapNumbers.length === 0 || lapNumbers.length > MAX_LAPS) {
    return NextResponse.json({ error: `pass 1-${MAX_LAPS} lap numbers: ?laps=3,7` }, { status: 400 });
  }

  return guarded(async () => {
    const rows = await samples(id, lapNumbers);
    const body = buildContainer(
      rows.map((r) => ({
        lap: Number(r.lap_number),
        header: r.header,
        data: new Uint8Array(Buffer.from(r.data_b64, "base64")),
      })),
    );
    if (body.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `those laps are ${(body.length / 1048576).toFixed(1)} MB together; ask for fewer at once` },
        { status: 413 },
      );
    }
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=300" },
    });
  });
}
