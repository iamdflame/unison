"use client";

import NumberFlow from "@number-flow/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { MARKETS, marketByTicker, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { shallowEqual } from "@/lib/store/createStore";
import { statusOfRegime, vaultCurve } from "@/lib/unison/vaultCurve";
import { useMarket, useVenue } from "@/lib/venue";
import { useVaultView, type VaultLive } from "@/lib/venue/vault";
import { QuoteInstrument } from "./QuoteInstrument";

const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const VAULTED = MARKETS.filter((m) => m.vault);
const E18 = 10n ** 18n;
/** The NAV the simulation draws each vault's depth for, half in the stock and half in AUSD. */
const SIM_NAV = 2_000_000;
/** One scale for every vault's quote, ±1% of its reference, so a tighter vault always looks tighter. */
const AXIS_BP = 100;
const at = (bp: number) => Math.min(100, Math.max(0, 50 + (bp / AXIS_BP) * 50));
// one layout, live or simulated: the simulation keeps each vault's books too
const COLS = "md:grid-cols-[minmax(0,1fr)_minmax(220px,1.5fr)_112px_112px_112px_112px_16px]";

/** The live part of /vaults: every vault on one board. The title and the lede are drawn by the server. */
export function VaultIndex() {
  const v = useVenue();
  const cols = COLS;
  return (
    <>
      <p className="mt-2 min-h-5 max-w-3xl text-sm text-ink-3">
        {v.ready && v.mode === "demo" ? `Simulation: each vault's real parameters, starting at ${money(SIM_NAV, 0)}, trading on the simulated market since this page opened.` : ""}
      </p>
      <div className="mt-8 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
        <div className={`hidden items-end gap-x-5 border-b border-line px-6 pt-4 pb-3 text-xs text-ink-3 md:grid ${cols}`} aria-hidden>
          <span>Vault</span>
          <span>
            <span className="block">Its quotes now, one scale for every vault</span>
            <span className="tnum mt-1.5 flex justify-between text-[11px]">
              <span>−1%</span>
              <span>reference</span>
              <span>+1%</span>
            </span>
          </span>
          <span className="text-right">Half-spread</span>
          <span className="text-right">Each side</span>
          <span className="text-right">Value</span>
          <span className="text-right">Spread earned</span>
          <span />
        </div>
        <ul className="divide-y divide-line">
          {VAULTED.map((s) => (
            <li key={s.ticker}>
              <VaultRow spec={s} cols={cols} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * One vault: where its bids and asks sit around the reference (the contract's own curve, for its real inventory or a
 * balanced simulated one), how wide that is in basis points and dollars, and how much it offers on each side.
 */
function VaultRow({ spec, cols }: { spec: MarketSpec; cols: string }) {
  const { value: m } = useMarket(spec.ticker, (s) => ({ refTick: s.refTick, regime: s.regime.name }), shallowEqual, { book: false });
  const vault = useVaultView(spec);
  const p = spec.vault!;
  const { unit, decimals } = priceFormat(spec);
  const ref = m.refTick;
  const px = ref * unit;
  const status = statusOfRegime(m.regime);
  const refPrice = BigInt(ref) * spec.tickSize;
  const simQuote = BigInt(SIM_NAV * 1e6) / 2n;
  const q = vaultCurve(p, {
    refPrice,
    refTick: ref,
    status,
    baseBalance: vault ? vault.baseBalance : refPrice > 0n ? (simQuote * E18) / refPrice : 0n,
    quoteBalance: vault ? vault.quoteBalance : simQuote,
    baseUnit: E18,
  });
  const quoting = ref > 0 && q.bidTicks + q.askTicks > 0;
  const bp = (ticks: number) => (ref > 0 ? (ticks / ref) * 10_000 : 0);
  const halfBp = bp(q.half);
  const side = (Number(q.perTick) / 1e18) * px * p.widthTicks;
  const nav = vault ? vault.quote + vault.base * px : null;
  // the multiplier said as arithmetic on the in-session spread, so 40 bp never reads as 40 × 4
  const regimeNote = status === "EXTENDED" ? `${p.extMult} × ${p.spreadBps} bp, extended hours` : status === "CLOSED" ? `${p.closedMult} × ${p.spreadBps} bp, while closed` : "";

  return (
    <Link
      href={`/vaults/${spec.ticker}`}
      className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 py-4 transition-colors duration-150 outline-none hover-fine:bg-ink/[0.03] focus-visible:bg-ink/[0.04] md:px-6 ${cols}`}
      aria-label={
        quoting
          ? `${spec.ticker} vault: quotes ${halfBp.toFixed(0)} basis points either side of the reference, ${money(side, 0)} on each side.`
          : `${spec.ticker} vault: no quotes while its market is halted.`
      }
    >
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">{spec.ticker} vault</p>
        <p className="truncate text-[13px] text-ink-3">{spec.name}</p>
      </div>

      <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
        {quoting ? (
          <QuoteGauge bid={bp(q.bidTop - ref)} ask={bp(q.askBottom - ref)} width={bp(p.widthTicks)} />
        ) : (
          <p className="text-sm text-halt">No quotes while its market is halted</p>
        )}
      </div>

      <div className="col-start-2 row-start-1 text-right md:col-start-auto md:row-start-auto">
        <p className="figures text-[15px] font-semibold text-ink">{quoting ? `${halfBp.toFixed(0)} bp` : "None"}</p>
        <p className="figures text-[12px] text-ink-3">
          {quoting ? `$${(q.half * unit).toFixed(decimals)}` : ""}
          {quoting && regimeNote ? ` · ${regimeNote}` : ""}
        </p>
      </div>

      {nav !== null && vault ? (
        <>
          <div className="hidden text-right md:block">
            <p className="tnum text-[15px] text-ink">{quoting ? money(side, 0) : "None"}</p>
            <p className="figures text-[12px] text-ink-3">over {p.widthTicks} ticks</p>
          </div>
          <p className="tnum hidden text-right text-[15px] text-ink md:block">{money(nav, 0)}</p>
          <p className={`tnum hidden text-right text-[15px] md:block ${vault.spreadPnl >= 0 ? "text-buy" : "text-sell"}`}>{signed(vault.spreadPnl)}</p>
        </>
      ) : null}

      {/* phones: what the wide columns say, in one line */}
      {vault && nav !== null ? (
        <p className="figures col-span-2 -mt-1 text-[12px] text-ink-3 md:hidden">
          {quoting ? `${money(side, 0)} each side · ` : ""}value {money(nav, 0)} · spread earned {signed(vault.spreadPnl)}
        </p>
      ) : null}

      <ChevronRight size={16} strokeWidth={1.75} aria-hidden className="hidden text-ink-3 transition-colors group-hover:text-ink md:block" />
    </Link>
  );
}

/**
 * Bids and asks as two blocks either side of the reference, on the board's shared ±1% scale. Each block spans the
 * ticks the vault quotes; the gap between them is the spread a trader crosses.
 */
function QuoteGauge({ bid, ask, width }: { bid: number; ask: number; width: number }) {
  const block = (from: number, to: number, color: string) => (
    <div className="absolute inset-0 transition-transform duration-[460ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ transform: `translateX(${at(from)}%)` }}>
      <div className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-[2px] ${color}`} style={{ width: `max(3px, ${at(to) - at(from)}%)` }} />
    </div>
  );
  return (
    <div className="relative h-7 overflow-hidden" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
      {[-50, 50].map((b) => (
        <div key={b} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${at(b)}%` }} />
      ))}
      {block(bid - width, bid, "bg-buy")}
      {block(ask, ask + width, "bg-sell")}
      <div className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-champagne" />
    </div>
  );
}

/** /vaults/[ticker]: the vault's quote as an instrument, what it holds and has earned, and how to join it. */
export function VaultDetail({ ticker }: { ticker: string }) {
  const spec = marketByTicker(ticker)!;
  const { value: m } = useMarket(ticker, (s) => ({ refTick: s.refTick, regime: s.regime.name }), shallowEqual, { book: false });
  const vault = useVaultView(spec);
  const { unit } = priceFormat(spec);
  const p = spec.vault!;
  const px = m.refTick * unit;
  const nav = vault ? vault.quote + vault.base * px : null;
  const weight = vault && nav ? ((vault.base * px) / nav) * 100 : 50;

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12 [&>*]:max-w-[1200px]">
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

      <section aria-labelledby="quote-title" className="mt-8 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="quote-title" className="text-[17px] font-semibold text-ink">
            What it quotes now
          </h2>
          <p className="text-sm text-ink-3">The contract&apos;s own formula. Change the regime or the inventory.</p>
        </div>
        <div className="mt-6">
          <QuoteInstrument key={`${m.regime}-${vault ? "live" : "sim"}`} spec={spec} refTick={m.refTick} regime={m.regime} initialWeight={weight} nav={nav ?? 2_000_000} />
        </div>
        {vault?.address === "simulation" ? (
          <p className="mt-4 text-xs text-ink-3">Simulation: this vault&apos;s own books, starting at $2,000,000, on the simulated market.</p>
        ) : !vault ? (
          <p className="mt-4 text-xs text-ink-3">Simulated reference; depth drawn for a $2,000,000 vault.</p>
        ) : null}
      </section>

      {vault && nav !== null ? <Live vault={vault} nav={nav} px={px} ticker={spec.ticker} /> : null}

      <section aria-labelledby="lp-title" className="mt-6 grid gap-8 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
      <section aria-label="Vault now" className="mt-6 grid gap-6 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
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
          <p className="text-sm text-ink-3">Where its P&amp;L came from, {vault.address === "simulation" ? "in the simulation" : "on-chain"}</p>
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
        <section aria-labelledby="flows-title" className="mt-6 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
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
