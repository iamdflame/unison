import { facts } from "@/lib/content/facts";
import { FrontRunFigure } from "./FrontRunFigure";

/**
 * Chapter 2: speed buys no better price. The words render on the server; the benchmark figure is the client island.
 */
export function FrontRun() {
  return (
    <section aria-labelledby="front-run-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 gap-x-12 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="front-run-title" className="text-display-l text-ink">
            Speed buys no better price.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            On most venues, whoever sees the price move first trades against everyone else&apos;s stale quotes. Inside a
            Unison batch, every order gets one price, so arriving first buys no better one. In session, that price is
            set by a reference observed only after the auction&apos;s orders are sealed, so there is nothing left to race for.
          </p>
          <p className="text-lede mt-6 text-ink-2">
            Snipers take from whoever quotes. Under each venue: what its liquidity keeps, and what a taker pays for it.
          </p>
          {/* the claim's limits, one tap away from where it is made */}
          <details className="group mt-6 text-sm text-ink-3">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
              What the benchmark covers
              <span aria-hidden className="transition-transform duration-150 group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-2 max-w-md space-y-2 leading-relaxed">
              <p>
                Market hours only. At night there is no later reference: the auction forming is public, as in an
                exchange&apos;s opening cross, and the vault quotes wider and caps what it trades in each auction.
              </p>
              <p>
                Unison&apos;s column is the vault as shipped. Quoting as tight as the book (±{facts.lp.spreadBps}
                &nbsp;bp, a setting no live vault runs yet), it would keep {facts.lp.multiple} times what the
                book&apos;s makers keep, and takers would pay {facts.noiseCostBps.unison}&nbsp;bp.
              </p>
            </div>
          </details>
        </div>

        <FrontRunFigure />
      </div>
    </section>
  );
}
