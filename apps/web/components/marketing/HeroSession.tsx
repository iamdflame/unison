"use client";

import Link from "next/link";
import { useMarketMoment } from "@/lib/time/useMarketMoment";
import { ctaLabel, heroLine } from "@/lib/time/market";

/** The sentence and call to action that change with Wall Street's session. */
export function HeroSession() {
  const m = useMarketMoment();
  return (
    <>
      {/* the session, as a small complication: where Wall Street is, and that Unison is open regardless */}
      <p className="mt-7 flex min-h-6 items-center gap-2.5 text-[15px] font-medium text-ink" aria-live="off">
        <span aria-hidden className="lume size-1.5 shrink-0 rounded-full bg-accent" />
        {m ? heroLine(m) : "Open every night and every weekend."}
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link
          href="/trade/aNVDA"
          className="press inline-flex items-center rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg shadow-md hover-fine:opacity-90"
        >
          {m ? ctaLabel(m) : "Start trading"}
        </Link>
        <Link href="#one-price" className="group inline-flex items-center gap-2 text-[15px] font-medium text-ink">
          See a batch clear
          <span aria-hidden className="transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover-fine:group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </>
  );
}
