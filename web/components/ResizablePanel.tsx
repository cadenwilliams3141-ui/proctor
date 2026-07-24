"use client";

/* A panel the user can drag to resize (CSS resize), remembering its size in
   localStorage so it survives navigation. Pure UI convenience — no telemetry,
   no server state. Falls back to a normal panel before hydration. */

import { useEffect, useRef, useState } from "react";

type Size = { width?: number; height?: number };

export default function ResizablePanel({
  id,
  children,
  minHeight = 180,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({});
  const key = `proctor-panel-size:${id}`;

  // Restore any saved size once, on the client.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setSize(JSON.parse(raw) as Size);
    } catch {
      /* ignore malformed/absent storage */
    }
  }, [key]);

  // Persist the dragged size. ResizeObserver captures the CSS-resize handle.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore quota/private-mode errors */
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [key]);

  return (
    <div
      ref={ref}
      className={`panel panel--resizable ${className}`}
      style={{
        minHeight,
        width: size.width,
        height: size.height,
      }}
      title="drag the bottom-right corner to resize"
    >
      {children}
    </div>
  );
}
