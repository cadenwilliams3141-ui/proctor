import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

/* Inter throughout — headings and body are the same family; hierarchy comes
   from size and space, never from a heavier weight. next/font inlines and
   self-hosts it at build time rather than hitting Google at runtime, which is
   what the design handoff asks for. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Proctor",
  description:
    "iRacing telemetry analysis. Observations, not verdicts — every comparison is you against you.",
};

/* Every route under this layout needs this, and until now only /m had one.
   Without width=device-width a phone lays the page out at a ~980px virtual
   viewport and scales the result down, so the desktop shell arrived on a phone
   as an unreadable thumbnail — and the phone app is reached THROUGH a page
   under this layout, so the one route that got this right was behind a page
   that did not. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      {/* Each app owns all of its own chrome, so the document body is bare. */}
      <body>{children}</body>
    </html>
  );
}
