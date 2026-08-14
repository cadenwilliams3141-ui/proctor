"use client";

/* Upload. The button on this screen used to do nothing at all — no input, no
 * handler, no drop target. It does now, three ways:
 *
 *   1. Choose a file        a real file input, everywhere
 *   2. Drag one in          the dashed box is a live drop target
 *   3. Remember my folder   pick the telemetry folder once, then "load my
 *                           newest session" is one click on every later visit
 *
 * (3) is as close as a browser gets to the default path that was asked for. A
 * page cannot be handed a filesystem path and go and read it; it CAN hold a
 * handle to a folder the driver picked and reopen it later. See
 * lib/proctor/telemetryFolder for why, and for what happens in the browsers
 * that have no such API.
 *
 * The queue below is not decoration either. A file that fails to parse has to
 * come back with the reason it failed, or the driver cannot tell whether to
 * retry it, re-record it, or leave it alone. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  FileUp,
  FolderOpen,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Upload as UploadIcon,
} from "lucide-react";

import Caveat from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { CH, dim } from "@/lib/proctor/channels";
import { data } from "@/lib/proctor/data-source";
import {
  chooseFolder,
  folderPermission,
  forgetFolder,
  newestTelemetry,
  rememberedFolder,
  requestFolderAccess,
  supportsFolderMemory,
  type FoundFile,
  type FsDirectoryHandle,
} from "@/lib/proctor/telemetryFolder";
import { useProctor } from "@/lib/proctor/store";
import type { IngestRow } from "@/lib/proctor/types";

type Job = {
  name: string;
  size: number;
  state: "uploading" | "queued" | "duplicate" | "failed";
  detail?: string;
  ingestId?: number;
  /** 0..1 of bytes sent. A 136 MB file over a home connection is minutes of
   *  silence otherwise, and silence is indistinguishable from a hang. */
  progress?: number;
};

const POLL_MS = 4000;

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

/* Send one file straight to the ingest service.
 *
 * XHR rather than fetch, for the one thing fetch still cannot do: report upload
 * progress. These files are tens of megabytes and the queue below cannot show
 * anything until the bytes have landed, so without this the screen is blank for
 * minutes and looks broken — which is how this path was described when it was
 * reported. */
function postFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ ingest_file_id?: number; duplicate?: boolean }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("user_id", "caden");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "The ingest service could not be reached. Nothing was uploaded, so nothing was lost — it may be asleep; try again in a moment.",
        ),
      );
    xhr.ontimeout = () => reject(new Error("The upload timed out before it finished."));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // Falls through to the status check, which produces a better message
        // than a parse error ever did.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as { ingest_file_id?: number; duplicate?: boolean });
        return;
      }
      const detail =
        typeof body.detail === "string"
          ? body.detail
          : xhr.responseText.slice(0, 300) || `${xhr.status}`;
      reject(new Error(`The ingest service rejected ${file.name}: ${detail}`));
    };
    xhr.send(form);
  });
}

export default function UploadScreen() {
  const { dispatch } = useProctor();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<IngestRow[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Remembered folder
  const [folder, setFolder] = useState<FsDirectoryHandle | null>(null);
  const [folderState, setFolderState] = useState<PermissionState | null>(null);
  const [newest, setNewest] = useState<FoundFile | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderNote, setFolderNote] = useState<string | null>(null);
  /* Whether the browser can remember a folder is a CLIENT fact, so it is
     discovered in an effect rather than during render. Asking during render
     makes the server say "no" and the browser say "yes" for the same markup,
     which is a hydration mismatch — React throws away the server tree and
     re-renders, and the console fills with a diff. */
  const [canRemember, setCanRemember] = useState(false);
  useEffect(() => setCanRemember(supportsFolderMemory()), []);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await data.listIngest());
      setQueueError(null);
    } catch (e) {
      setQueueError(String((e as Error)?.message ?? e));
    }
  }, []);

  useEffect(() => {
    refreshQueue();
    // While anything is in flight the queue is the only place progress shows,
    // so it refreshes on a timer rather than waiting for a reload.
    const t = setInterval(refreshQueue, POLL_MS);
    return () => clearInterval(t);
  }, [refreshQueue]);

  // A folder picked on a previous visit. This never prompts — Chromium drops
  // the read grant between visits, and a permission dialog nobody asked for on
  // page load is worse than a button.
  useEffect(() => {
    if (!canRemember) return;
    let live = true;
    (async () => {
      const handle = await rememberedFolder();
      if (!live || !handle) return;
      setFolder(handle);
      const state = await folderPermission(handle);
      if (!live) return;
      setFolderState(state);
      if (state === "granted") setNewest(await newestTelemetry(handle));
    })();
    return () => {
      live = false;
    };
  }, [canRemember]);

  const upload = useCallback(
    async (files: File[]) => {
      /* The address comes from the server so PROCTOR_INGEST_URL still works,
         but the FILE never travels through this app — see app/api/ingest-url. */
      let target: string;
      try {
        const res = await fetch("/api/ingest-url");
        target = ((await res.json()) as { url: string }).url;
      } catch (e) {
        setJobs((j) => [
          {
            name: files[0]?.name ?? "that file",
            size: files[0]?.size ?? 0,
            state: "failed",
            detail: `Could not work out where to send it: ${String((e as Error)?.message ?? e)}`,
          },
          ...j,
        ]);
        return;
      }

      for (const file of files) {
        const key = `${file.name}:${file.size}`;
        setJobs((j) => [
          { name: file.name, size: file.size, state: "uploading", progress: 0 }, ...j,
        ]);
        const patch = (fn: (job: Job) => Job) =>
          setJobs((j) =>
            j.map((job) =>
              `${job.name}:${job.size}` === key && job.state === "uploading" ? fn(job) : job,
            ),
          );

        try {
          const body = await postFile(target, file, (p) => patch((job) => ({ ...job, progress: p })));
          patch((job) => ({
            ...job,
            state: body.duplicate ? "duplicate" : "queued",
            progress: 1,
            ingestId: body.ingest_file_id,
            detail: body.duplicate
              ? "These exact bytes are already in the database — nothing was re-parsed."
              : "Sent. The parser picks it up from here; watch the queue below.",
          }));
          refreshQueue();
        } catch (e) {
          patch((job) => ({
            ...job,
            state: "failed",
            detail: String((e as Error)?.message ?? e),
          }));
        }
      }
    },
    [refreshQueue],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => /\.ibt$/i.test(f.name));
      if (files.length === 0) {
        setJobs((j) => [
          {
            name: Array.from(e.dataTransfer.files)[0]?.name ?? "that",
            size: 0,
            state: "failed",
            detail: "Not a .ibt telemetry file. iRacing writes those into your telemetry folder at the end of a session.",
          },
          ...j,
        ]);
        return;
      }
      upload(files);
    },
    [upload],
  );

  const pickFolder = useCallback(async () => {
    setFolderBusy(true);
    setFolderNote(null);
    try {
      const handle = await chooseFolder();
      setFolder(handle);
      setFolderState("granted");
      const found = await newestTelemetry(handle);
      setNewest(found);
      if (!found) setFolderNote("That folder holds no .ibt files yet.");
    } catch (e) {
      // A cancelled dialog is not an error worth shouting about.
      const message = String((e as Error)?.message ?? e);
      if (!/abort/i.test(message)) setFolderNote(message);
    } finally {
      setFolderBusy(false);
    }
  }, []);

  const rescan = useCallback(async () => {
    if (!folder) return;
    setFolderBusy(true);
    setFolderNote(null);
    try {
      if (!(await requestFolderAccess(folder))) {
        setFolderState("denied");
        setFolderNote("Read access to that folder was not granted, so nothing was looked at.");
        return;
      }
      setFolderState("granted");
      const found = await newestTelemetry(folder);
      setNewest(found);
      if (!found) setFolderNote("That folder holds no .ibt files yet.");
    } catch (e) {
      setFolderNote(String((e as Error)?.message ?? e));
    } finally {
      setFolderBusy(false);
    }
  }, [folder]);

  const sendNewest = useCallback(async () => {
    if (!folder) return;
    setFolderBusy(true);
    try {
      if (!(await requestFolderAccess(folder))) {
        setFolderState("denied");
        setFolderNote("Read access to that folder was not granted, so nothing was uploaded.");
        return;
      }
      const found = await newestTelemetry(folder);
      setNewest(found);
      if (!found) {
        setFolderNote("That folder holds no .ibt files yet, so there was nothing to send.");
        return;
      }
      await upload([found.file]);
    } finally {
      setFolderBusy(false);
    }
  }, [folder, upload]);

  return (
    <div className="scrollpane" style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 860 }}>
        {/* ── The drop target ──────────────────────────────────────────── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `1px dashed ${dragging ? "var(--color-accent)" : "var(--color-neutral-700)"}`,
            background: dragging
              ? "color-mix(in srgb, var(--color-accent) 7%, transparent)"
              : "transparent",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-8)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-2)",
            textAlign: "center",
            transition: "background .15s, border-color .15s",
          }}
        >
          <FileUp size={26} strokeWidth={1.4} color={CH.a} />
          <div style={{ font: "500 15px var(--font-heading)" }}>
            {dragging ? "Let go to upload" : "Drop a .ibt file here"}
          </div>
          <div style={{ fontSize: 12.5, color: dim(52), maxWidth: 480, lineHeight: 1.6 }}>
            iRacing writes these to your telemetry folder at the end of every
            session. Proctor reads them directly — nothing is installed inside the
            sim and no setting changes.
          </div>

          <input
            ref={input}
            type="file"
            accept=".ibt"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) upload(files);
              // Cleared so choosing the same file twice fires again.
              e.target.value = "";
            }}
          />
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => input.current?.click()}
            >
              <UploadIcon size={14} />
              Choose a file
            </button>
            {canRemember && !folder && (
              <button type="button" className="btn btn-secondary" onClick={pickFolder} disabled={folderBusy}>
                <FolderOpen size={14} />
                Remember my telemetry folder
              </button>
            )}
          </div>
        </div>

        {/* ── The remembered folder ────────────────────────────────────── */}
        {canRemember && folder && (
          <Panel padding="var(--space-4)" style={{ marginTop: "var(--space-3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <FolderOpen size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>{folder.name}</span>
              <span style={{ fontSize: 11, color: dim(42) }}>your remembered telemetry folder</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="pk"
                onClick={() => {
                  forgetFolder();
                  setFolder(null);
                  setNewest(null);
                  setFolderState(null);
                  setFolderNote(null);
                }}
                style={{
                  border: 0,
                  background: "transparent",
                  color: dim(42),
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                forget it
              </button>
            </div>

            {folderState !== "granted" ? (
              <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: "0 0 10px" }}>
                The browser drops read access to a folder between visits, so it
                has to be confirmed once per session. Nothing has been read yet.
              </p>
            ) : newest ? (
              <div style={{ fontSize: 12, color: dim(70), lineHeight: 1.6, marginBottom: 10 }}>
                Newest file:{" "}
                <span className="mono" style={{ color: "var(--color-text)" }}>{newest.name}</span>{" "}
                <span style={{ color: dim(45) }}>
                  · {(newest.size / 1_048_576).toFixed(1)} MB · written{" "}
                  {new Date(newest.modified).toLocaleString()}
                </span>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: dim(62), margin: "0 0 10px" }}>
                No .ibt files in that folder yet.
              </p>
            )}

            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={sendNewest}
                disabled={folderBusy}
              >
                {folderBusy ? <Loader2 size={14} className="spin" /> : <UploadIcon size={14} />}
                {folderState === "granted" && newest
                  ? "Upload my newest session"
                  : "Open the folder and upload the newest"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={rescan} disabled={folderBusy}>
                <RefreshCw size={14} />
                Look again
              </button>
            </div>

            {folderNote && (
              <p style={{ fontSize: 11.5, color: CH.warn, margin: "10px 0 0", lineHeight: 1.5 }}>
                {folderNote}
              </p>
            )}

            <Caveat maxWidth={660}>
              Proctor never gets a path, and it cannot go looking through your
              drive. It holds a handle to the one folder you picked, reads only
              the .ibt files in it, and forgets the whole thing the moment you
              click forget it.
            </Caveat>
          </Panel>
        )}

        {!canRemember && (
          <Caveat maxWidth={700}>
            This browser has no folder picker, so a default folder cannot be
            remembered here — that API is Chromium-only today. Choose a file
            still works, and the rig watcher below does this automatically on
            every platform.
          </Caveat>
        )}

        {/* ── This visit's uploads ─────────────────────────────────────── */}
        {jobs.length > 0 && (
          <Panel
            title="This visit"
            sub={`${jobs.length} file${jobs.length === 1 ? "" : "s"}`}
            padding="var(--space-4)"
            style={{ marginTop: "var(--space-3)" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {jobs.map((job, i) => (
                <div key={`${job.name}-${i}`} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <JobIcon state={job.state} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>{job.name}</span>
                      {job.size > 0 && (
                        <span style={{ fontSize: 10.5, color: dim(38) }}>
                          {fmtBytes(job.size)}
                        </span>
                      )}
                      {job.state === "uploading" && job.progress != null && (
                        <span className="num" style={{ fontSize: 10.5, color: CH.a }}>
                          {Math.round(job.progress * 100)}%
                          {job.size > 0 && (
                            <span style={{ color: dim(38) }}>
                              {" "}· {fmtBytes(job.progress * job.size)} sent
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* These files are tens of megabytes. Without a bar the
                        screen sits silent for minutes, which is exactly what
                        "it will not take my file" looked like. */}
                    {job.state === "uploading" && (
                      <div
                        style={{
                          height: 4,
                          borderRadius: 2,
                          background: dim(9),
                          overflow: "hidden",
                          marginTop: 5,
                          width: 260,
                          maxWidth: "100%",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 2,
                            background: CH.a,
                            width: `${Math.round((job.progress ?? 0) * 100)}%`,
                            transition: "width .2s linear",
                          }}
                        />
                      </div>
                    )}

                    {job.detail && (
                      <div style={{ fontSize: 11.5, color: job.state === "failed" ? CH.loss : dim(55), lineHeight: 1.5, marginTop: 2 }}>
                        {job.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── The queue ────────────────────────────────────────────────── */}
        <Panel
          title="Ingest queue"
          sub="what the parser has been given"
          padding="var(--space-4)"
          style={{ marginTop: "var(--space-3)" }}
          right={
            <button
              type="button"
              className="pk"
              onClick={refreshQueue}
              title="Refresh"
              style={{ border: 0, background: "transparent", color: dim(40), cursor: "pointer", padding: 3 }}
            >
              <RefreshCw size={13} />
            </button>
          }
          foot={
            <Caveat>
              A file that failed always shows the reason it failed. A failure
              with no detail is worse than no row at all — you could not tell
              whether to retry it or give up on it.
            </Caveat>
          }
        >
          {queueError ? (
            <div style={{ fontSize: 12, color: CH.loss, lineHeight: 1.6 }}>{queueError}</div>
          ) : queue == null ? (
            <div style={{ fontSize: 12, color: dim(45) }}>Reading…</div>
          ) : queue.length === 0 ? (
            <div style={{ fontSize: 12, color: dim(55) }}>
              Nothing has been uploaded yet.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>file</th>
                  <th style={{ width: 90 }}>status</th>
                  <th style={{ width: 150 }}>uploaded</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>{row.filename}</span>
                      {row.status === "failed" && row.error_detail && (
                        <div style={{ fontSize: 11, color: CH.loss, lineHeight: 1.5, marginTop: 3 }}>
                          {row.error_detail}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusTag status={row.status} />
                    </td>
                    <td className="num" style={{ color: dim(50), fontSize: 11 }}>
                      {new Date(row.uploaded_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div
          style={{
            marginTop: "var(--space-3)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Panel padding="var(--space-4)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Monitor size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>The rig watcher</span>
            </div>
            <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: 0 }}>
              A small folder-watcher on the rig sends each file as it appears, so
              you rarely need this screen. It waits for the write to finish — file
              size stable for five seconds — before uploading, so a half-written
              file is never sent.
            </p>
          </Panel>

          <Panel padding="var(--space-4)">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <ShieldCheck size={15} strokeWidth={1.7} color={CH.a} />
              <span style={{ font: "500 12.5px var(--font-heading)" }}>What happens to it</span>
            </div>
            <p style={{ fontSize: 12, color: dim(62), lineHeight: 1.6, margin: 0 }}>
              The file is parsed into laps and channels, and the analysis modules
              run over the result. Your telemetry stays yours: it is never pooled
              into anyone else&apos;s comparison, because every comparison in this
              app is you against you.
            </p>
          </Panel>
        </div>

        <div style={{ marginTop: "var(--space-4)" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => dispatch({ t: "screen", screen: "sessions" })}
          >
            Go to sessions
          </button>
        </div>
      </div>
    </div>
  );
}

function JobIcon({ state }: { state: Job["state"] }) {
  const common = { size: 14, strokeWidth: 1.9, style: { flex: "none", marginTop: 2 } } as const;
  if (state === "uploading") return <Loader2 {...common} color={CH.a} className="spin" />;
  if (state === "failed") return <CircleAlert {...common} color={CH.loss} />;
  if (state === "duplicate") return <CheckCircle2 {...common} color={dim(45)} />;
  return <CheckCircle2 {...common} color={CH.gain} />;
}

function StatusTag({ status }: { status: IngestRow["status"] }) {
  const map: Record<IngestRow["status"], { label: string; color: string }> = {
    queued: { label: "queued", color: dim(50) },
    parsing: { label: "parsing", color: CH.a },
    done: { label: "done", color: CH.gain },
    failed: { label: "failed", color: CH.loss },
  };
  const it = map[status] ?? { label: String(status), color: dim(50) };
  return (
    <span style={{ fontSize: 11, color: it.color, display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: it.color }} />
      {it.label}
    </span>
  );
}
