import { facts, shipped } from "@/lib/content/facts";
import { site } from "@/lib/content/site";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * The research, whole: every venue on the same simulated path, what the latency sniper takes from it, what its
 * liquidity keeps, and what uninformed traders pay. Including the control: Unison with its rule broken.
 */
export function Benchmark() {
  const rows = facts.fairnessTable;
  const maxSniper = Math.max(...rows.map((r) => r.sniper));
  return (
    <section aria-labelledby="bench-title" className="border-t border-line">
      <div className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12 lg:py-28">
        <div className="max-w-3xl">
          <h2 id="bench-title" className="text-display-m text-ink">
            Who pays the latency sniper?
          </h2>
          <p className="text-lede mt-5 text-ink-2">
            Five venues, one price path: {facts.benchmark.blocks.toLocaleString("en-US")} Monad blocks ({facts.benchmark.hours} hours)
            at {facts.benchmark.sigmaPct}% volatility, with {facts.benchmark.jumpsPerDay} news jumps a day. A sniper who sees
            the true price mid-block trades whenever it has an edge. Unison&apos;s rows run the real clearing engine.
          </p>
        </div>

        <div className="mt-12 overflow-x-auto rounded-[var(--radius-xl)] bg-raised shadow-panel">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Per day, on the same simulated path</caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="px-6 py-3.5 font-medium">
                  Venue
                </th>
                <th scope="col" className="px-4 py-3.5 font-medium">
                  The sniper takes, a day
                </th>
                <th scope="col" className="px-4 py-3.5 text-right font-medium">
                  Liquidity keeps
                </th>
                <th scope="col" className="px-4 py-3.5 text-right font-medium">
                  Uninformed traders pay
                </th>
                <th scope="col" className="px-6 py-3.5 text-right font-medium">
                  Sniper fills
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const control = r.key === "stale";
                const us = r.venue === "Unison";
                return (
                  <tr key={r.key} className={control ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklch,var(--ink)_3%,transparent)_6px_12px)]" : undefined}>
                    <th scope="row" className="px-6 py-4 font-normal">
                      <span className={`block font-semibold ${us ? "text-ink" : "text-ink"}`}>{r.venue}</span>
                      <span className="block text-xs text-ink-3">{r.setup}</span>
                    </th>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`tnum w-16 shrink-0 font-semibold ${r.sniper === 0 ? "text-buy" : "text-ink"}`}>{usd(r.sniper)}</span>
                        <span className="h-1.5 flex-1 rounded-full bg-sunken" aria-hidden>
                          <span className={`block h-full rounded-full ${control ? "bg-halt" : "bg-ink/80 night:bg-champagne/80"}`} style={{ width: `${Math.max(r.sniper ? 1.5 : 0, (r.sniper / maxSniper) * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="tnum px-4 py-4 text-right text-ink">{usd(r.lp)}</td>
                    <td className="tnum px-4 py-4 text-right text-ink">{r.noiseBps.toFixed(1)} bp</td>
                    <td className={`tnum px-6 py-4 text-right ${r.sniperFills === 0 ? "font-semibold text-buy" : "text-ink"}`}>{r.sniperFills.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3">
          {[
            ["Sniping doesn't pay.", "In session, the auction prices against a reference published after the batch closed. A mid-batch edge only fills when the price has already moved against it, so the sniper stops trading."],
            ["Liquidity keeps what snipers took.", `At the vault's shipped setting (±10 bp, 3 bp fee) it keeps $${shipped.vault.lp.toLocaleString("en-US")} a day; order-book makers keep $${shipped.clob.lp}. Takers pay for the width: ${shipped.vault.noiseBps.toFixed(1)} bp against ${shipped.clob.noiseBps.toFixed(1)} bp. At an identical ±${facts.lp.spreadBps} bp quote, a setting no live vault runs yet, it would keep ${facts.lp.multiple}× as much ($${facts.lp.unisonVault}) and takers would pay ${facts.noiseCostBps.unison} bp. All of it in market hours.`],
            ["The rule is the mechanism.", "Break it on purpose, pricing against a reference published before the close, and the sniper's edge returns at once. So the venue enforces it on-chain: each reference is bound to its batch, and one published too early is rejected."],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
              <p className="mt-3 leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>

        <details className="group mt-14 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-7">
          <summary className="cursor-pointer list-none text-[15px] font-semibold text-ink outline-none [&::-webkit-details-marker]:hidden">
            Assumptions and limits, stated <span className="ml-1 text-ink-3 transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
            <li>Stylized actors: one sniper with a perfect mid-block feed; order-book makers refresh with one block of latency and races are coin flips.</li>
            <li>The reference relay is modelled with no lag at the batch close. A relay lagging by δ gives back an edge of order σ·√δ, far below a 2 bp spread over tens of milliseconds except during news, where discovery and halt bands cap it.</li>
            <li>Synthetic, independent uninformed flow; no strategic market makers or inventory aversion.</li>
            <li>Live data supersedes this: the tape above is the venue&apos;s real record, and replaces the simulation as it accumulates.</li>
          </ul>
          <a className="mt-5 inline-block text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4" href={`${site.repo}/blob/main/docs/evidence/fairness.md`}>
            The full method
          </a>
        </details>
      </div>
    </section>
  );
}
