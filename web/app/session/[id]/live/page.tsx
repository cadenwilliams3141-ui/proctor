import Link from "next/link";
import LiveTrace from "@/components/LiveTrace";
import { readTier } from "@/lib/tier-server";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tier = await readTier();
  return (
    <>
      <p><Link href={`/session/${id}`}>← session report</Link></p>
      <LiveTrace sessionId={id} tier={tier} />
    </>
  );
}
