"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INGEST_BASE = process.env.NEXT_PUBLIC_INGEST_URL ?? "";

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";

export default function UploadBox() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const poll = useCallback(async (id: number) => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`${INGEST_BASE}/ingest/${id}`);
      if (!res.ok) continue;
      const body = await res.json();
      if (body.status === "done") {
        setPhase("done");
        setMessage("parsed — session is in the list");
        router.refresh();
        return;
      }
      if (body.status === "failed") {
        setPhase("failed");
        setMessage(`parse failed: ${body.error_detail ?? "unknown error"}`);
        return;
      }
      setMessage(`processing (${body.status})…`);
    }
    setPhase("failed");
    setMessage("timed out waiting for the parser");
  }, [router]);

  const send = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".ibt")) {
      setPhase("failed");
      setMessage("that is not an .ibt file");
      return;
    }
    setPhase("uploading");
    setMessage(`uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
    const form = new FormData();
    form.append("file", file);
    form.append("user_id", "caden");
    try {
      const res = await fetch(`${INGEST_BASE}/ingest`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.duplicate && body.status === "done") {
        setPhase("done");
        setMessage("already ingested (same bytes) — it's in the list");
        router.refresh();
        return;
      }
      setPhase("processing");
      setMessage("uploaded — parsing…");
      await poll(body.ingest_file_id);
    } catch (err) {
      setPhase("failed");
      setMessage(`upload failed: ${err instanceof Error ? err.message : String(err)} — the free-tier service cold-starts in ~30-60s, retry if this was the first hit`);
    }
  }, [poll, router]);

  return (
    <div
      className={`upload-drop ${drag ? "active" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void send(f);
      }}
    >
      <p>
        drop an <span className="mono">.ibt</span> here, or{" "}
        <button onClick={() => fileInput.current?.click()}>choose file</button>
      </p>
      <input
        ref={fileInput}
        type="file"
        accept=".ibt"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send(f);
        }}
      />
      {phase !== "idle" && (
        <p className={phase === "failed" ? "pos" : undefined}>{message}</p>
      )}
    </div>
  );
}
