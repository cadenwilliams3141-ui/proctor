import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import TierSelect from "@/components/TierSelect";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Proctor",
  description: "Sim-racing telemetry: observations, not verdicts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
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
