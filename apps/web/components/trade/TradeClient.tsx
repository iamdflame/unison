"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { requestSignIn } from "@/lib/ui/signInRequest";
import { early } from "@/components/app/screens/early";

/**
 * The terminal is a live instrument: it renders on the client, with a skeleton holding its exact place. Its code
 * starts downloading with the page's own scripts, not after hydration.
 */
const load = early(() => import("./TradeView").then((m) => m.TradeView));
const TradeView = dynamic(() => load(), { ssr: false, loading: () => <TradeSkeleton /> });

export function TradeClient({ ticker }: { ticker: string }) {
  // "Continue with a passkey" lands here with ?onboard=passkey: ask for the sign-in sheet, once, and tidy the URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("onboard") !== "passkey") return;
    params.delete("onboard");
    const rest = params.toString();
    window.history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}`);
    requestSignIn();
  }, []);
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
