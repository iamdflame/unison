"use client";

import { Fingerprint } from "lucide-react";
import Link from "next/link";
import { site } from "@/lib/content/site";
import { useMarketMoment } from "@/lib/time/useMarketMoment";
import { ctaLabel } from "@/lib/time/market";
import { archived } from "@/lib/venue/archive";

const PRIMARY = "press inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg";
const SECOND = "press inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] px-6 py-3.5 text-[15px] font-semibold text-ink hairline";

/**
 * The close: one sentence for this moment, and two ways in. On a live venue, your own account or a paper one in the
 * simulation. On the archived site, the simulation or the beta's results.
 */
export function Closing() {
  const m = useMarketMoment();
  const verb = archived ? "Try the demo" : m ? ctaLabel(m) : "Start trading";
  return (
    <section aria-labelledby="closing-title" className="mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:px-12 lg:py-48">
      <h2 id="closing-title" className="text-display-xl max-w-5xl text-ink">
        {verb}.
      </h2>
      <p className="text-lede mt-6 max-w-xl text-ink-2">
        {archived
          ? "The real clearing engine runs in your browser, with a paper account. No sign-in, nothing on a chain, and the same price as everyone in your batch."
          : "Sign in with Face ID, Touch ID or Windows Hello. No seed phrase, no gas, and the same price as everyone in your batch."}
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        {archived ? (
          <>
            <Link href="/trade/aNVDA" className={PRIMARY}>
              Trade on paper
            </Link>
            <Link href="/challenge" className={SECOND}>
              See the beta&apos;s results
            </Link>
          </>
        ) : (
          <>
            <Link href="/trade/aNVDA?onboard=passkey" className={PRIMARY}>
              <Fingerprint size={18} strokeWidth={1.5} aria-hidden /> Continue with a passkey
            </Link>
            <Link href="/trade/aNVDA?demo=1" className={SECOND}>
              Trade on paper
            </Link>
          </>
        )}
      </div>
      <p className="mt-8 text-xs text-ink-3">{site.disclosure}</p>
    </section>
  );
}
