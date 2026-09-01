"use client";

import { CirclePlay, Gauge, LayoutGrid, ListOrdered } from "lucide-react";

import { CH, dim } from "@/lib/proctor/channels";
import { useProctor, type Screen } from "@/lib/proctor/store";

/* Four tabs, not six. Session report and Upload are desktop concerns — you are
   not uploading a file from the sofa, and the report is a reading you do at the
   rig. The phone carries the four things you actually want after a session. */
const TABS: { id: Screen; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "Sessions", Icon: LayoutGrid },
  { id: "analyze", label: "Lap", Icon: ListOrdered },
  { id: "live", label: "Live", Icon: CirclePlay },
  { id: "rig", label: "Physics", Icon: Gauge },
];

export default function TabBar() {
  const { state, dispatch } = useProctor();

  return (
    <nav
      aria-label="Sections"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 65,
        display: "flex",
        padding: "var(--space-2) var(--space-2) calc(env(safe-area-inset-bottom, 0px) + 10px)",
        // A scrim rather than a solid bar, so content scrolling under it fades
        // instead of being chopped off by a hard edge.
        background: "linear-gradient(180deg, transparent, var(--color-bg) 34%)",
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = state.screen === id;
        return (
          <button
            key={id}
            type="button"
            className="tap"
            aria-current={active ? "page" : undefined}
            onClick={() => dispatch({ t: "screen", screen: id })}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              // 44px+ tall: clears the minimum touch target.
              padding: "8px 0",
              borderRadius: 10,
              border: 0,
              background: "transparent",
              color: active ? CH.a : dim(38),
            }}
          >
            <Icon size={21} strokeWidth={1.7} />
            <span style={{ font: "500 10px var(--font-heading)", letterSpacing: ".01em" }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
