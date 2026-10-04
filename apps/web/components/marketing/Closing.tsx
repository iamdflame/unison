"use client";

import { ChartSpline, Fingerprint } from "lucide-react";
import Link from "next/link";
import { site } from "@/lib/content/site";
import { useMarketMoment } from "@/lib/time/useMarketMoment";
import { ctaLabel } from "@/lib/time/market";

/** The close: one sentence for this moment, and two ways in: your own account, or a paper one in the simulation. */
export function Closing() {
  const m = useMarketMoment();
  const verb = m ? ctaLabel(m) : "Start trading";
  return (
    <section aria-labelledby="closing-title" className="mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:px-12 lg:py-48">
      <h2 id="closing-title" className="text-display-xl max-w-5xl text-ink">
        {verb}.
      </h2>
      <p className="text-lede mt-6 max-w-xl text-ink-2">
        Sign in with Face ID, Touch ID or Windows Hello. No seed phrase, no gas, and the same price as everyone in
        your batch.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link href="/trade/aNVDA?onboard=passkey" className="press inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg shadow-md">
          <Fingerprint size={18} strokeWidth={1.5} aria-hidden /> Continue with a passkey
        </Link>
        <Link href="/trade/aNVDA?demo=1" className="press inline-flex items-center gap-2.5 rounded-full bg-raised px-6 py-3.5 text-[15px] font-semibold text-ink shadow-sm hairline">
          <ChartSpline size={18} strokeWidth={1.5} aria-hidden /> Trade on paper
        </Link>
      </div>
      <p className="mt-8 text-xs text-ink-3">{site.disclosure}</p>
    </section>
  );
}
