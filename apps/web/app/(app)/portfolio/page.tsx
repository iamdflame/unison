import type { Metadata } from "next";
import { PortfolioClient } from "@/components/app/pages";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return <PortfolioClient />;
}
