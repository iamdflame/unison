import type { ReactNode } from "react";
import { Footer } from "@/components/marketing/Footer";
import { Nav } from "@/components/marketing/Nav";
import { SmoothScroll } from "@/components/motion/SmoothScroll";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SmoothScroll />
      <Nav />
      {/* clip, not hidden: no scroll container, so pinned chapters stay sticky; 3D plates can't widen the page */}
      <main id="main" className="overflow-x-clip">
        {children}
      </main>
      <Footer />
    </>
  );
}
