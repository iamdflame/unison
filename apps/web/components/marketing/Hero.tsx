import Link from "next/link";
import { ResonanceDial } from "@/components/brand/ResonanceDial";
import { marketByTicker } from "@/lib/content/markets";
import { site } from "@/lib/content/site";
import { HeroSession } from "./HeroSession";

/**
 * The first screen. The headline is static and paints first (it is the LCP); the instrument beside it is alive.
 * Copy that depends on Wall Street's session renders on the client, so cached HTML never states a stale fact.
 */
export function Hero() {
  const nvda = marketByTicker("aNVDA")!;
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="mx-auto grid min-h-[100svh] max-w-[1440px] grid-cols-1 items-center gap-x-10 gap-y-6 px-5 pt-28 pb-16 sm:px-8 lg:grid-cols-12 lg:px-12 lg:pt-24">
        {/* phones read headline, instrument, then the words; from lg the words take the left column, the dial the right */}
        <div className="contents lg:col-span-6 lg:block">
          <h1 id="hero-title" className="text-display-xxl order-1 text-ink lg:order-none">
            The market
            <br />
            that never closes.
          </h1>
          <div className="order-3 lg:order-none">
            <p className="text-lede max-w-xl text-ink-2 lg:mt-7">
              {/* one idea a sentence; how the price is found belongs to the chapters below and to Developers */}
              Tokenized stocks on Monad, traded day and night. Every order in a batch clears at one price. No one can
              trade ahead of you.
            </p>
            <HeroSession />
            {/* what the venue is today, before anyone presses a button */}
            <p className="mt-8 max-w-xl text-[13px] leading-relaxed text-ink-3">{site.disclosure}</p>
          </div>
        </div>
        <div className="order-2 mx-auto w-full max-w-[min(84vw,560px)] lg:order-none lg:col-span-6 lg:max-w-[680px] lg:justify-self-end">
          <ResonanceDial market={nvda} />
        </div>
      </div>
      <Link
        href="#one-price"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-xs text-ink-3 transition-colors hover-fine:text-ink lg:block"
      >
        One price for everyone ↓
      </Link>
    </section>
  );
}
