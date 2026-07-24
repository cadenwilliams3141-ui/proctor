import Link from "next/link";
import LapAnalysis from "@/components/LapAnalysis";
import { readTier } from "@/lib/tier-server";

export default async function LapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tier = await readTier();
  return (
    <>
      <p><Link href={`/session/${id}`}>← session report</Link></p>
      <LapAnalysis sessionId={id} tier={tier} />
    </>
  );
}
