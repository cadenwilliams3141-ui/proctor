import Link from "next/link";
import LapAnalysis from "@/components/LapAnalysis";

export default async function LapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <p><Link href={`/session/${id}`}>← session report</Link></p>
      <LapAnalysis sessionId={id} />
    </>
  );
}
