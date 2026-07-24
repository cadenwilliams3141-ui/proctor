# Proctor

Sim-racing telemetry analysis. Reads iRacing `.ibt` files and shows drivers what
happened — observations, not verdicts. Every insight compares the driver to
themselves: their own laps, their own demonstrated envelope, their own history.

## Layout

| Directory | What | Language |
|---|---|---|
| `/parser` | The hub: `.ibt` binary parser → normalized lap objects | Python |
| `/render-service` | FastAPI app wrapping the parser; ingests uploads, writes Neon | Python |
| `/uploader` | Portable desktop watcher for the sim rig | Python |
| `/web` | Analysis UI (`vercel dev` against real Neon + Render) | TypeScript / Next.js |
| `/migrations` | SQL schema | SQL |

Language boundary (locked): Python only in the parser/service, TypeScript only
in the UI. They communicate exclusively through Neon Postgres.

## Honesty rules (non-negotiable)

- Observations, not verdicts. Describe, don't prescribe.
- Missing ≠ zero — absent channels are reported as absent, never fabricated.
- Negative results are findings ("no clipping detected").
- Limits come from the driver's own data, labeled as such, never universal truth.
