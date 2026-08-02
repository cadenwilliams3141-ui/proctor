"""Re-send every .ibt in the telemetry folder, forcing a fresh parse.

WHY THIS EXISTS, AND WHY IT HAS TO RUN ON THE RIG
-------------------------------------------------
"Re-ingest the sessions" sounds like something the server should be able to do
to itself. It cannot, and the reason is worth stating plainly so nobody goes
looking for the button again:

    the .ibt bytes are never stored.

`ingest_files` keeps a filename, a SHA-256 and a status. The bytes arrive in the
POST body, go straight into `process_file` in memory, and are gone when the
request ends. There is no reprocess-by-id endpoint and nothing for one to read.
So the only machine that can re-ingest a session is a machine that still has the
file — which is this one.

`force=true` is likewise narrower than it sounds. It does not mean "re-run what
you already have"; it means "do not skip this upload just because you have seen
these bytes before". The file still has to be attached.

WHEN TO RUN IT
--------------
After the analysis modules change. A session parsed last month carries last
month's modules, and the screens that read the new ones will honestly report
them missing until the file goes through again. Re-ingesting deletes and
rewrites that session's rows inside one transaction (see ingest.py), so a
failure leaves the old data alone rather than half-replacing it.

    python reingest.py                 every .ibt in the folder
    python reingest.py --dry-run       list what would be sent, send nothing
    python reingest.py --match mugello only files whose name contains that
    python reingest.py --newest 5      only the five most recent files

Config comes from the same config.json the watcher uses, so the folder and the
ingest URL only ever get set once.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import requests

from uploader import CONFIG_PATH, load_config, setup_logging, log

# Parsing a long race file is not quick and Render is one small service, so
# these are patient by design.
UPLOAD_TIMEOUT_S = 900
POLL_INTERVAL_S = 5
POLL_TIMEOUT_S = 1800

# A file written this recently might still be being written. iRacing flushes as
# it goes, and half a telemetry file parses into a plausible-looking short
# session rather than failing loudly, which is the worst of both worlds.
FRESH_FILE_SECONDS = 120

TERMINAL = {"done", "failed"}


def status_url(ingest_url: str, ingest_id: int) -> str:
    """/ingest -> /ingest/{id}, whatever host the config points at."""
    return f"{ingest_url.rstrip('/')}/{ingest_id}"


def send(path: Path, config: dict) -> tuple[dict | None, str | None]:
    """POST one file with force=true. Returns (reply, error) — exactly one set.

    The error text comes back rather than only being logged: the summary at the
    end has to be able to say WHY each file failed. A failure with no reason is
    worse than no report at all, because you cannot tell whether to retry the
    file or leave it alone.
    """
    try:
        with path.open("rb") as fh:
            resp = requests.post(
                config["ingest_url"],
                files={"file": (path.name, fh, "application/octet-stream")},
                # force is what makes this a RE-ingest: without it the service
                # recognises the SHA-256 and returns the existing row untouched.
                data={"user_id": config["user_id"], "force": "true"},
                timeout=UPLOAD_TIMEOUT_S,
            )
        resp.raise_for_status()
        return resp.json(), None
    except requests.RequestException as exc:
        return None, f"the upload did not complete: {exc}"
    except ValueError as exc:
        return None, f"the service replied with something that is not JSON: {exc}"


def wait_for_parse(ingest_id: int, config: dict) -> tuple[str, str | None]:
    """Poll until the file reaches done or failed. Returns (status, detail).

    Polling rather than fire-and-forget on purpose: /ingest returns 202 the
    moment the bytes land, so without this every file would report success and
    a parse error would only surface days later on a screen.
    """
    deadline = time.monotonic() + POLL_TIMEOUT_S
    while time.monotonic() < deadline:
        try:
            resp = requests.get(status_url(config["ingest_url"], ingest_id), timeout=60)
            resp.raise_for_status()
            body = resp.json()
        except (requests.RequestException, ValueError) as exc:
            # A blip while the service is busy parsing is not a failure of the
            # parse. Keep waiting; the deadline is the real limit.
            log.warning("  status check failed (%s); still waiting", exc)
            time.sleep(POLL_INTERVAL_S)
            continue

        status = str(body.get("status", "unknown"))
        if status in TERMINAL:
            return status, body.get("error_detail")
        time.sleep(POLL_INTERVAL_S)

    return "timed out", (
        f"the service was still parsing after {POLL_TIMEOUT_S // 60} minutes; "
        "it may yet finish — check the ingest queue on the Upload screen"
    )


def choose(folder: Path, args: argparse.Namespace) -> list[Path]:
    files = sorted(folder.glob("*.ibt"), key=lambda p: p.stat().st_mtime)
    if args.match:
        needle = args.match.lower()
        files = [p for p in files if needle in p.name.lower()]
    if args.newest:
        files = files[-args.newest:]
    return files


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Re-send every .ibt to the ingest service, forcing a fresh parse.",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="list what would be sent and send nothing")
    parser.add_argument("--match", metavar="TEXT",
                        help="only files whose name contains this")
    parser.add_argument("--newest", type=int, metavar="N",
                        help="only the N most recently written files")
    parser.add_argument("--include-fresh", action="store_true",
                        help=f"include files written in the last {FRESH_FILE_SECONDS}s "
                             "(skipped by default: they may still be being written)")
    args = parser.parse_args()

    setup_logging()
    config = load_config()
    folder = Path(config["telemetry_dir"])
    if not folder.is_dir():
        log.error("telemetry folder does not exist: %s (fix %s)", folder, CONFIG_PATH)
        return 1

    files = choose(folder, args)
    if not files:
        log.info("no .ibt files matched in %s", folder)
        return 0

    if not args.include_fresh:
        now = time.time()
        fresh = [p for p in files if now - p.stat().st_mtime < FRESH_FILE_SECONDS]
        for p in fresh:
            log.info("skipping %s — written in the last %ds and may still be "
                     "being written (--include-fresh to override)",
                     p.name, FRESH_FILE_SECONDS)
        files = [p for p in files if p not in fresh]
        if not files:
            return 0

    total_mb = sum(p.stat().st_size for p in files) / 1_048_576
    log.info("re-ingesting %d file(s), %.1f MB, to %s",
             len(files), total_mb, config["ingest_url"])
    log.info("each one replaces that session's rows in a single transaction — a "
             "failure leaves the existing data alone")

    if args.dry_run:
        for p in files:
            log.info("  would send %s (%.1f MB)", p.name, p.stat().st_size / 1_048_576)
        log.info("dry run: nothing was sent")
        return 0

    done: list[str] = []
    failed: list[tuple[str, str]] = []

    # Sequential on purpose. Parsing is CPU-bound and the service is one small
    # instance; firing them all at once queues them anyway and risks running it
    # out of memory on a long race file.
    for i, path in enumerate(files, 1):
        log.info("[%d/%d] %s (%.1f MB)", i, len(files), path.name,
                 path.stat().st_size / 1_048_576)
        body, error = send(path, config)
        if body is None:
            log.error("  %s", error)
            failed.append((path.name, error or "the upload did not complete"))
            continue

        ingest_id = body.get("ingest_file_id")
        if ingest_id is None:
            failed.append((path.name, f"no ingest_file_id in the reply: {body}"))
            continue

        status, detail = wait_for_parse(int(ingest_id), config)
        if status == "done":
            log.info("  done (ingest_file_id=%s)", ingest_id)
            done.append(path.name)
        else:
            log.error("  %s: %s", status, detail or "no reason was recorded")
            failed.append((path.name, detail or f"status={status}, no reason recorded"))

    log.info("")
    log.info("re-ingest finished: %d done, %d failed", len(done), len(failed))
    for name, reason in failed:
        # A failure without its reason is worse than no report at all — you
        # cannot tell whether to retry the file or leave it alone.
        log.error("  %s: %s", name, reason)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
