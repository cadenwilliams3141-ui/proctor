# Proctor — Build Context for Claude Code

Read this before doing anything. Proctor is an iRacing .ibt telemetry analysis app.
Core thesis: every insight compares the driver TO THEMSELVES — no per-car physics models.
Product identity: observations, not verdicts. This constraint lives in the code AND the UI copy.

## Start-of-session ritual (do this first, every session)
1. Read the latest Proctor **Build Log** entry in Notion (via Notion MCP — the workspace hub is
   the "Proctor" page; Build Log is a child database). State "here's where we left off, here's
   what's next" before starting work. If you can't reach Notion, say so and proceed.
2. Confirm the four MCP connections respond with a quick read: Neon, Vercel, GitHub, Render.
   If any fails, tell the user which one — don't build on an unverified connection.
   (Known state: the GitHub MCP server is often unauthenticated here; the `gh` CLI is the
   sanctioned fallback and is logged in as cadenwilliams3141-ui.)

## End-of-session ritual (do this at natural stopping points)
- Append a Build Log entry via Notion MCP: what got built, what broke, what's next, commit/PR.
- If a real decision or approach change was made, add it to the **Decisions** database with
  rationale. (The weekly parachute routine backstops build-STATE sync, but it may NOT catch
  reasoning — logging a decision is your job, not the parachute's.)

## Architecture (locked)
- Python only in /render-service and /parser. TypeScript only in /web. They talk through Neon.
- Uploader (/uploader) ships to Caden's desktop rig — portable folder, not an .exe.
- IDs (identifiers only): repo cadenwilliams3141-ui/proctor · Neon project shiny-shadow-96766321
  (db neondb) · Render service srv-d9hb6pnaqgkc73a12mh0 → https://proctor-ingest.onrender.com ·
  Vercel project prj_i1eT9J2fu4qZHJkjUPWn1zeryR5E (team garrr) → proctor-eight.vercel.app.
- Secrets are in Render/Vercel env vars — retrieve via MCP if ever needed; NEVER hardcode or
  paste a connection string anywhere (not in code, not in Notion, not in chat).

## Non-negotiable engineering rules
- Channels: look up BY NAME, never fixed offset (offsets differ between cars).
- Stationary guard: exclude Speed <= 5 m/s from ALL Brake-vs-BrakeRaw logic
  (`proctor_parser.laps.moving_mask` — the sim forces Brake=1.0 when stopped).
- Honor SessionNum (files may hold multiple sessions) and wear_masked.
- Lap numbers repeat after resets/tows — the parser remaps reused numbers to max+1; keep it so.
- Gearboxes pass through neutral mid-shift (3→0→4) — never detect shifts by consecutive-tick ±1.
- Uploader waits for the file write to finish before uploading (size stable 5s).
- Analysis modules follow parser/ANALYSIS_CONTRACT.md: pure ParsedSession → JSON dict,
  registered explicitly in analysis/__init__.py, honesty fields in every payload.
- MCP first, CLI fallback.

## Regression tripwire (the golden fixtures — exact filenames, in OneDrive iRacing\Telemetry)
- Long Beach `porsche718gt4_longbeach 2026-01-26 13-42-30.ibt`
  (285 vars / bufLen 1099 / 124,215 samples / wear_masked=true)
- Mugello `porsche992rgt3_mugello gp 2026-07-09 21-57-07.ibt` (287 / 1104 / 48,955 / false)
- Road Atlanta `porsche992rgt3_roadatlanta full 2026-07-16 21-19-03.ibt` (287 / 1104 / 52,458)
- Known-good Long Beach module outputs: brake ceiling **89.8%** (driver's own moving max);
  **left-foot braking detected** (median **−50 ms** signed release→brake, 77% brake-before-lift);
  **69** pedal noise spikes; pace improved 0.213s first-5→last-5 clean laps while ~31 L burned.
- If you change the parser or a module, RE-RUN `cd parser && python -m pytest tests -q`
  (51 tests). If these numbers move, you broke something.

## Capabilities boundary (do NOT build or promise — the data isn't there)
- Racecraft/positioning tips (no CarIdx in disk files; intent unknowable).
- Brake-temp heat map (no brake-temp channel; only line pressure).
- Tire-wear-over-race in official sessions (masked/frozen).
- "Why did you lift" — intent is not a channel. Permanent wall.
- FOV calculator is a static tool, not telemetry analysis — frame it honestly.

## Before re-opening a settled question
Check the Decisions database in Notion first. If it's there and Active, don't re-litigate —
state the prior decision and its rationale. Only revisit if the user explicitly wants to.

## Honesty rules (code + copy)
Observations not verdicts. Describe don't prescribe. Missing ≠ zero. Report negative results.
Limits/ideals come from the driver's own data, labelled as such.
