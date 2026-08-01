import { NextResponse } from "next/server";

import { sql } from "@/lib/db";
import { guarded } from "@/lib/proctor/server/respond";
import type { IngestRow } from "@/lib/proctor/types";

/* The ingest queue: everything not yet a readable session, plus the most recent
 * few that are — so the panel shows the watcher working, not only when it
 * breaks.
 *
 * A FAILED ROW ALWAYS CARRIES A REASON. A failure with no detail is worse than
 * no row at all: the driver cannot tell whether to retry the file, re-record
 * it, or leave it alone. Where the ingest service recorded nothing, the row
 * says exactly that rather than showing an empty cell that reads as "no
 * problem". */

export const dynamic = "force-dynamic";

const RECENT_DONE = 5;

/** Schema statuses are pending|parsing|done|failed; the UI's vocabulary calls
 *  the first one "queued". Anything unrecognised is surfaced as-is rather than
 *  being coerced into a status the file is not in. */
function status(raw: string): IngestRow["status"] {
  if (raw === "pending") return "queued";
  return raw as IngestRow["status"];
}

export async function GET() {
  return guarded(async () => {
    const rows = await sql`
      (
        SELECT id, filename, status, error_detail, uploaded_at
        FROM ingest_files WHERE status <> 'done'
        ORDER BY uploaded_at DESC
        LIMIT 25
      )
      UNION ALL
      (
        SELECT id, filename, status, error_detail, uploaded_at
        FROM ingest_files WHERE status = 'done'
        ORDER BY uploaded_at DESC
        LIMIT ${RECENT_DONE}
      )
    `;

    const files: IngestRow[] = (rows as unknown as IngestRow[])
      .map((f) => ({
        id: Number(f.id),
        filename: f.filename,
        status: status(String(f.status)),
        error_detail:
          String(f.status) === "failed" && !f.error_detail
            ? "This file failed, but the ingest service recorded no reason for it. The file is on the server; the parser's error was lost."
            : f.error_detail,
        uploaded_at: f.uploaded_at,
      }))
      // Newest first across both halves of the union. Sorted on the parsed
      // timestamp: the driver treats "pending" as "the file I just drove", and
      // a done row from last week must not land above it.
      .sort((a, b) => +new Date(b.uploaded_at) - +new Date(a.uploaded_at));

    return NextResponse.json(files);
  });
}
