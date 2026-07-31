import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/* The UI reads from Neon and never parses telemetry (language boundary:
   parsing is Python on Render; this side only renders).

   The client is created LAZILY, on first query, rather than at import time.
   Creating it eagerly throws during `next build` whenever DATABASE_URL is
   absent — which is the normal case when the front end is built or previewed
   away from the connectors. A route that is never called should not be able to
   fail a build. */

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Set it in the environment before querying the database.",
      );
    }
    client = neon(url);
  }
  return client;
}

export const sql = ((...args: Parameters<NeonQueryFunction<false, false>>) =>
  getClient()(...args)) as NeonQueryFunction<false, false>;
