import type { Metadata } from "next";
import { VaultsClient } from "@/components/app/pages";

export const metadata: Metadata = { title: "Vaults" };

export default function VaultsPage() {
  return <VaultsClient />;
}
