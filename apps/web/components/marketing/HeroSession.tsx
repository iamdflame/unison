"use client";

import Link from "next/link";
import { facts } from "@/lib/content/facts";
import { useMarketMoment } from "@/lib/time/useMarketMoment";
import { ctaLabel, heroLine } from "@/lib/time/market";
import { archived } from "@/lib/venue/archive";

/**
 * The sentence and call to action under the hero. On a live venue they change with Wall Street's session. On the
 * archived site the sentence says the beta has concluded and links its verdict (the disclosure below carries the
 * dates), and the action opens the simulation.
 */
export function HeroSession() {
  const m = useMarketMoment();
  return (
    <>
      {/* the session, as a small complication: where Wall Street is, and that Unison is open regardless */}
      <p className="mt-7 flex min-h-6 items-start gap-2.5 text-[15px] font-medium text-ink" aria-live="off">
        {/* on the first line, wherever the sentence wraps */}
        <span aria-hidden className="lume mt-[0.6em] size-1.5 shrink-0 rounded-full bg-champagne" />
        {archived ? (
          <span>
            The mainnet beta has concluded.{" "}
            <Link href="/challenge" className="underline decoration-line-strong underline-offset-4">
              {facts.challenge.final.unison.paid ? "See its results." : "Nobody sniped it."}
            </Link>
          </span>
        ) : m ? (
          heroLine(m)
        ) : (
          "Open every night and every weekend."
        )}
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link
          href="/trade/aNVDA"
          className="press inline-flex items-center rounded-[var(--radius-sm)] bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg hover-fine:opacity-90"
        >
          {archived ? "Try the demo" : m ? ctaLabel(m) : "Start trading"}
        </Link>
        <Link href="#one-price" className="group inline-flex items-center gap-2 text-[15px] font-medium text-ink">
          See a batch clear
          <span aria-hidden className="transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </>
  );
}
