import { neon } from "@neondatabase/serverless";

// The UI reads from Neon and never parses telemetry (language boundary:
// parsing is Python on Render; this side only renders).
export const sql = neon(process.env.DATABASE_URL!);
