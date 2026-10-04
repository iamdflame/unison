import type { Metadata } from "next";
import { AgentsClient } from "@/components/app/pages";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsClient />;
}
