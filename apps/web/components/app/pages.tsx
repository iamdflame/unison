"use client";

import dynamic from "next/dynamic";

/**
 * The app's live pages render on the client only: they read clocks, simulations and the venue, none of which
 * the server can know. Each one holds its exact place with a skeleton until it arrives.
 */
function Skeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse px-4 py-8 motion-reduce:animate-none sm:px-6 lg:py-12" aria-busy="true" aria-label={label}>
      <div className="h-11 w-48 rounded-2xl bg-sunken" />
      <div className="mt-4 h-5 w-80 max-w-full rounded-xl bg-sunken" />
      <div className="mt-8 rounded-[var(--radius-xl)] bg-raised shadow-md" style={{ height: 56 + rows * 68 }} />
    </div>
  );
}

export const MarketsClient = dynamic(() => import("./MarketsBoard").then((m) => m.MarketsBoard), {
  ssr: false,
  loading: () => <Skeleton rows={10} label="Loading markets" />,
});

export const PortfolioClient = dynamic(() => import("@/components/portfolio/Portfolio").then((m) => m.Portfolio), {
  ssr: false,
  loading: () => <Skeleton rows={6} label="Loading your portfolio" />,
});
