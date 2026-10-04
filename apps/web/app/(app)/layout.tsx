import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TabBar } from "@/components/app/TabBar";
import { TopBar } from "@/components/app/TopBar";
import { VenueBoot } from "@/components/app/VenueBoot";
import { Toaster } from "@/components/ui/Toaster";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <TopBar />
      <main id="main" className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {children}
      </main>
      <TabBar />
      <Toaster />
      <VenueBoot />
    </div>
  );
}
