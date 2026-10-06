"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import NumberFlow from "@number-flow/react";
import { X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { useMarket, useVenue, useVenueAccount } from "@/lib/venue";
import { priceFormat } from "@/lib/content/markets";
import type { MyFill, MyOrder } from "@/lib/demo/engine";
import { certificate, certificateFor } from "./certificateStore";
import { OrderTicket } from "./OrderTicket";
import { clearBatch } from "@/lib/sim/batch";
import { AuctionBar } from "./AuctionBar";
import { CrossChart, crossWindow, DepthLadder, PrintsChart, refName } from "./charts";
import { MarketFacts } from "./MarketFacts";
import { useSize } from "./useSize";
import { TradeSkeleton } from "./TradeSkeleton";

/**
 * The trading terminal. One market: its price (engraved), regime and band, the batch now forming, and you.
 * Desktop: chart column + ticket column + activity. Mobile: the same, stacked, ticket last.
 */
export function TradeView({ ticker }: { ticker: string }) {
  const { market, value: m, spec, live } = useMarket(ticker, (s) => s);
  const { unit, decimals, fmt } = priceFormat(spec);
  const last = m.last ?? null;
  // The last print against the reference it cleared on: the venue's own measure of where it traded.
  const devBps = last && last.refTick > 0 ? ((last.tick - last.refTick) / last.refTick) * 10_000 : null;
  const held = useVenueAccount((a) => (a.base[ticker] ?? 0) + (a.lockedBase[ticker] ?? 0));
  // The batch now forming, cleared as it stands: the price it would print, and which side is heavier there.
  const indicative = useMemo(() => {
    const all = [...m.book, ...m.vault];
    const out = clearBatch(all, { lo: m.lo, hi: m.hi, refTick: m.refTick });
    if (!out.traded) return null;
    let bid = 0;
    let ask = 0;
    for (const o of all) {
      if (o.side === "buy" && o.tick >= out.tick) bid += o.qty;
      if (o.side === "sell" && o.tick <= out.tick) ask += o.qty;
    }
    return { tick: out.tick, volume: out.volume, imbalance: bid - ask };
  }, [m.book, m.vault, m.refTick, m.lo, m.hi]);
  const [view, setView] = useState<string>("cross");
  const v = useVenue();
  // Phones and tablets: the ticket opens as a sheet from the thumb bar; `sheet` keeps it drawn while it closes.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheet, setSheet] = useState<{ side: "buy" | "sell"; n: number }>({ side: "buy", n: 0 });
  const openSheet = (side: "buy" | "sell") => {
    setSheet((l) => ({ side, n: l.n + 1 }));
    setSheetOpen(true);
  };

  // A live market starts from its listing's seed price; until the tape's first answer it has no real one to show,
  // and on a real-money market a stale price is worse than none.
  if (live && m.block === 0) return <TradeSkeleton />;

  return (
    <div className="mx-auto max-w-[1680px] px-4 pt-5 pb-[calc(10rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:py-7">
      {/* Desktop: the ticket owns the right column from the top, so its button is on screen without scrolling. */}
      <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <header data-tour="price" className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              {/* on a phone the name takes its own line under the ticker, never a ragged second column */}
              <h1 className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-2xl font-semibold tracking-tight text-ink">{spec.ticker}</span>
                <span className="text-sm text-ink-3">
                  {spec.name} · <span className="sm:hidden">in AUSD</span>
                  <span className="hidden sm:inline">quoted in AUSD, a dollar stablecoin</span>
                </span>
              </h1>
              {/* the headline figure is named: it is the last auction's price, not a live quote */}
              <p className="mt-2 text-xs text-ink-3">Last trade</p>
              <div className="flex items-baseline gap-4">
                <span className="numerals text-[clamp(2.25rem,4vw,3.25rem)] leading-none text-ink">
                  <NumberFlow
                    value={last ? last.tick * unit : Number(spec.seedPrice) / 1e6}
                    locales="en-US"
                    format={{
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: decimals,
                      maximumFractionDigits: decimals,
                    }}
                    // settle inside one 300 ms beat, so the price is still between prints
                    transformTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                    spinTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                    opacityTiming={{ duration: 160, easing: "ease-out" }}
                  />
                </span>
                {devBps !== null ? (
                  <span
                    className="figures text-sm text-ink-2"
                    title="The last trade against the price its band was centred on"
                  >
                    {devBps >= 0 ? "+" : "−"}
                    {(Math.abs(devBps) / 100).toFixed(2)}% vs {refName(m).toLowerCase()}
                  </span>
                ) : null}
              </div>
            </div>
            <dl className="grid grid-cols-2 items-start gap-x-6 gap-y-3 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-y-2">
              <div>
                <dt className="text-xs text-ink-3">{refName(m)}</dt>
                <dd className="tnum text-ink">{fmt(m.refTick)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Band</dt>
                <dd className="tnum text-ink">
                  {fmt(m.lo)} – {fmt(m.hi)}
                </dd>
              </div>
              <div data-tour="regime">
                <dt className="text-xs text-ink-3">Regime</dt>
                <dd>
                  <RegimeBadge name={m.regime.name} bandBps={m.regime.bandBps} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">You hold</dt>
                <dd className="figures text-ink">
                  {held.toLocaleString("en-US", { maximumFractionDigits: 2 })} {spec.ticker}
                  {/* valued as the portfolio values it: at the reference (at night, the last close) */}
                  {held > 0 && m.refTick > 0 ? (
                    <span className="whitespace-nowrap text-ink-3">
                      {" "}
                      · ${(held * m.refTick * unit).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      <span className="sm:hidden"> at close</span>
                      <span className="hidden sm:inline"> at {refName(m).toLowerCase()}</span>
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </header>

          <AuctionBar m={m} fmt={fmt} indicative={indicative} />

          <div className="mt-5 flex min-w-0 flex-col gap-5">
            <Tabs.Root
              data-tour="chart"
              value={view}
              onValueChange={(v) => setView(String(v))}
              className="rounded-[var(--radius-xl)] bg-raised shadow-panel"
            >
              <div className="flex items-center justify-between border-b border-line px-3 pt-3">
                <Tabs.List className="relative flex gap-1" aria-label="Chart">
                  {[
                    ["cross", "Batch"],
                    ["prints", "Prints"],
                    ["depth", "Depth"],
                  ].map(([v, label]) => (
                    <Tabs.Tab
                      key={v}
                      value={v}
                      className="rounded-t-xl px-4 pt-2 pb-3 text-sm font-medium text-ink-3 outline-none transition-colors data-[active]:text-ink hover-fine:text-ink focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {label}
                    </Tabs.Tab>
                  ))}
                  <Tabs.Indicator className="absolute bottom-0 left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] rounded-full bg-ink transition-[left,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]" />
                </Tabs.List>
                <p className="hidden pr-2 pb-3 text-xs text-ink-3 sm:block" aria-live="off">
                  {view === "cross" ? (
                    "The batch now forming: everyone's limits, and where they meet."
                  ) : view === "prints" ? (
                    "Every print against the reference (dashed)."
                  ) : (
                    "Resting liquidity. Tap a level to use its price."
                  )}
                </p>
              </div>
              <Tabs.Panel value="cross" className="flex h-[clamp(300px,32vw,420px)] w-full flex-col p-2">
                <div className="min-h-0 flex-1">
                  <Measured>{(w, h) => <CrossChart m={m} fmt={fmt} cross={indicative} w={w} h={h} />}</Measured>
                </div>
                {/* the key: only what is on the chart, each with its own mark */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 pt-1 pb-2 text-xs text-ink-3">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-0.5 w-4 rounded bg-buy" /> Buyers at or above each price
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-0.5 w-4 rounded bg-sell" /> Sellers at or below
                  </span>
                  {indicative ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="size-2 rounded-full bg-accent" /> Clears now
                    </span>
                  ) : null}
                  {m.last ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="size-2 rounded-full ring-[1.5px] ring-ink-2" /> Last trade
                    </span>
                  ) : null}
                  {m.refTick >= crossWindow(m).lo && m.refTick <= crossWindow(m).hi ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden>▲</span> {refName(m)}
                    </span>
                  ) : null}
                  {!live ? <span>Quantities in {spec.ticker}, the vault&apos;s quotes included</span> : <span>Quantities in {spec.ticker}</span>}
                </div>
              </Tabs.Panel>
              <Tabs.Panel value="prints" className="h-[clamp(250px,42vw,440px)] w-full p-2">
                <Measured>{(w, h) => <PrintsChart m={m} fmt={fmt} w={w} h={h} />}</Measured>
              </Tabs.Panel>
              <Tabs.Panel value="depth" className="min-h-[420px] w-full">
                <DepthLadder m={m} fmt={fmt} />
              </Tabs.Panel>
            </Tabs.Root>
            <Activity
              ticker={ticker}
              fmt={fmt}
              decimals={decimals}
              onCancel={(id) => void market.cancel(id)}
              sealed={!!m.causal}
              onCertificate={(f) => certificate.set(certificateFor(f, spec, live ? v.net : null))}
            />
            <MarketFacts m={m} />
          </div>
        </div>
        <div className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <OrderTicket key={ticker} ticker={ticker} />
        </div>
      </div>

      {/* Under the thumb on phones and tablets: docked on the tab bar, solid, so it never floats over the chart;
          buy or sell opens the ticket as a sheet. */}
      <div data-tour="thumb" className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg px-4 py-2.5 sm:bottom-0 sm:pb-[calc(0.625rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-md gap-2">
          <button
            type="button"
            onClick={() => openSheet("buy")}
            className="press flex-1 rounded-[var(--radius-sm)] bg-buy-fill py-3 text-[15px] font-semibold text-on-fill"
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => openSheet("sell")}
            className="press flex-1 rounded-[var(--radius-sm)] bg-sell-fill py-3 text-[15px] font-semibold text-on-fill"
          >
            Sell
          </button>
        </div>
      </div>
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px] transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-[81] mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-[var(--radius-2xl)] bg-raised pb-[env(safe-area-inset-bottom)] shadow-lg outline-none transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:translate-y-full data-[ending-style]:duration-[240ms] data-[starting-style]:translate-y-full">
            <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
            <Dialog.Title className="sr-only">
              {sheet.side === "buy" ? "Buy" : "Sell"} {spec.ticker}
            </Dialog.Title>
            <div className="px-2 pb-2 [&>section]:shadow-none">
              <OrderTicket
                key={sheet.n}
                ticker={ticker}
                defaultSide={sheet.side}
                onPlaced={() => setSheetOpen(false)}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** Measures its box and draws its child at that exact size. */
function Measured({ children }: { children: (w: number, h: number) => ReactNode }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className="h-full w-full">
      {size.width > 0 ? children(size.width, size.height) : null}
    </div>
  );
}

/** Shares: a fraction of one to four places (a real-money beta trades hundredths), whole sizes to two. */
const shares = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2 });

const STATUS_LABEL: Record<MyOrder["status"], string> = {
  pending: "In batch",
  open: "Resting",
  partial: "Partly filled",
  filled: "Filled",
  cancelled: "Cancelled",
  expired: "Expired",
};

function Activity({
  ticker,
  fmt,
  decimals,
  onCancel,
  onCertificate,
  sealed = false,
}: {
  ticker: string;
  fmt: (t: number) => string;
  decimals: number;
  onCancel: (id: number) => void;
  /** a causal market: an order waiting for its auction can't be cancelled (SPEC §7.4) */
  sealed?: boolean;
  onCertificate: (f: MyFill) => void;
}) {
  const ordersOrNull = useVenueAccount((a) => a.orders[ticker] ?? null);
  const orders = useMemo(() => ordersOrNull ?? [], [ordersOrNull]);
  const fills = useVenueAccount((a) => a.fills);
  const mine = useMemo(() => fills.filter((f) => f.ticker === ticker).slice(0, 12), [fills, ticker]);
  const [tab, setTab] = useState<string>("orders");
  const live = orders.filter((o) => o.status === "pending" || o.status === "open" || o.status === "partial");
  return (
    <Tabs.Root
      data-tour="activity"
      value={tab}
      onValueChange={(v) => setTab(String(v))}
      className="rounded-[var(--radius-xl)] bg-raised shadow-panel"
    >
      <Tabs.List className="flex gap-1 border-b border-line px-3 pt-3" aria-label="Activity">
        <Tabs.Tab value="orders" className="px-3 pb-3 text-sm font-medium text-ink-3 data-[active]:text-ink">
          Your orders{" "}
          {live.length ? (
            <span className="tnum ml-1 rounded-full bg-ink/[0.07] px-1.5 text-xs">{live.length}</span>
          ) : null}
        </Tabs.Tab>
        <Tabs.Tab value="fills" className="px-3 pb-3 text-sm font-medium text-ink-3 data-[active]:text-ink">
          Fills
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="orders">
        {orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">
            No orders yet. Your first one joins the next auction.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.slice(0, 10).map((o) => (
              <li key={o.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3 text-sm">
                <span className={`font-semibold ${o.side === "buy" ? "text-buy" : "text-sell"}`}>
                  {o.side === "buy" ? "Buy" : "Sell"}
                </span>
                <span className="tnum text-ink">
                  {shares(o.filled)} / {o.qty} at {o.side === "buy" ? "≤" : "≥"} {fmt(o.tick)}
                  <span className="ml-3 text-ink-3">
                    {o.settling ? "Filling…" : sealed && o.status === "pending" ? "Sealed · waits for Chainlink" : STATUS_LABEL[o.status]}
                  </span>
                  {o.filled > 0 ? (
                    <span className="ml-3 text-ink-2">avg ${(o.quote / o.filled).toFixed(decimals)}</span>
                  ) : null}
                </span>
                {(o.status === "open" || o.status === "pending" || o.status === "partial") && !(sealed && o.status === "pending") ? (
                  <button
                    type="button"
                    onClick={() => onCancel(o.id)}
                    aria-label="Cancel order"
                    className="press grid size-8 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06] hover-fine:text-ink"
                  >
                    <X size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </Tabs.Panel>
      <Tabs.Panel value="fills">
        {mine.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">
            Fills appear here, each at its batch&apos;s one price.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((f) => (
              <li key={`${f.orderId}-${f.block}`}>
                <button
                  type="button"
                  onClick={() => onCertificate(f)}
                  className="grid w-full grid-cols-[auto_1fr_auto] gap-4 px-5 py-3 text-left text-sm transition-colors hover-fine:bg-ink/[0.03]"
                  aria-label={`Certificate for ${f.side === "buy" ? "buying" : "selling"} ${shares(f.qty)} at ${fmt(f.tick)}`}
                >
                  <span className={`font-semibold ${f.side === "buy" ? "text-buy" : "text-sell"}`}>
                    {f.side === "buy" ? "Bought" : "Sold"}
                  </span>
                  <span className="tnum text-ink">
                    {shares(f.qty)} at {fmt(f.tick)}{" "}
                    <span className="text-ink-3">
                      · block {f.block.toLocaleString("en-US")} ·{" "}
                      {f.participants > 0 ? `${f.participants} orders` : `${f.batchVolume.toFixed(2)} ${ticker} traded`}
                      , one price
                    </span>
                  </span>
                  <span className="tnum text-ink-3">
                    {new Date(f.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
