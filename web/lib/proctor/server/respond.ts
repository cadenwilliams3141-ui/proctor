import { NextResponse } from "next/server";

/* A failed read has to reach the screen as a sentence.
 *
 * Without this, an unhandled throw in a route becomes a bare 500 and the shell
 * prints "500 Internal Server Error" under "This session could not be read" —
 * which tells the driver nothing about whether to retry, re-ingest, or go and
 * look at the database. Negative results are findings; so are failures, and a
 * finding has to say what it found.
 */

/** Connection strings live in Render and Vercel env vars and are never written
 *  down anywhere else — including in an error message on its way to a browser.
 *  Postgres errors do not normally carry one, but this costs nothing and closes
 *  the question. */
function scrub(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]");
}

export function failed(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: scrub(message) }, { status: 500 });
}

/** Wraps a route handler so anything it throws comes back as a readable
 *  `{ error }` body instead of an opaque 500. */
export async function guarded(
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    return failed(error);
  }
}
