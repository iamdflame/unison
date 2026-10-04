import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "@/components/app/TopBar";
import { Toaster } from "@/components/ui/Toaster";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <TopBar />
      <main id="main">{children}</main>
      <Toaster />
    </div>
  );
}
