import { facts } from "@/lib/content/facts";
import { site } from "@/lib/content/site";
import { AuditedFigure } from "./AuditedFigure";

/**
 * Chapter 4: watched by Chainlink. The words are rendered on the server; only the stepped instrument beside them
 * (AuditedFigure) runs in the browser.
 */
export function Audited() {
  return (
    <section aria-labelledby="audited-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          {/* honest about today: the sentinel reads mainnet from Chainlink's CRE simulator, not yet a live network */}
          <h2 id="audited-title" className="text-display-l text-ink">
            A second opinion, every&nbsp;{facts.sentinel.everySec}&nbsp;seconds.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Unison&apos;s prices are Chainlink&apos;s own observations. A second Chainlink workflow watches them from
            outside: every {facts.sentinel.everySec} seconds, independent nodes price MON from Coinbase and Kraken and
            agree on a median. If the feed is more than {(facts.sentinel.haltAboveBps / 100).toFixed(2)}% off and has been
            silent for {facts.sentinel.silentSec / 60} minutes, trading halts. A gap alone is not enough: while a new price
            is in flight, the feed trails the market by design.
          </p>
          <p className="mt-6 text-sm text-ink-3">
            It runs in Chainlink&apos;s CRE simulator today, reading Monad mainnet, and moves to a live network once access
            is granted. Halts on the primary market are mirrored within a minute.{" "}
            <a className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink" href={`${site.repo}/tree/main/cre/unison`}>
              The workflows
            </a>
          </p>
        </div>
        <AuditedFigure />
      </div>
    </section>
  );
}
