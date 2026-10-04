"use client";

import dynamic from "next/dynamic";

/** The terminal is a live instrument: it renders on the client, with a skeleton holding its exact place. */
const TradeView = dynamic(() => import("./TradeView").then((m) => m.TradeView), {
  ssr: false,
  loading: () => <TradeSkeleton />,
});

export function TradeClient({ ticker }: { ticker: string }) {
  return <TradeView ticker={ticker} />;
}

function TradeSkeleton() {
  return (
    <div className="mx-auto max-w-[1680px] animate-pulse px-4 py-5 motion-reduce:animate-none sm:px-6 lg:py-7" aria-busy="true" aria-label="Loading the market">
      <div className="h-6 w-48 rounded-full bg-sunken" />
      <div className="mt-3 h-12 w-64 rounded-2xl bg-sunken" />
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="aspect-[900/470] rounded-[var(--radius-xl)] bg-raised shadow-md" />
        <div className="h-[620px] rounded-[var(--radius-xl)] bg-raised shadow-md" />
      </div>
    </div>
  );
}
