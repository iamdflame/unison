"use client";

import { Tabs } from "@base-ui/react/tabs";
import { RelayerClient } from "@unison/sdk/relayer";
import { TapeClient, type Transfer } from "@unison/sdk/tape";
import { ArrowUpRight, Check, Copy, Droplets, Fingerprint, RotateCcw, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/ui/toast";
import { preloadSignIn, SignInSheet } from "@/components/app/SignInSheet";
import { certificate, certificateFor } from "@/components/trade/certificateStore";
import { MARKETS, marketByTicker, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { PAPER_HOLDINGS, resetPaperAccount, type AccountState, type MyOrder } from "@/lib/demo/engine";
import { costBasis } from "@/lib/unison/costBasis";
import { useStore } from "@/lib/store/createStore";
import { marketFor, useMarks, useVenue, useVenueAccount } from "@/lib/venue";
import { identity } from "@/lib/venue/identity";
import { refreshAccount } from "@/lib/venue/live";

/** Loaded when a withdrawal is in view (pointer over the button, or focus), so the page itself stays light. */
const WithdrawDialog = dynamic(() => import("./WithdrawDialog").then((m) => m.WithdrawDialog), { ssr: false });

/** Ink at falling strengths for positions; champagne for cash, the reserve. Never a rainbow. */
const STRENGTH = [82, 64, 50, 40, 32, 26, 21, 17, 14, 12];
const swatch = (i: number) => `color-mix(in oklch, var(--ink) ${STRENGTH[Math.min(i, STRENGTH.length - 1)]}%, transparent)`;

/**
 * Holds a fast-moving value for a second at a time. The page samples the marks, not the totals, so every figure
 * on it (equity, breakdown, rows) comes from the same prices and always adds up.
 */
function useSampled<T>(value: T, ms = 1000): T {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    const push = () => setShown(latest.current);
    const first = setTimeout(push, 0);
    const t = setInterval(push, ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [ms]);
  return shown;
}

const signedMoney = (n: number) =>
  `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** gains in the buy colour, losses in the sell colour, nothing in ink */
const tone = (n: number) => (Math.abs(n) < 0.005 ? "text-ink-2" : n > 0 ? "text-buy" : "text-sell");

interface Holding {
  key: string;
  label: string;
  sub: string;
  qty: number;
  locked: number;
  price: number;
  value: number;
  spec: MarketSpec | null;
  color: string;
  /** average cost a share, fees included; null when the fills don't explain the position */
  avg: number | null;
  /** unrealised P&L at the reference mark; null when the cost isn't known */
  pnl: number | null;
  /** while its market is closed the reference is the last close; this is the second mark, the last trade since */
  lastPrice: number | null;
}

export function Portfolio() {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const acct = useVenueAccount((a) => a, Object.is);
  const [signInOpen, setSignInOpen] = useState(false);

  if (v.ready && v.mode === "live" && !id) {
    return (
      <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12">
        <h1 className="text-display-m text-ink">Portfolio</h1>
        <div className="mt-8 rounded-[var(--radius-xl)] bg-raised px-6 py-14 text-center shadow-panel sm:py-20">
          <p className="text-display-m text-ink">Your account is your passkey.</p>
          <p className="mx-auto mt-4 max-w-md text-ink-2">Sign in with Face ID, Touch ID or Windows Hello to see your balances, orders and fills.</p>
          <button type="button" onClick={() => setSignInOpen(true)} onPointerEnter={preloadSignIn} onFocus={preloadSignIn} className="press mt-8 inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg">
            <Fingerprint size={18} strokeWidth={1.5} aria-hidden /> Sign in
          </button>
        </div>
        <SignInSheet open={signInOpen} onOpenChange={setSignInOpen} />
      </div>
    );
  }
  return <Account acct={acct} />;
}

function Account({ acct }: { acct: AccountState }) {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const live = v.mode === "live";
  const heldKey = MARKETS.filter((m) => (acct.base[m.ticker] ?? 0) + (acct.lockedBase[m.ticker] ?? 0) > 1e-12)
    .map((m) => m.ticker)
    .join(",");
  const held = useMemo(() => (heldKey ? heldKey.split(",").map((t) => marketByTicker(t)!) : []), [heldKey]);
  const marks = useSampled(useMarks(held));
  // what each position cost: the fills, oldest first, from the paper account's opening references (live: from nothing)
  const basis = useMemo(() => {
    const start = live
      ? {}
      : Object.fromEntries(Object.entries(PAPER_HOLDINGS).map(([t, q]) => [t, { qty: q, price: Number(marketByTicker(t)!.seedPrice) / 1e6 }]));
    return costBasis(
      acct.fills,
      start,
      (f) => f.tick * (Number(marketByTicker(f.ticker)!.tickSize) / 1e6),
      (t) => marketByTicker(t)?.feeBps ?? 0,
    );
  }, [acct.fills, live]);

  const holdings = useMemo(() => {
    const positions: Holding[] = held.map((spec) => {
      const qty = (acct.base[spec.ticker] ?? 0) + (acct.lockedBase[spec.ticker] ?? 0);
      const { unit } = priceFormat(spec);
      const price = (marks[spec.ticker]?.refTick ?? 0) * unit;
      const mk = marks[spec.ticker];
      const lastPrice = mk && mk.regime === "DISCOVERY" && mk.lastTick !== null ? mk.lastTick * unit : null;
      const b = basis[spec.ticker];
      // a cost is known only when the fills (and the start) explain the whole position
      const known = !!b && Math.abs(b.qty - qty) < 1e-6 && qty > 0;
      const avg = known ? b.avg : null;
      return { key: spec.ticker, label: spec.ticker, sub: spec.name, qty, locked: acct.lockedBase[spec.ticker] ?? 0, price, value: qty * price, spec, color: "", avg, pnl: avg !== null && price > 0 ? qty * (price - avg) : null, lastPrice };
    });
    positions.sort((a, b) => b.value - a.value);
    positions.forEach((p, i) => (p.color = swatch(i)));
    const cash: Holding = { key: "AUSD", label: "AUSD", sub: "Cash", qty: acct.quote + acct.lockedQuote, locked: acct.lockedQuote, price: 1, value: acct.quote + acct.lockedQuote, spec: null, color: "var(--champagne)", avg: null, pnl: null, lastPrice: null };
    return [cash, ...positions];
  }, [held, marks, basis, acct.base, acct.lockedBase, acct.quote, acct.lockedQuote]);

  const equity = holdings.reduce((s, h) => s + h.value, 0);
  // both marks while a held market is closed: the close it is valued at, and where its auctions have traded since
  const closedHeld = holdings.some((h) => h.lastPrice !== null);
  const equityAtLast = holdings.reduce((s, h) => s + (h.lastPrice !== null ? h.qty * h.lastPrice : h.value), 0);
  const unrealized = holdings.reduce((s, h) => s + (h.pnl ?? 0), 0);
  const realized = Object.values(basis).reduce((s, b) => s + b.realized, 0);
  // a total over part of the book says so
  const partly = holdings.some((h) => h.spec && h.avg === null);
  // when no position's cost is known, there is no total to show: "$0.00" would read as flat
  const anyKnown = holdings.some((h) => h.spec && h.avg !== null);
  // the same P&L at the second mark: where a market is closed its last trade can put the sign the other way
  const unrealizedAtLast = holdings.reduce((s, h) => s + (h.avg !== null && h.lastPrice !== null ? h.qty * (h.lastPrice - h.avg) : (h.pnl ?? 0)), 0);
  const halted = held.filter((s) => marks[s.ticker]?.regime === "HALTED");

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5 sm:items-end">
        <div className="min-w-0">
          <h1 className="text-display-m text-ink">Portfolio</h1>
          {live && id && v.net ? <AccountLine account={id.account} network={v.net.network} /> : <p className="mt-3 text-ink-2">Paper account · Simulation</p>}
        </div>
        <Actions live={live} />
      </header>

      {halted.length ? (
        <p role="status" className="mt-6 rounded-2xl bg-sell-soft px-4 py-3 text-sm text-halt">
          Trading in {halted.map((s) => s.ticker).join(", ")} is paused while its primary market is halted. Cancel, claim and withdraw still work.
        </p>
      ) : null}

      <section aria-label="Equity" className="mt-8 rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8">
        <p className="text-sm text-ink-3">{closedHeld ? "Equity at reference prices, the last close where a market is closed" : "Equity at reference prices"}</p>
        <p className="numerals mt-2 text-[clamp(2.5rem,7vw,4.75rem)] leading-none text-ink">
          {/* a balance is read, not watched: it updates in place, without rolling digits */}
          {equity.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {closedHeld ? (
          <p className="figures mt-2 text-sm text-ink-2">
            {equityAtLast.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })} with closed
            markets at their last trade
          </p>
        ) : null}
        <Allocation holdings={holdings} equity={equity} />
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-2">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="text-ink-3">Cash</dt>
            <dd className="figures text-ink">${acct.quote.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="text-ink-3">Held by open orders</dt>
            <dd className="figures text-ink">${acct.lockedQuote.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="text-ink-3">Positions</dt>
            <dd className="figures text-ink">${(equity - acct.quote - acct.lockedQuote).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="text-ink-3">{partly && anyKnown ? "Unrealised P&L, where cost is known" : "Unrealised P&L"}</dt>
            <dd className={`figures ${anyKnown ? tone(unrealized) : "text-ink-3"}`}>{anyKnown ? signedMoney(unrealized) : "Not known"}</dd>
          </div>
          {closedHeld && anyKnown ? (
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <dt className="text-ink-3">At last trades</dt>
              <dd className={`figures ${tone(unrealizedAtLast)}`}>{signedMoney(unrealizedAtLast)}</dd>
            </div>
          ) : null}
          <div className={`flex flex-col gap-0.5 sm:flex-row sm:gap-2 ${closedHeld && anyKnown ? "" : "col-span-2 sm:col-span-1"}`}>
            <dt className="text-ink-3">Realised</dt>
            <dd className={`figures ${tone(realized)}`}>{signedMoney(realized)}</dd>
          </div>
        </dl>
        {!live ? <p className="mt-3 text-xs text-ink-3">Starting positions are costed at their opening reference; every fill since is counted, fees included.</p> : null}
      </section>

      <Holdings holdings={holdings} equity={equity} />
      <History acct={acct} />
    </div>
  );
}

function AccountLine({ account, network }: { account: string; network: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused */
    }
  };
  const net = network === "mainnet" ? "Monad" : network === "testnet" ? "Monad testnet" : "Local devnet";
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
      Passkey account on {net}
      <button type="button" onClick={copy} className="press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-sunken px-2.5 py-1 font-mono text-xs text-ink-2 hover-fine:text-ink" aria-label={copied ? "Address copied" : "Copy account address"}>
        {account.slice(0, 6)}…{account.slice(-4)}
        {copied ? <Check size={12} strokeWidth={2} aria-hidden /> : <Copy size={12} strokeWidth={1.75} aria-hidden />}
      </button>
    </p>
  );
}

function Actions({ live }: { live: boolean }) {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const [busy, setBusy] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawWanted, setWithdrawWanted] = useState(false);

  if (!live) {
    return (
      <button
        type="button"
        onClick={() => {
          resetPaperAccount();
          toast("Paper account reset", { description: "Orders cancelled and starting balances restored." });
        }}
        className="press -mr-2 -mt-0.5 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-sm font-medium text-ink-3 transition-colors hover-fine:text-ink sm:mt-0 sm:min-h-0 sm:py-1"
        aria-label="Reset paper account"
      >
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
        <span>
          Reset<span className="hidden sm:inline"> paper account</span>
        </span>
      </button>
    );
  }
  const net = v.net;
  return (
    <div className="flex flex-wrap gap-2">
      {net?.faucet && id ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = new RelayerClient(net.relayerUrl);
              const { id: job } = await r.faucet(id.account);
              await r.waitForJob(job);
              await refreshAccount(net);
              toast.success("Test funds deposited.");
            } catch (e) {
              toast.error((e as Error).message.split("\n")[0] ?? "The faucet didn't answer.");
            } finally {
              setBusy(false);
            }
          }}
          className="press inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold text-ink hairline disabled:opacity-50"
        >
          <Droplets size={15} strokeWidth={1.75} aria-hidden /> {busy ? "Depositing…" : "Add test funds"}
        </button>
      ) : null}
      <button
        type="button"
        onPointerEnter={() => setWithdrawWanted(true)}
        onFocus={() => setWithdrawWanted(true)}
        onClick={() => {
          setWithdrawWanted(true);
          setWithdrawOpen(true);
        }}
        className="press inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-ink px-4 py-2.5 text-sm font-semibold text-bg">
        <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden /> Withdraw
      </button>
      {withdrawWanted ? <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} /> : null}
    </div>
  );
}

function Allocation({ holdings, equity }: { holdings: Holding[]; equity: number }) {
  if (equity <= 0) return <div className="mt-7 h-2 rounded-full bg-sunken" aria-hidden />;
  return (
    // one continuous bar, rounded only at its ends; each holding a segment, divided by a hairline of the card
    <div className="mt-7 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
      {holdings
        .filter((h) => h.value / equity >= 0.002)
        .map((h) => (
          <span key={h.key} className="h-full min-w-[2px] transition-[flex-grow] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]" style={{ flexGrow: h.value, flexBasis: 0, background: h.color }} />
        ))}
    </div>
  );
}

function Holdings({ holdings, equity }: { holdings: Holding[]; equity: number }) {
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <section aria-labelledby="holdings-title" className="mt-6 overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
      <h2 id="holdings-title" className="px-6 pt-5 pb-3 text-[15px] font-semibold text-ink">
        Holdings
      </h2>
      <div className="hidden grid-cols-[minmax(0,1.3fr)_1fr_1fr_1fr_1fr_1fr_72px] gap-x-5 border-y border-line px-6 py-2.5 text-xs text-ink-3 md:grid" aria-hidden>
        <span>Asset</span>
        <span className="text-right">Quantity</span>
        <span className="text-right">Average cost</span>
        <span className="text-right">Reference price</span>
        <span className="text-right">Value</span>
        <span className="text-right">Unrealised P&amp;L</span>
        <span className="text-right">Share</span>
      </div>
      <ul className="divide-y divide-line border-t border-line md:border-t-0">
        {holdings.map((h) => {
          const share = equity > 0 ? (h.value / equity) * 100 : 0;
          const decimals = h.spec ? priceFormat(h.spec).decimals : 2;
          const qtyDigits = h.spec?.kind === "crypto" || h.spec?.kind === "fx" ? 2 : 4;
          const row = (
            <>
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: h.color }} />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{h.label}</p>
                  {/* phones: the quantity leads the name on one line; wide screens give it its own column */}
                  <p className="truncate text-[13px] text-ink-3">
                    <span className="figures md:hidden">{h.qty.toLocaleString("en-US", { maximumFractionDigits: h.spec ? qtyDigits : 2 })} · </span>
                    {h.sub}
                  </p>
                </div>
              </div>
              <div className="hidden text-right md:block">
                <p className="tnum text-ink">{h.qty.toLocaleString("en-US", { maximumFractionDigits: h.spec ? qtyDigits : 2 })}</p>
                {h.locked > 1e-9 ? <p className="tnum text-xs text-ink-3">{h.locked.toLocaleString("en-US", { maximumFractionDigits: 2 })} in orders</p> : null}
              </div>
              <p className="tnum hidden text-right text-ink-2 md:block">
                {h.avg !== null ? `$${h.avg.toFixed(decimals + 1)}` : <span className="text-[13px] text-ink-3">{h.spec ? "Not known" : ""}</span>}
              </p>
              <div className="hidden text-right md:block">
                <p className="tnum text-ink-2">{h.spec ? `$${h.price.toFixed(decimals)}` : "$1.00"}</p>
                {h.lastPrice !== null ? <p className="tnum text-xs text-ink-3">last trade ${h.lastPrice.toFixed(decimals)}</p> : null}
              </div>
              <div className="hidden text-right md:block">
                <p className="tnum font-semibold text-ink">{money(h.value)}</p>
                {h.lastPrice !== null ? <p className="tnum text-xs text-ink-3">{money(h.qty * h.lastPrice)} at last trade</p> : null}
              </div>
              <div className="hidden text-right md:block">
                <p className={`tnum ${h.pnl === null ? "text-ink-3" : tone(h.pnl)}`}>{h.pnl !== null ? signedMoney(h.pnl) : ""}</p>
                {h.pnl !== null && h.avg !== null && h.lastPrice !== null ? (
                  <p className="tnum text-xs text-ink-3">{signedMoney(h.qty * (h.lastPrice - h.avg))} at last trade</p>
                ) : null}
              </div>
              <p className="tnum hidden text-right text-ink-3 md:block">{share.toFixed(1)}%</p>
              <div className="text-right md:hidden">
                <p className="tnum font-semibold text-ink">{money(h.value)}</p>
                <p className={`tnum text-xs ${h.pnl === null ? "text-ink-3" : tone(h.pnl)}`}>
                  {h.pnl !== null ? `P&L ${signedMoney(h.pnl)}` : `${share.toFixed(1)}% of total`}
                </p>
                {h.pnl !== null && h.avg !== null && h.lastPrice !== null ? (
                  <p className="tnum text-[11px] text-ink-3">{signedMoney(h.qty * (h.lastPrice - h.avg))} at last trade</p>
                ) : null}
              </div>
            </>
          );
          // phones: two columns, the asset and its quantity on the left, its value and P&L on the right
          const cls = "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-6 py-3.5 md:grid-cols-[minmax(0,1.3fr)_1fr_1fr_1fr_1fr_1fr_72px] md:items-center md:gap-x-5";
          return (
            <li key={h.key}>
              {h.spec ? (
                <Link href={`/trade/${h.spec.ticker}`} className={`${cls} transition-colors duration-150 hover-fine:bg-ink/[0.03]`} aria-label={`${h.label}: ${money(h.value)}, ${share.toFixed(1)}% of equity`}>
                  {row}
                </Link>
              ) : (
                <div className={cls}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const STATUS: Record<MyOrder["status"], string> = { pending: "In batch", open: "Resting", partial: "Partly filled", filled: "Filled", cancelled: "Cancelled", expired: "Expired" };

function History({ acct }: { acct: AccountState }) {
  const v = useVenue();
  const live = v.mode === "live";
  const [tab, setTab] = useState("orders");
  const open = useMemo(
    () =>
      Object.entries(acct.orders)
        .flatMap(([ticker, list]) => list.map((o) => ({ ticker, o })))
        .filter(({ o }) => o.status === "pending" || o.status === "open" || o.status === "partial")
        .sort((a, b) => b.o.placedBlock - a.o.placedBlock),
    [acct.orders],
  );
  const fills = acct.fills.slice(0, 60);

  return (
    <Tabs.Root value={tab} onValueChange={(t) => setTab(String(t))} className="mt-6 rounded-[var(--radius-xl)] bg-raised shadow-panel">
      <Tabs.List className="relative flex gap-1 border-b border-line px-3 pt-3" aria-label="Activity">
        {[
          ["orders", "Open orders", open.length],
          ["fills", "Fills", 0],
          ...(live ? [["transfers", "Transfers", 0] as const] : []),
        ].map(([value, label, n]) => (
          <Tabs.Tab key={value} value={value} className="rounded-t-xl px-3 pt-1.5 pb-3 text-sm font-medium text-ink-3 outline-none transition-colors data-[active]:text-ink hover-fine:text-ink focus-visible:outline-2 focus-visible:outline-focus">
            {label}
            {n ? <span className="tnum ml-1.5 rounded-full bg-ink/[0.07] px-1.5 text-xs">{n}</span> : null}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="absolute bottom-0 left-[var(--active-tab-left)] h-0.5 w-[var(--active-tab-width)] rounded-full bg-ink transition-[left,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]" />
      </Tabs.List>

      <Tabs.Panel value="orders">
        {open.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-3">No open orders. Each one you place joins the next batch.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map(({ ticker, o }) => {
              const spec = marketByTicker(ticker);
              const fmt = spec ? priceFormat(spec).fmt : (t: number) => String(t);
              return (
                <li key={`${ticker}-${o.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 text-sm">
                  <span className={`w-10 font-semibold ${o.side === "buy" ? "text-buy" : "text-sell"}`}>{o.side === "buy" ? "Buy" : "Sell"}</span>
                  <span className="tnum min-w-0 truncate text-ink">
                    <Link href={`/trade/${ticker}`} className="font-semibold hover-fine:underline">
                      {ticker}
                    </Link>{" "}
                    {o.filled.toFixed(2)} / {o.qty} at {o.side === "buy" ? "≤" : "≥"} {fmt(o.tick)}
                    <span className="ml-3 text-ink-3">{o.settling ? "Filling…" : STATUS[o.status]}</span>
                  </span>
                  {spec ? (
                    <button
                      type="button"
                      onClick={() => {
                        void Promise.resolve(marketFor(spec).cancel(o.id)).catch((e: Error) => toast.error(e.message.split("\n")[0] ?? "Couldn't cancel."));
                      }}
                      aria-label={`Cancel ${o.side} ${ticker} at ${fmt(o.tick)}`}
                      className="press grid size-8 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06] hover-fine:text-ink"
                    >
                      <X size={15} strokeWidth={1.75} aria-hidden />
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="fills">
        {fills.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-3">Fills appear here, each at its batch&apos;s one price, each with a certificate.</p>
        ) : (
          <ul className="divide-y divide-line">
            {fills.map((f) => {
              const spec = marketByTicker(f.ticker);
              if (!spec) return null;
              const { fmt } = priceFormat(spec);
              return (
                <li key={`${f.ticker}-${f.orderId}-${f.block}`}>
                  <button
                    type="button"
                    onClick={() => certificate.set(certificateFor(f, spec, live ? v.net : null))}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 text-left text-sm transition-colors hover-fine:bg-ink/[0.03]"
                    aria-label={`Certificate for ${f.side === "buy" ? "buying" : "selling"} ${f.qty.toFixed(2)} ${f.ticker} at ${fmt(f.tick)}`}
                  >
                    <span className={`w-14 font-semibold ${f.side === "buy" ? "text-buy" : "text-sell"}`}>{f.side === "buy" ? "Bought" : "Sold"}</span>
                    <span className="tnum min-w-0 truncate text-ink">
                      {f.qty.toFixed(2)} {f.ticker} at {fmt(f.tick)} <span className="text-ink-3">· block {f.block.toLocaleString("en-US")}</span>
                    </span>
                    <span className="tnum text-ink-3">{new Date(f.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Tabs.Panel>

      {live ? (
        <Tabs.Panel value="transfers">
          <Transfers />
        </Tabs.Panel>
      ) : null}
    </Tabs.Root>
  );
}

function Transfers() {
  const v = useVenue();
  const id = useStore(identity, (x) => x);
  const quote = useVenueAccount((a) => a.quote);
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const net = v.net;

  // Balances move with every deposit and withdrawal, so a new balance is the cue to look again.
  useEffect(() => {
    if (!net || !id) return;
    let alive = true;
    new TapeClient(net.tapeUrl)
      .transfers(id.account)
      .then((t) => alive && setRows(t))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [net, id, quote]);

  if (!net || !id) return null;
  if (rows === null) return <p className="px-6 py-12 text-center text-sm text-ink-3">Loading transfers…</p>;
  if (rows.length === 0) return <p className="px-6 py-12 text-center text-sm text-ink-3">No deposits or withdrawals yet.</p>;
  const tokens = Object.entries(net.deployment.tokens ?? {});
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => {
        const [sym, info] = tokens.find(([, x]) => x.address.toLowerCase() === t.token.toLowerCase()) ?? [t.token.slice(0, 8), { decimals: 18 }];
        const amount = Number(BigInt(t.amount)) / 10 ** info.decimals;
        return (
          <li key={`${t.tx}-${t.kind}-${t.token}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 text-sm">
            <span className="w-24 font-semibold text-ink">{t.kind === "deposit" ? "Deposit" : "Withdrawal"}</span>
            <span className="tnum min-w-0 truncate text-ink">
              {amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {sym}
              <span className="ml-2 font-mono text-xs text-ink-3">
                {t.kind === "deposit" ? "from" : "to"} {t.counterparty.slice(0, 6)}…{t.counterparty.slice(-4)}
              </span>
            </span>
            {net.explorer ? (
              <a href={`${net.explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer" className="tnum text-ink-3 hover-fine:text-ink">
                {new Date(t.ts).toLocaleString("en-US", { hour12: false })}
              </a>
            ) : (
              <span className="tnum text-ink-3">{new Date(t.ts).toLocaleString("en-US", { hour12: false })}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
