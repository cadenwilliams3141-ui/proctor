"""Proctor telemetry uploader.

v1 of the eventual live watcher. Same folder-watching skeleton; a later
version adds live iRacing SDK polling to capture CarIdx gap arrays the disk
.ibt does not contain.

Watches the iRacing telemetry folder and POSTs each finished .ibt to the
Proctor ingest service. Designed for the sim rig: double-click run.bat once.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

import requests
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

DEFAULT_INGEST_URL = "https://proctor-ingest.onrender.com/ingest"
DEFAULT_USER_ID = "caden"

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
LEDGER_PATH = HERE / ".processed.json"
LOG_PATH = HERE / "uploader.log"

# iRacing writes .ibt files progressively during the session; uploading a
# half-written file is the single most likely early bug. A file counts as
# finished only after its size has been stable this long.
STABLE_SECONDS = 5
STABLE_POLL_INTERVAL = 1.0
STABLE_TIMEOUT = 30 * 60

RETRY_BACKOFF_S = [5, 15, 60, 300, 600]

log = logging.getLogger("proctor.uploader")


def setup_logging() -> None:
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    for handler in (logging.StreamHandler(sys.stdout),
                    logging.FileHandler(LOG_PATH, encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def documents_from_registry() -> Path | None:
    """Windows 'Personal' shell folder — handles Documents relocated into
    OneDrive, which plain USERPROFILE\\Documents misses."""
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        ) as key:
            value, _ = winreg.QueryValueEx(key, "Personal")
        return Path(os.path.expandvars(value))
    except OSError:
        return None


def discover_telemetry_dir() -> Path | None:
    candidates = []
    reg_docs = documents_from_registry()
    if reg_docs is not None:
        candidates.append(reg_docs / "iRacing" / "telemetry")
    profile = os.environ.get("USERPROFILE")
    if profile:
        candidates.append(Path(profile) / "Documents" / "iRacing" / "telemetry")
        candidates.append(Path(profile) / "OneDrive" / "Documents" / "iRacing" / "telemetry")
    for c in candidates:
        if c.is_dir():  # case-insensitive on Windows, matches 'Telemetry' too
            return c
    return None


def load_json(path: Path, default: dict) -> dict:
    # utf-8-sig: Windows editors (and PowerShell) often write a BOM; plain
    # utf-8 would reject the file and silently discard the user's config.
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        print(f"WARNING: {path.name} exists but is not valid JSON ({exc}); ignoring it")
        return default
    except OSError:
        return default


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_config() -> dict:
    config = load_json(CONFIG_PATH, {})
    changed = False
    if not config.get("telemetry_dir") or not Path(config["telemetry_dir"]).is_dir():
        found = discover_telemetry_dir()
        if found is None:
            # Auto-discovery failed: ask exactly once, then never again.
            print("Could not find the iRacing telemetry folder automatically.")
            entered = input("Path to your iRacing telemetry folder: ").strip('" ')
            found = Path(entered)
            if not found.is_dir():
                print(f"'{found}' is not a folder — fix config.json and rerun.")
                sys.exit(1)
        config["telemetry_dir"] = str(found)
        changed = True
    config.setdefault("ingest_url", DEFAULT_INGEST_URL)
    config.setdefault("user_id", DEFAULT_USER_ID)
    if changed or not CONFIG_PATH.exists():
        save_json(CONFIG_PATH, config)
    return config


def wait_for_write_finish(path: Path) -> bool:
    """Poll file size until stable for STABLE_SECONDS. False on timeout/vanish."""
    deadline = time.monotonic() + STABLE_TIMEOUT
    last_size = -1
    stable_since = None
    while time.monotonic() < deadline:
        try:
            size = path.stat().st_size
        except OSError:
            return False
        if size == last_size and size > 0:
            if stable_since is None:
                stable_since = time.monotonic()
            elif time.monotonic() - stable_since >= STABLE_SECONDS:
                return True
        else:
            stable_since = None
            last_size = size
        time.sleep(STABLE_POLL_INTERVAL)
    return False


class Ledger:
    """Local record of uploaded files so a restart doesn't re-upload
    everything. Server-side SHA-256 dedupe is the backstop, not the plan."""

    def __init__(self, path: Path):
        self.path = path
        self.entries: dict = load_json(path, {})

    def key(self, path: Path) -> str:
        return path.name

    def is_done(self, path: Path) -> bool:
        entry = self.entries.get(self.key(path))
        if not entry:
            return False
        try:
            return entry.get("size") == path.stat().st_size
        except OSError:
            return False

    def mark(self, path: Path, ingest_file_id) -> None:
        try:
            size = path.stat().st_size
        except OSError:
            size = None
        self.entries[self.key(path)] = {
            "size": size,
            "ingest_file_id": ingest_file_id,
            "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        save_json(self.path, self.entries)


def upload(path: Path, config: dict, ledger: Ledger) -> None:
    if ledger.is_done(path):
        log.info("skip (already uploaded): %s", path.name)
        return
    log.info("waiting for write to finish: %s", path.name)
    if not wait_for_write_finish(path):
        log.error("file never stabilized, will retry on next start: %s", path.name)
        return

    for attempt, backoff in enumerate([0] + RETRY_BACKOFF_S):
        if backoff:
            log.info("retry %d for %s in %ds", attempt, path.name, backoff)
            time.sleep(backoff)
        try:
            with path.open("rb") as fh:
                resp = requests.post(
                    config["ingest_url"],
                    files={"file": (path.name, fh, "application/octet-stream")},
                    data={"user_id": config["user_id"]},
                    timeout=600,
                )
            resp.raise_for_status()
            body = resp.json()
            ledger.mark(path, body.get("ingest_file_id"))
            log.info("uploaded %s -> ingest_file_id=%s duplicate=%s",
                     path.name, body.get("ingest_file_id"), body.get("duplicate"))
            return
        except requests.RequestException as exc:
            log.error("upload failed for %s: %s", path.name, exc)
    log.error("giving up on %s for now; it stays un-ledgered and will be "
              "retried on next startup sweep", path.name)


class IbtHandler(FileSystemEventHandler):
    def __init__(self, config: dict, ledger: Ledger):
        self.config = config
        self.ledger = ledger

    def _maybe_upload(self, raw_path: str) -> None:
        path = Path(raw_path)
        if path.suffix.lower() == ".ibt":
            upload(path, self.config, self.ledger)

    def on_created(self, event):
        if not event.is_directory:
            self._maybe_upload(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._maybe_upload(event.dest_path)


def startup_sweep(folder: Path, config: dict, ledger: Ledger) -> None:
    pending = [p for p in sorted(folder.glob("*.ibt")) if not ledger.is_done(p)]
    if pending:
        log.info("startup sweep: %d file(s) not yet uploaded", len(pending))
    for path in pending:
        upload(path, config, ledger)


def main() -> None:
    setup_logging()
    config = load_config()
    folder = Path(config["telemetry_dir"])
    ledger = Ledger(LEDGER_PATH)
    log.info("watching %s -> %s", folder, config["ingest_url"])

    startup_sweep(folder, config, ledger)

    observer = Observer()
    observer.schedule(IbtHandler(config, ledger), str(folder), recursive=False)
    observer.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
