import { NextResponse } from "next/server";

/* Where to send a telemetry file.
 *
 * ┌ WHY THE BROWSER NO LONGER POSTS THE FILE THROUGH THIS APP ──────────────┐
 * │ It used to. POST /api/upload took the file and forwarded it to Render,  │
 * │ so the ingest URL stayed server-side and the upload travelled           │
 * │ same-origin. Both are nice properties and neither survives contact with │
 * │ the actual files: a Vercel serverless function may receive at most      │
 * │ 4.5 MB of request body, and that is a platform limit, not a setting.    │
 * │ A session .ibt is 54-136 MB. Every real telemetry file was therefore    │
 * │ rejected by the platform BEFORE the route ran — so the route could not  │
 * │ even produce its own careful error message, and the browser got a       │
 * │ non-JSON body that blew up in res.json() as a parse error. "Choose a    │
 * │ file" appeared to be broken, and the message pointed nowhere near the   │
 * │ cause.                                                                  │
 * │                                                                         │
 * │ The old route knew: "a session .ibt runs to tens of megabytes; the      │
 * │ default body budget is smaller than that". The line under that comment  │
 * │ set maxDuration, which is a TIMEOUT. The size was never addressed.      │
 * │                                                                         │
 * │ So the bytes now go straight from the browser to Render, which has no   │
 * │ such ceiling and already allows every origin. This route hands over the │
 * │ address and nothing else.                                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * It stays a route rather than becoming NEXT_PUBLIC_: an env var is read at
 * build time and baked into the bundle, so pointing the app at a different
 * ingest service would need a rebuild. This is read per request, which keeps
 * PROCTOR_INGEST_URL working exactly as it did for the proxy.
 *
 * The URL is not a secret — it is a public endpoint with CORS open to "*", and
 * it is written down in the repo's own build notes. Nothing is being exposed
 * here that was hidden before.
 */

export const dynamic = "force-dynamic";

const DEFAULT_INGEST_URL = "https://proctor-ingest.onrender.com/ingest";

export function GET() {
  return NextResponse.json({
    url: process.env.PROCTOR_INGEST_URL ?? DEFAULT_INGEST_URL,
  });
}
