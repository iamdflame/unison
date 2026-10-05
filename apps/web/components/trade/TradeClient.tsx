"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import Link from "next/link";
import { marketByTicker } from "@/lib/content/markets";
import { requestSignIn } from "@/lib/ui/signInRequest";
import { listedOn, useVenue } from "@/lib/venue";
import { chooseNetwork } from "@/lib/venue/config";
import { early } from "@/components/app/screens/early";
import { TradeSkeleton } from "./TradeSkeleton";

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
  const v = useVenue();
  const spec = marketByTicker(ticker);
  if (spec && !listedOn(v, spec)) return <NotOnMainnet ticker={ticker} listed={Object.keys(v.net?.deployment.markets ?? {}).map((s) => s.split("/")[0]!)} />;
  return <TradeView ticker={ticker} />;
}

/** Mainnet shows real markets only: one it doesn't list says so, and points to what it does list and to practice. */
function NotOnMainnet({ ticker, listed }: { ticker: string; listed: string[] }) {
  return (
    <section aria-labelledby="not-listed" className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 id="not-listed" className="text-display-m text-ink">
        {ticker} isn&apos;t on mainnet yet.
      </h1>
      <p className="mt-4 text-ink-2">
        The mainnet beta lists {listed.join(" and ")}, with real assets. {ticker} trades on the testnet, with test funds.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {listed[0] ? (
          <Link href={`/trade/${listed[0]}`} className="press rounded-[var(--radius-sm)] bg-ink px-4 py-2.5 text-sm font-semibold text-bg">
            Trade {listed[0]}
          </Link>
        ) : null}
        <button type="button" onClick={() => chooseNetwork("testnet")} className="press rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold text-ink hairline">
          Practice {ticker} on testnet
        </button>
      </div>
    </section>
  );
}
