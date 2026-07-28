"use client";

/* An analysis box that sizes itself to the screen it's on. By default its
   height tracks the viewport (recomputed on resize) so boxes are large on big
   monitors and compact on laptops with no manual step. `fill` panels give that
   height to a single SVG child so the visual fills the box; other panels keep
   natural (content) height. The user can still drag the corner to override —
   that size is remembered and clamped so it never overflows a smaller screen —
   and a reset control returns the box to auto-fit. Pure UI; no telemetry. */

import { useCallback, useEffect, useRef, useState } from "react";

type Saved = { width: number; height: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function ResizablePanel({
  id,
  children,
  className = "",
  fill = false,
  heightFraction = 0.6,
  minHeight = 280,
  maxHeight = 760,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  fill?: boolean;
  heightFraction?: number;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `proctor-panel-size:${id}`;

  const autoFit = useCallback(
    () =>
      typeof window === "undefined"
        ? minHeight
        : clamp(Math.round(window.innerHeight * heightFraction), minHeight, maxHeight),
    [heightFraction, minHeight, maxHeight],
  );

  const [fitHeight, setFitHeight] = useState<number>(autoFit);
  const [vh, setVh] = useState<number>(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const [manual, setManual] = useState<Saved | null>(null);

  // Restore a previously dragged size (if any) once, on the client.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setManual(JSON.parse(raw) as Saved);
    } catch {
      /* ignore malformed/absent storage */
    }
  }, [key]);

  // Follow the viewport: recompute the auto-fit height on every resize.
  useEffect(() => {
    const onResize = () => {
      setFitHeight(autoFit());
      setVh(window.innerHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [autoFit]);

  // A drag on the native bottom-right resizer becomes an explicit, remembered
  // size. We only persist on that gesture — never on content/auto reflow — so
  // auto-fit stays the default until the user deliberately overrides it.
  const dragging = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX >= r.right - 22 && e.clientY >= r.bottom - 22) dragging.current = true;
  }, []);
  useEffect(() => {
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      const el = ref.current;
      if (!el) return;
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      setManual(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore quota/private-mode errors */
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [key]);

  const resetAuto = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setManual(null);
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  // Manual override wins but is clamped so a size saved on a big monitor never
  // overflows a smaller screen. Auto-fit: fill panels take the viewport height;
  // others keep natural height with a viewport cap.
  let style: React.CSSProperties;
  if (manual) {
    const parentW = ref.current?.parentElement?.clientWidth;
    style = {
      width: parentW ? Math.min(manual.width, parentW) : manual.width,
      height: vh ? Math.min(manual.height, Math.round(vh * 0.92)) : manual.height,
    };
  } else {
    style = fill ? { height: fitHeight } : { maxHeight: fitHeight, minHeight };
  }

  return (
    <div
      ref={ref}
      className={`panel panel--resizable ${fill ? "panel--fill" : ""} ${className}`}
      style={style}
      onPointerDown={onPointerDown}
      title={
        manual
          ? "custom size — drag the corner to adjust, or use ⤢ to auto-fit"
          : "auto-fitted to your screen — drag the corner to set a custom size"
      }
    >
      {manual && (
        <button className="rp-reset" onClick={resetAuto} title="auto-fit to screen" aria-label="auto-fit to screen">
          ⤢
        </button>
      )}
      {children}
    </div>
  );
}
