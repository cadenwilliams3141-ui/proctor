# §D — The Parachute: Proctor weekly reconciliation routine

A weekly **cloud** Claude Code routine (claude.ai/code/routines) that catches anything
built but never logged to Notion after a late session. Not yet created — blocked on two
access grants (see bottom). This doc is the spec so it can be created the moment access lands.

## Schedule
- Cron (UTC): `0 13 * * 1` — Mondays 13:00 UTC = **8:00 AM America/Chicago**.
- Model: `claude-sonnet-5`. Environment: Default (`env_01YGn1yDbE8PjdNxx3Bby6uu`).
- Source repo: `https://github.com/cadenwilliams3141-ui/proctor`.
- Tools: Bash, Read, Glob, Grep (+ Notion MCP connector once attached).

## Prompt (self-contained — the cloud agent starts cold)

> Weekly Proctor reconciliation (the parachute). Purpose: catch anything built but never
> logged to Notion after a late session. Terse — this is a safety net, not a report. If
> nothing is out of sync, do nothing and report "In sync, nothing to do." Do not manufacture
> busywork.
>
> Context (you start cold): Proctor is an iRacing .ibt telemetry analyzer. This checkout is
> the repo cadenwilliams3141-ui/proctor: /parser holds the Python parser +
> proctor_parser/analysis/ metric modules; /render-service the FastAPI ingest; /uploader the
> rig uploader; /web the Next.js UI; /migrations the SQL. Read CLAUDE.md at the repo root for
> the full picture. The project's tracking workspace lives in Notion under a hub page titled
> "Proctor" with child databases: Build Log, Feature Status, Decisions, Gotchas & Parking
> Lot, and a Reference / Architecture page.
>
> Do this:
> 1. Ground truth from the repo: list recent commits (git log --oneline -20), the module
>    files in parser/proctor_parser/analysis/, the tables in migrations/, and the routes
>    under web/app. The repo is ground truth; Notion is the layer that drifts.
> 2. Read what Notion claims: if the Notion MCP tools are available in this session, fetch
>    the "Proctor" hub, the latest Build Log entries, and the Feature Status board. If Notion
>    MCP is NOT connected in this cloud session, say so plainly and stop — report the
>    repo-side findings so a human can reconcile manually. Do not invent a sync you could not
>    perform.
> 3. Diff them. For each STRUCTURAL gap (a module/file/table/feature that exists in the repo
>    but Notion does not reflect): add or update the relevant Build Log entry and Feature
>    Status card via the Notion MCP. Note in the entry that it was reconciled by the weekly
>    routine, with the commit reference.
> 4. If nothing is out of sync, do nothing and report "In sync, nothing to do."
>
> Honest limit (state it in your summary): this backstops BUILD STATE — "what exists." It
> reliably catches new files/modules/tables because those are structural diffs. It may NOT
> catch a DECISION or an approach change, because reasoning often lives in a commit message
> or someone's head, not a queryable structure. So report what you synced and remind that
> decisions still depend on being logged when made — the parachute did not necessarily
> capture the "why."
>
> Tone: terse. "Synced N items (X, Y). Reasoning unverified — log any decisions manually." or
> "In sync, nothing to do."

## Blocked on (both need Caden, both one-time)
1. **Cloud access to the private `proctor` repo.** Creating the routine returned HTTP 403
   ("You don't have access to a repository this routine uses"). Grant the Claude Code cloud
   GitHub app access to `cadenwilliams3141-ui/proctor` (making the repo visible to the cloud
   agent), then the routine can be created.
2. **A Notion connector on claude.ai.** The cloud session has no MCP connectors, so it can
   read the repo but cannot write to Notion. Connect Notion at
   https://claude.ai/customize/connectors, then attach it to the routine
   (`mcp_connections`). Until then the prompt degrades gracefully: it reports repo-side
   findings and stops rather than faking a sync.
