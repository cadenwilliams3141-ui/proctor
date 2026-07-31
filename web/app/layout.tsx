import type { Metadata } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      {/* Each app owns all of its own chrome, so the document body is bare. */}
      <body>{children}</body>
    </html>
  );
}
