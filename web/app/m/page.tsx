import type { Metadata } from "next";

import MobileApp from "@/components/proctor/mobile/MobileApp";
import { ProctorProvider } from "@/lib/proctor/store";
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

export default async function MobilePage() {
  const tier = await readTier();

  return (
    <ProctorProvider initialTier={tier} initialScreen="analyze">
      <MobileApp />
    </ProctorProvider>
  );
}
