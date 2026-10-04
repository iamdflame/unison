import type { Metadata } from "next";
import { AgentsClient } from "@/components/app/screens/AgentsScreen";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsClient />;
}
