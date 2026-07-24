import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import TierSelect from "@/components/TierSelect";

export const metadata: Metadata = {
  title: "Proctor",
  description: "Sim-racing telemetry: observations, not verdicts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <Link href="/" className="brand">Proctor</Link>
          <span className="tagline">observations, not verdicts — you vs. you</span>
          <span className="spacer" />
          <TierSelect />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
