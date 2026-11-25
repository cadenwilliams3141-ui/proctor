import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Inter, Roboto_Mono } from "next/font/google";

import "./globals.css";

/* Carbon's three faces. Chakra Petch for headings and eyebrows, Inter for
   reading, Roboto Mono for every number (globals.css `.num`). next/font inlines
   and self-hosts them at build time rather than hitting Google at runtime. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const mono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
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
    <html lang="en" className={`${inter.variable} ${chakra.variable} ${mono.variable}`}>
      {/* Each app owns all of its own chrome, so the document body is bare. */}
      <body>{children}</body>
    </html>
  );
}
