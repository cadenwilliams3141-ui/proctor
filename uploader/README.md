# Proctor uploader (sim rig)

Copy this folder anywhere on the rig and double-click `run.bat`.

- Finds the iRacing telemetry folder automatically (including Documents
  relocated into OneDrive). Asks once and remembers in `config.json` only if
  auto-discovery fails.
- Waits for iRacing to finish writing each `.ibt` before uploading.
- Keeps a local ledger (`.processed.json`) so restarts don't re-upload;
  the server dedupes by SHA-256 as a backstop.
- Logs to the console and `uploader.log`.
