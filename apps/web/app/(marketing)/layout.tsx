import type { ReactNode } from "react";
import { Lockup } from "@/components/brand/Lockup";
import { StaticEmblem } from "@/components/brand/StaticEmblem";
import { Footer } from "@/components/marketing/Footer";
import { Nav } from "@/components/marketing/Nav";
import { SmoothScroll } from "@/components/motion/SmoothScroll";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SmoothScroll />
      <Nav
        brand={
          <>
            <Lockup capHeight={11.5} className="hidden translate-y-[2px] sm:block" title="" />
            <StaticEmblem size={24} jewel className="sm:hidden" />
          </>
        }
      />
      {/* clip, not hidden: no scroll container, so pinned chapters stay sticky; 3D plates can't widen the page */}
      <main id="main" className="overflow-x-clip">
        {children}
      </main>
      <Footer />
    </>
  );
}
