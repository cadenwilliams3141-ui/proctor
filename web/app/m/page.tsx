import type { Metadata } from "next";

import MobileApp from "@/components/proctor/mobile/MobileApp";
import { ProctorProvider, type Screen } from "@/lib/proctor/store";
import { readTier } from "@/lib/tier-server";

/* The phone app. A separate build rather than the desktop shell squeezed:
   see components/proctor/mobile/MobileApp.tsx for what diverges and why. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proctor",
  description: "The after-session read.",
  /* Added to the home screen, this opens fullscreen with no browser chrome.
     `black-translucent` lets the app paint under the status bar, which only
     works because the layout already respects env(safe-area-inset-*) — the
     tab bar and the corner sheet both sit against the home indicator. */
  appleWebApp: {
    capable: true,
    title: "Proctor",
    statusBarStyle: "black-translucent",
  },
  /* Next emits the standardised `mobile-web-app-capable`. iOS 16.4+ honours the
     manifest's display:standalone, but older iOS only understands the legacy
     Apple name — so it is set explicitly rather than left to chance. */
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // The bottom tab bar and the corner sheet both sit against the home
  // indicator, so the app needs the real safe-area insets.
  viewportFit: "cover" as const,
  themeColor: "#161826",
};

/* The four the phone actually has. Report and Upload are desktop-only by
   design (see mobile/TabBar.tsx), so a link to one of them cannot be honoured
   here and falls back to the ranked lap read rather than landing on a tab that
   does not exist. */
const PHONE_SCREENS: Screen[] = ["sessions", "analyze", "live", "rig"];

export default async function MobilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tier = await readTier();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  /* ?screen= survives the redirect from /, so a link one driver sends another
     opens on the screen they meant. Without this the parameter arrived and was
     ignored, which is worse than not carrying it — the address bar would say
     one thing and the app show another. */
  const asked = one(q.screen) as Screen | undefined;
  const screen = asked && PHONE_SCREENS.includes(asked) ? asked : "analyze";

  return (
    <ProctorProvider
      initialTier={tier}
      initialScreen={screen}
      skipSplash={q.screen != null || q.view != null}
    >
      <MobileApp />
    </ProctorProvider>
  );
}
