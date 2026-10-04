import type { ReactNode } from "react";
import { Footer } from "@/components/marketing/Footer";
import { Nav } from "@/components/marketing/Nav";
import { SmoothScroll } from "@/components/motion/SmoothScroll";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SmoothScroll />
      <Nav />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
