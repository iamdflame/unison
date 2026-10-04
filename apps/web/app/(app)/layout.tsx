import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StaticEmblem } from "@/components/brand/StaticEmblem";
import { TabBar } from "@/components/app/TabBar";
import { TopBar } from "@/components/app/TopBar";
import { VenueBoot } from "@/components/app/VenueBoot";
import { CertificateHost } from "@/components/trade/CertificateHost";
import { LazyToaster } from "@/components/ui/LazyToaster";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <TopBar mark={<StaticEmblem size={26} jewel />} />
      <main id="main" className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {children}
      </main>
      <TabBar />
      <CertificateHost />
      <LazyToaster />
      <VenueBoot />
    </div>
  );
}
