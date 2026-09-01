import { Monitor, Smartphone } from "lucide-react";

import { dim } from "@/lib/proctor/channels";

/* The way back across.
 *
 * Middleware sends a phone to /m, which is right almost always and wrong
 * sometimes — a phone in landscape, a driver who wants the ribbon, a desktop
 * browser with a phone user agent set. A redirect with no way out decides for
 * someone who has already decided, so both apps carry a link to the other and
 * the choice is remembered in a cookie (see middleware.ts).
 *
 * These are real <a> links rather than router pushes on purpose: the whole
 * point is a full navigation that lets the middleware see the parameter and
 * set the cookie. */
export default function ViewSwitch({
  to,
  compact = false,
}: {
  to: "desktop" | "phone";
  /* The icon rail is one glyph wide, so there the label becomes the accessible
     name rather than visible text. Everywhere else it is spelled out — an
     unlabelled icon is a guess, and this control changes which app you are in. */
  compact?: boolean;
}) {
  const desktop = to === "desktop";
  const Icon = desktop ? Monitor : Smartphone;
  const label = desktop ? "Open the desktop view" : "Open the phone view";

  return (
    <a
      className="tap"
      href={desktop ? "/?desktop=1" : "/m?desktop=0"}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 0 : 7,
        // 44px square in the rail so it clears the minimum touch target.
        padding: compact ? "12px" : "8px 10px",
        borderRadius: "var(--radius-sm)",
        fontSize: 11.5,
        lineHeight: 1.4,
        color: dim(52),
        textDecoration: "none",
      }}
    >
      <Icon size={compact ? 18 : 15} strokeWidth={1.6} />
      {!compact && label}
    </a>
  );
}
