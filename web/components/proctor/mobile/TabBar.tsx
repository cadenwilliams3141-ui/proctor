"use client";

import { Armchair, LayoutGrid, ListOrdered, Sparkles } from "lucide-react";

import { useProctor, type Screen } from "@/lib/proctor/store";

/* Four tabs: Sessions, Coach, Lap, Gear. Upload and the rig builder are desktop
   concerns — you are not uploading a file from the sofa. The coach is what you
   want after a session; the lap is the drill-down it points into (Live is
   reached from there); Gear is whether it was you or the rig.

   A tab can stand for more than one screen: Coach is lit while an aspect is
   open, Lap while Live is. */
const TABS: { id: Screen; also: Screen[]; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", also: [], label: "Sessions", Icon: LayoutGrid },
  { id: "coach", also: ["aspect"], label: "Coach", Icon: Sparkles },
  { id: "analyze", also: ["live"], label: "Lap", Icon: ListOrdered },
  { id: "hardware", also: [], label: "Gear", Icon: Armchair },
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
      {TABS.map(({ id, also, label, Icon }) => {
        const active = state.screen === id || also.includes(state.screen);
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
              color: active ? "var(--ch-a)" : "var(--color-neutral-500)",
            }}
          >
            {/* Carbon: the active tab's glyph sits in a filled cyan pill, as
                the active screen does on the desktop rail. */}
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 46,
                height: 28,
                borderRadius: 999,
                background: active ? "var(--color-accent)" : "transparent",
                color: active ? "var(--color-on-accent)" : undefined,
              }}
            >
              <Icon size={20} strokeWidth={1.8} />
            </span>
            <span style={{ font: "var(--font-heading-weight) 10.5px var(--font-heading)", letterSpacing: ".02em" }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
