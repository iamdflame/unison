import { facts } from "@/lib/content/facts";
import { BlockStrip } from "./BlockStrip";

/**
 * Chapter 8: only possible on Monad. Three instruments, no stat row: a strip of blocks advancing one cell per beat
 * (BlockStrip, the only part that runs in the browser), the gas a clear costs against a ghost of the same clear under
 * Ethereum's rules, and what a batch costs.
 */
export function OnlyOnMonad() {
  const monad = facts.gas.clearMonad / facts.gas.clearEthereumRules;

  return (
    <section aria-labelledby="monad-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="monad-title" className="text-display-l text-ink">
            Made for Monad.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Sealing orders every 300 milliseconds, and running an auction for every new price, needs a chain that
            keeps that beat and storage priced by the page. Unison lays out its book page by page, so clearing costs {facts.gas.savingPct}% less gas under Monad&apos;s rules
            than the same code under Ethereum&apos;s.
          </p>
        </div>
        <div className="flex flex-col gap-12 lg:col-span-7">
          <BlockStrip />

          <figure>
            <div className="space-y-3">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink">Clear on Monad</span>
                  <span className="figures text-ink">{facts.gas.clearMonad.toLocaleString("en-US")} gas</span>
                </div>
                <div className="mt-2 h-1.5 rounded-[1px] bg-sunken">
                  <div className="h-full rounded-[1px] bg-ink" style={{ width: `${monad * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-3">Same clear, Ethereum&apos;s rules</span>
                  <span className="figures text-ink-3">{facts.gas.clearEthereumRules.toLocaleString("en-US")} gas</span>
                </div>
                {/* filled, in a pale ink: the larger figure must never read as nothing */}
                <div className="mt-2 h-1.5 rounded-[1px] bg-ink/25" />
              </div>
            </div>
            <figcaption className="mt-4 text-sm text-ink-3">Measured with the same contracts on both EVMs.</figcaption>
          </figure>

          <figure className="grid grid-cols-2 gap-6 border-t border-line pt-8">
            <div>
              <p className="numerals text-[clamp(2rem,4vw,3.5rem)] leading-none text-ink">
                ${facts.gas.batch200Usd}
              </p>
              <p className="mt-3 text-sm text-ink-3">to clear a 200-order batch</p>
            </div>
            <div>
              <p className="numerals text-[clamp(2rem,4vw,3.5rem)] leading-none text-ink">
                ${facts.gas.orderUsd}
              </p>
              <p className="mt-3 text-sm text-ink-3">to place an order</p>
            </div>
            {/* every figure with its basis */}
            <figcaption className="col-span-2 text-xs leading-relaxed text-ink-3">
              At Monad&apos;s {facts.gas.baseFeeGwei} gwei minimum base fee and MON at ${facts.gas.monUsd}. Blocks measured at
              293–304 ms in October 2026; every 300 ms figure on this site rests on that.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
