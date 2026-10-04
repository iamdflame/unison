"use client";

import NumberFlow from "@number-flow/react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { MARKETS, marketByTicker, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { shallowEqual } from "@/lib/store/createStore";
import { useMarket, useVenue } from "@/lib/venue";
import { useVaultLive, type VaultLive } from "@/lib/venue/vault";
import { QuoteInstrument } from "./QuoteInstrument";

const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const VAULTED = MARKETS.filter((m) => m.vault);

/** /vaults: every market's vault, its quote drawn small, and what it has earned. */
/** The live part of /vaults: the cards. The title and the lede are drawn by the server. */
export function VaultIndex() {
  const v = useVenue();
  return (
    <>
      <p className="mt-2 min-h-5 max-w-3xl text-sm text-ink-3">
        {v.ready && v.mode === "demo" ? "Simulation: quotes from each vault's real parameters, around a simulated reference." : ""}
      </p>
      <ul className="mt-10 grid gap-5 md:grid-cols-2">
        {VAULTED.map((s) => (
          <li key={s.ticker}>
            <VaultCard spec={s} />
          </li>
        ))}
      </ul>
    </>
  );
}

function VaultCard({ spec }: { spec: MarketSpec }) {
  const { value: m } = useMarket(spec.ticker, (s) => ({ refTick: s.refTick, regime: s.regime.name }), shallowEqual, { book: false });
  const vault = useVaultLive(spec);
  const p = spec.vault!;
  const { unit } = priceFormat(spec);
  const nav = vault ? vault.quote + vault.base * m.refTick * unit : null;
  return (
    <Link href={`/vaults/${spec.ticker}`} className="group block rounded-[var(--radius-xl)] bg-raised p-6 shadow-md transition-shadow duration-200 hover-fine:shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[17px] font-semibold text-ink">{spec.ticker} vault</p>
          <p className="text-sm text-ink-3">{spec.name}</p>
        </div>
        <RegimeBadge name={m.regime} />
      </div>
      <div className="mt-4">
        <QuoteInstrument key={m.regime} spec={spec} refTick={m.refTick} regime={m.regime} compact />
      </div>
      {vault && nav !== null ? (
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-ink-3">NAV</dt>
            <dd className="tnum mt-0.5 text-ink">{money(nav, 0)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Spread earned</dt>
            <dd className={`tnum mt-0.5 ${vault.spreadPnl >= 0 ? "text-buy" : "text-sell"}`}>{signed(vault.spreadPnl)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Inventory</dt>
            <dd className={`tnum mt-0.5 ${vault.inventoryPnl >= 0 ? "text-buy" : "text-sell"}`}>{signed(vault.inventoryPnl)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          Quotes {p.spreadBps} bp either side of the reference, ×{p.extMult} in extended hours, ×{p.closedMult} while its
          market is closed.
        </p>
      )}
    </Link>
  );
}

/** /vaults/[ticker]: the vault's quote as an instrument, what it holds and has earned, and how to join it. */
export function VaultDetail({ ticker }: { ticker: string }) {
  const spec = marketByTicker(ticker)!;
  const { value: m } = useMarket(ticker, (s) => ({ refTick: s.refTick, regime: s.regime.name }), shallowEqual, { book: false });
  const vault = useVaultLive(spec);
  const { unit } = priceFormat(spec);
  const p = spec.vault!;
  const px = m.refTick * unit;
  const nav = vault ? vault.quote + vault.base * px : null;
  const weight = vault && nav ? ((vault.base * px) / nav) * 100 : 50;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/vaults" className="press -ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-ink-3 hover-fine:text-ink">
        <ChevronLeft size={15} strokeWidth={1.75} aria-hidden /> Vaults
      </Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-3xl">
          <h1 className="text-display-m text-ink">{spec.ticker} vault</h1>
          <p className="text-lede mt-4 text-ink-2">Always-on liquidity for {spec.name}, priced against the reference every batch.</p>
        </div>
        <RegimeBadge name={m.regime} bandBps={undefined} />
      </header>

      <section aria-labelledby="quote-title" className="mt-8 rounded-[var(--radius-xl)] bg-raised p-6 shadow-md sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="quote-title" className="text-[17px] font-semibold text-ink">
            What it quotes now
          </h2>
          <p className="text-sm text-ink-3">The contract&apos;s own formula. Change the regime or the inventory.</p>
        </div>
        <div className="mt-6">
          <QuoteInstrument key={`${m.regime}-${vault ? "live" : "sim"}`} spec={spec} refTick={m.refTick} regime={m.regime} initialWeight={weight} nav={nav ?? 2_000_000} />
        </div>
        {!vault ? <p className="mt-4 text-xs text-ink-3">Simulated reference; depth drawn for a $2,000,000 vault.</p> : null}
      </section>

      {vault && nav !== null ? <Live vault={vault} nav={nav} px={px} ticker={spec.ticker} /> : null}

      <section aria-labelledby="lp-title" className="mt-6 grid gap-8 rounded-[var(--radius-xl)] bg-raised p-6 shadow-md sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 id="lp-title" className="text-display-m text-ink">
            Joining is a request.
          </h2>
          <p className="mt-4 text-ink-2">
            Deposits and redemptions execute at the first reference published after they were made. No one, LPs
            included, can trade the vault against a price they already know: not a Monday gap, not a halt.
          </p>
          <p className="mt-3 text-ink-2">
            While {spec.kind === "crypto" ? "its reference" : spec.kind === "fx" ? "the currency market" : "Wall Street"} is closed or halted, a {p.swingBps} bp swing fee applies to flows, paid to the LPs who stay.
            Redemptions are paid in kind: your share of the vault&apos;s {spec.ticker} and AUSD.
          </p>
        </div>
        <div>
          <p className="text-sm text-ink-3">From a wallet, with the SDK:</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-sunken p-4 font-mono text-[12.5px] leading-relaxed text-ink">{`import { UnisonClient } from "@unison/sdk";

// approve AUSD, then request; it executes at the next reference
await client.requestDeposit(vault, 1_000_000_000n); // 1,000 AUSD

// later: redeem shares for base + quote, in kind
await client.requestRedeem(vault, shares);`}</pre>
          <p className="mt-3 text-xs text-ink-3">Passkey accounts trade through signed messages and have no wallet key, so joining a vault needs a wallet.</p>
        </div>
      </section>
    </div>
  );
}

function Live({ vault, nav, px, ticker }: { vault: VaultLive; nav: number; px: number; ticker: string }) {
  const sharePrice = vault.supply > 0 ? nav / vault.supply : 0;
  const total = Math.abs(vault.spreadPnl) + Math.abs(vault.inventoryPnl) || 1;
  return (
    <>
      <section aria-label="Vault now" className="mt-6 grid gap-6 rounded-[var(--radius-xl)] bg-raised p-6 shadow-md sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <p className="text-sm text-ink-3">Net asset value at the reference</p>
          <p className="numerals mt-2 text-[clamp(2.25rem,5vw,3.5rem)] leading-none text-ink">
            <NumberFlow value={nav} locales="en-US" format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }} />
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-ink-3">Share price</dt>
              <dd className="tnum mt-0.5 text-ink">${sharePrice.toFixed(4)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Inventory</dt>
              <dd className="tnum mt-0.5 text-ink">
                {vault.base.toLocaleString("en-US", { maximumFractionDigits: 2 })} {ticker} · {money(vault.quote, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Auctions traded</dt>
              <dd className="tnum mt-0.5 text-ink">{vault.auctionsTraded.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Volume</dt>
              <dd className="tnum mt-0.5 text-ink">
                {vault.tradedBase.toLocaleString("en-US", { maximumFractionDigits: 2 })} {ticker} · {money(vault.tradedBase * px, 0)}
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="text-sm text-ink-3">Where its P&amp;L came from, on-chain</p>
          <div className="mt-4 space-y-4">
            {[
              ["Spread", "What every auction paid it to be there: fill price against the reference.", vault.spreadPnl],
              ["Inventory", "What its holdings did as the reference moved.", vault.inventoryPnl],
            ].map(([label, what, value]) => (
              <div key={label as string}>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-[15px] font-semibold text-ink">{label}</p>
                  <p className={`tnum text-[15px] font-semibold ${(value as number) >= 0 ? "text-buy" : "text-sell"}`}>{signed(value as number)}</p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <div className={`h-full rounded-full ${(value as number) >= 0 ? "bg-buy" : "bg-sell"}`} style={{ width: `${(Math.abs(value as number) / total) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-ink-3">{what}</p>
              </div>
            ))}
          </div>
          {vault.pending > 0 ? <p className="mt-5 text-sm text-ink-2">{vault.pending} LP request{vault.pending === 1 ? "" : "s"} waiting for the next reference.</p> : null}
        </div>
      </section>

      {vault.flows.length ? (
        <section aria-labelledby="flows-title" className="mt-6 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-md">
          <h2 id="flows-title" className="px-6 pt-5 pb-3 text-[15px] font-semibold text-ink">
            LP requests
          </h2>
          <ul className="divide-y divide-line border-t border-line">
            {vault.flows.slice(0, 12).map((f) => (
              <li key={`${f.kind}-${f.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 text-sm">
                <span className="w-20 font-semibold text-ink">{f.kind === "deposit" ? "Deposit" : "Redeem"}</span>
                <span className="tnum min-w-0 truncate text-ink">
                  {f.kind === "deposit" ? money(Number(BigInt(f.amount)) / 1e6, 0) : `${(Number(BigInt(f.amount)) / 1e12).toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`}
                  <span className="ml-2 font-mono text-xs text-ink-3">
                    {f.owner.slice(0, 6)}…{f.owner.slice(-4)}
                  </span>
                </span>
                <span className="text-ink-3">{f.executed ? "Executed at the next reference" : "Waiting for the next reference"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export const vaultTickers = VAULTED.map((m) => m.ticker);
