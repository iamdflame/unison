import type { ReactNode } from "react";
import { Nav } from "@/components/marketing/Nav";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main id="main">{children}</main>
    </>
  );
}
