"use client";

import { Tabs } from "@base-ui/react/tabs";
import NumberFlow from "@number-flow/react";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { BatchRing } from "@/components/app/BatchRing";
import { useMarket, useVenue, useVenueAccount } from "@/lib/venue";
import { priceFormat } from "@/lib/content/markets";
import type { MyFill, MyOrder } from "@/lib/demo/engine";
import { certificate, certificateFor } from "./Certificate";
import { OrderTicket } from "./OrderTicket";
import { CrossChart, DepthLadder, PrintsChart } from "./charts";

/**
 * The trading terminal. One market: its price (engraved), regime and band, the batch now forming, and you.
 * Desktop: chart column + ticket column + activity. Mobile: the same, stacked, ticket last.
 */
export function TradeView({ ticker }: { ticker: string }) {
  const { market, value: m, spec, live } = useMarket(ticker, (s) => s);
  const { unit, decimals, fmt } = priceFormat(spec);
  const last = m.last ?? null;
  const open = m.prints.length > 120 ? m.prints[m.prints.length - 120]! : m.prints[0];
  const change = last && open ? ((last.tick - open.tick) / open.tick) * 100 : 0;
  const [view, setView] = useState<string>("cross");
  const v = useVenue();

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:py-7">
      <header className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <h1 className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tracking-tight text-ink">{spec.ticker}</span>
            <span className="text-sm text-ink-3">{spec.name} · quoted in AUSD</span>
          </h1>
          <div className="mt-2 flex items-baseline gap-4">
            <span className="numerals text-[clamp(2.25rem,4vw,3.25rem)] leading-none text-ink">
              <NumberFlow
                value={last ? last.tick * unit : (Number(spec.seedPrice) / 1e6)}
                locales="en-US"
                format={{ style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
                // settle inside one 300 ms beat, so the price is still between prints
                transformTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                spinTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                opacityTiming={{ duration: 160, easing: "ease-out" }}
              />
            </span>
            <span className={`tnum text-sm font-semibold ${change >= 0 ? "text-buy" : "text-sell"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
            </span>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-ink-3">Reference</dt>
            <dd className="tnum text-ink">{fmt(m.refTick)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Band</dt>
            <dd className="tnum text-ink">
              {fmt(m.lo)} – {fmt(m.hi)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Regime</dt>
            <dd>
              <RegimeBadge name={m.regime.name} bandBps={m.regime.bandBps} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <BatchRing size={26} block={m.block} />
            <div>
              <dt className="text-xs text-ink-3">Batch</dt>
              <dd className="tnum text-ink">{m.block.toLocaleString("en-US")}</dd>
            </div>
          </div>
        </dl>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Tabs.Root value={view} onValueChange={(v) => setView(String(v))} className="rounded-[var(--radius-xl)] bg-raised shadow-md">
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
              <p className="hidden pr-2 pb-3 text-xs text-ink-3 sm:block">
                {view === "cross" ? "Buyers and sellers, by limit. The ball is the last price." : view === "prints" ? "Every print against the reference (dashed)." : "Resting liquidity. Tap a level to use its price."}
              </p>
            </div>
            <Tabs.Panel value="cross" className="aspect-[900/420] w-full p-2">
              <CrossChart m={m} fmt={fmt} live={live} />
            </Tabs.Panel>
            <Tabs.Panel value="prints" className="aspect-[900/420] w-full p-2">
              <PrintsChart m={m} fmt={fmt} />
            </Tabs.Panel>
            <Tabs.Panel value="depth" className="min-h-[420px] w-full">
              <DepthLadder m={m} fmt={fmt} live={live} />
            </Tabs.Panel>
          </Tabs.Root>
          <Activity
            ticker={ticker}
            fmt={fmt}
            decimals={decimals}
            onCancel={(id) => void market.cancel(id)}
            onCertificate={(f) => certificate.set(certificateFor(f, spec, live ? v.net : null))}
          />
        </div>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <OrderTicket ticker={ticker} />
        </div>
      </div>
    </div>
  );
}

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
}: {
  ticker: string;
  fmt: (t: number) => string;
  decimals: number;
  onCancel: (id: number) => void;
  onCertificate: (f: MyFill) => void;
}) {
  const ordersOrNull = useVenueAccount((a) => a.orders[ticker] ?? null);
  const orders = useMemo(() => ordersOrNull ?? [], [ordersOrNull]);
  const fills = useVenueAccount((a) => a.fills);
  const mine = useMemo(() => fills.filter((f) => f.ticker === ticker).slice(0, 12), [fills, ticker]);
  const [tab, setTab] = useState<string>("orders");
  const live = orders.filter((o) => o.status === "pending" || o.status === "open" || o.status === "partial");
  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(String(v))} className="rounded-[var(--radius-xl)] bg-raised shadow-sm">
      <Tabs.List className="flex gap-1 border-b border-line px-3 pt-3" aria-label="Activity">
        <Tabs.Tab value="orders" className="px-3 pb-3 text-sm font-medium text-ink-3 data-[active]:text-ink">
          Your orders {live.length ? <span className="tnum ml-1 rounded-full bg-ink/[0.07] px-1.5 text-xs">{live.length}</span> : null}
        </Tabs.Tab>
        <Tabs.Tab value="fills" className="px-3 pb-3 text-sm font-medium text-ink-3 data-[active]:text-ink">
          Fills
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="orders">
        {orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">No orders yet. Your first one joins the next batch.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.slice(0, 10).map((o) => (
              <li key={o.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3 text-sm">
                <span className={`font-semibold ${o.side === "buy" ? "text-buy" : "text-sell"}`}>{o.side === "buy" ? "Buy" : "Sell"}</span>
                <span className="tnum text-ink">
                  {o.filled.toFixed(2)} / {o.qty} at {o.side === "buy" ? "≤" : "≥"} {fmt(o.tick)}
                  <span className="ml-3 text-ink-3">{o.settling ? "Filling…" : STATUS_LABEL[o.status]}</span>
                  {o.filled > 0 ? <span className="ml-3 text-ink-2">avg ${(o.quote / o.filled).toFixed(decimals)}</span> : null}
                </span>
                {o.status === "open" || o.status === "pending" || o.status === "partial" ? (
                  <button type="button" onClick={() => onCancel(o.id)} aria-label="Cancel order" className="press grid size-8 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06] hover-fine:text-ink">
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
          <p className="px-5 py-10 text-center text-sm text-ink-3">Fills appear here, each at its batch&apos;s one price.</p>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((f) => (
              <li key={`${f.orderId}-${f.block}`}>
                <button
                  type="button"
                  onClick={() => onCertificate(f)}
                  className="grid w-full grid-cols-[auto_1fr_auto] gap-4 px-5 py-3 text-left text-sm transition-colors hover-fine:bg-ink/[0.03]"
                  aria-label={`Certificate for ${f.side === "buy" ? "buying" : "selling"} ${f.qty.toFixed(2)} at ${fmt(f.tick)}`}
                >
                  <span className={`font-semibold ${f.side === "buy" ? "text-buy" : "text-sell"}`}>{f.side === "buy" ? "Bought" : "Sold"}</span>
                  <span className="tnum text-ink">
                    {f.qty.toFixed(2)} at {fmt(f.tick)}{" "}
                    <span className="text-ink-3">
                      · batch {f.block.toLocaleString("en-US")} · {f.participants > 0 ? `${f.participants} orders` : `${f.batchVolume.toFixed(2)} ${ticker} traded`}, one price
                    </span>
                  </span>
                  <span className="tnum text-ink-3">{new Date(f.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
