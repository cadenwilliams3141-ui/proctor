"use client";

import { useEffect, useRef, useState } from "react";

/** The rendered size of a box, kept current as it resizes.
 *
 *  For SVGs that should FILL their panel rather than letterbox inside a fixed
 *  viewBox: the corner map is fitted to whatever shape the panel is, so a wide
 *  screen gets a wide map instead of a square one with bars either side. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) =>
        Math.round(s.w) === Math.round(width) && Math.round(s.h) === Math.round(height)
          ? s
          : { w: width, h: height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
