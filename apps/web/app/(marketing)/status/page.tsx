import type { Metadata } from "next";
import { StatusClient } from "@/components/app/pages";
import { VenueBoot } from "@/components/app/VenueBoot";

export const metadata: Metadata = { title: "Status", description: "Unison's chain, indexer, relayer and reference relay, and every market's last clear, live." };

export default function StatusPage() {
  return (
    <>
      <StatusClient />
      <VenueBoot />
    </>
  );
}
