import { NextResponse } from "next/server";

import { guarded } from "@/lib/proctor/server/respond";
import { sessionSummaries } from "@/lib/proctor/server/queries";
import type { SessionRow } from "@/lib/proctor/types";

/* The sessions list, newest first.
 *
 * `pace` is the clean-lap times in lap order — the sparkline in each row. Every
 * sparkline is drawn on ITS OWN scale, because two sessions at different tracks
 * are not comparable and a shared axis would imply they were. */

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async () => {
    const rows = await sessionSummaries(null);

    const sessions: SessionRow[] = rows.map((r) => ({
      ...r,
      // A session with no clean laps gets an empty array, and the sparkline
      // renders as "—". It never gets a line drawn through invalid laps.
      pace: (r.pace ?? []).map(Number).filter(Number.isFinite),
    }));

    return NextResponse.json(sessions);
  });
}
