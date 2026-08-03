# Proctor uploader (sim rig)

Copy this folder anywhere on the rig and double-click `run.bat`.

- Finds the iRacing telemetry folder automatically (including Documents
  relocated into OneDrive). Asks once and remembers in `config.json` only if
  auto-discovery fails.
- Waits for iRacing to finish writing each `.ibt` before uploading.
- Keeps a local ledger (`.processed.json`) so restarts don't re-upload;
  the server dedupes by SHA-256 as a backstop.
- Logs to the console and `uploader.log`.

## Re-ingesting after the analysis changes

`reingest.bat` (or `python reingest.py`) re-sends every `.ibt` in the folder
with `force=true`, waits for each parse to finish, and prints what happened.

Run it whenever the analysis modules change. A session parsed before a module
existed carries no results for that module, and the screens report it missing
until the file goes through again.

    reingest.bat                     every .ibt in the folder
    python reingest.py --dry-run     list what would be sent, send nothing
    python reingest.py --newest 5    only the five most recent files
    python reingest.py --match mugello

It has to run here, on the rig, and that is not an oversight: the ingest
service never stores the `.ibt` bytes. `ingest_files` keeps a filename, a
SHA-256 and a status; the bytes arrive in the POST body and are gone when the
request ends. There is no reprocess-by-id endpoint because there would be
nothing for it to read. `force=true` only means "do not skip this upload just
because you have seen these bytes before" — the file still has to be attached.

Each file replaces that session's rows inside one transaction, so a failure
leaves the existing data alone rather than half-replacing it. Files written in
the last two minutes are skipped in case iRacing is still writing them
(`--include-fresh` overrides).

## Filling in the track surface

The Racing line view draws the road itself, not just your line through it. That
comes from `PlayerTrackSurface` — the sim reports, at every tick, whether the
car is on the racing surface, so the furthest out that flag stayed true is a
measurement of where the track reached.

It builds up on its own: every session you upload at a circuit widens its stored
boundary, and nothing ever narrows it. No calibration is required.

If you want a track filled in properly in one go, drive **two slow laps: one
along the left edge, one along the right**. Speed does not matter, staying near
the edge does. Upload them like any other session. That is the same trick the Z1
Analyzer asks for, and it takes the measured width from "wherever I happened to
drive" to within a metre of the real road.

Two things it will never be: it is a floor rather than an edge (the flag follows
the car's reference point, so real asphalt continues a little past it), and road
nobody has driven is drawn as a gap rather than guessed at.
