"use client";

import type { FairnessWindow } from "@unison/sdk";
import { Check, Download } from "lucide-react";
import { useState } from "react";
import { useSize } from "@/components/trade/useSize";
import { MARKETS, marketByTicker, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { useVenue } from "@/lib/venue";
import { chooseNetwork, networks } from "@/lib/venue/config";
import { useFairnessFeed, type ChainLink, type FairStats } from "./useFairnessFeed";

const WINDOWS: [FairnessWindow, string][] = [
  ["1h", "1 hour"],
  ["24h", "24 hours"],
  ["7d", "7 days"],
];

/** The live record: the receipt chain as it grows, and how close every batch cleared to its reference. */
export function FairnessLive() {
  const v = useVenue();
  const listed = v.mode === "live" && v.net ? MARKETS.filter((m) => v.net!.deployment.markets[m.symbol]) : MARKETS;
  const [ticker, setTicker] = useState("aNVDA");
  const [window, setWindow] = useState<FairnessWindow>("24h");
  const spec = marketByTicker(ticker) ?? listed[0]!;
  const { links, stats, live } = useFairnessFeed(spec, window);
  const network = v.net?.network === "mainnet" ? "Monad mainnet" : v.net?.network === "testnet" ? "Monad testnet" : "the local devnet";
  // each network is its own venue: name this one, and offer the other
  const other = live ? networks().find((n) => n !== v.net?.network) : undefined;

  return (
    <>
      <section aria-labelledby="chain-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="max-w-2xl">
            <h2 id="chain-title" className="text-display-m text-ink">
              The receipt chain.
            </h2>
            <p className="text-lede mt-5 text-ink-2">
              Every batch&apos;s print commits to the one before it. Change any past price, volume or reference and every
              hash after it breaks.
            </p>
          </div>
          <div role="radiogroup" aria-label="Market" className="flex max-w-xl flex-wrap justify-start gap-1.5">
            {listed.map((m) => (
              <button
                key={m.ticker}
                type="button"
                role="radio"
                aria-checked={m.ticker === spec.ticker}
                onClick={() => setTicker(m.ticker)}
                className={`press tap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${m.ticker === spec.ticker ? "bg-thumb text-ink shadow-sm" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
              >
                {m.ticker}
              </button>
            ))}
          </div>
        </div>
        <Chain links={links} spec={spec} />
        <p className="mt-5 text-sm text-ink-3">
          {live
            ? `Live from the tape on ${network}. Each link was recomputed from its print and the one before as it was indexed.`
            : "Simulation: the venue's chain rule, computed in your browser over simulated batches."}
          {other ? (
            <>
              {" "}
              <button type="button" onClick={() => chooseNetwork(other)} className="text-ink underline decoration-line-strong underline-offset-4 hover-fine:decoration-ink">
                See {other === "mainnet" ? "Monad mainnet" : "the testnet"}
              </button>
              .
            </>
          ) : null}
        </p>
      </section>

      <section aria-labelledby="dev-title" className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 id="dev-title" className="text-display-m text-ink">
              How close to the reference.
            </h2>
            <p className="text-lede mt-5 text-ink-2">
              Each batch&apos;s one price against the reference it cleared on. In session, tight is good: nobody bought a
              price the reference didn&apos;t support. While a market is closed its reference is the last close, so its
              prints wander from it as the auctions find the price; that distance is discovery, not slippage.
            </p>
            {live ? (
              <div role="radiogroup" aria-label="Window" className="mt-8 inline-grid grid-cols-3 gap-1 rounded-full bg-sunken p-1">
                {WINDOWS.map(([w, label]) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={window === w}
                    onClick={() => setWindow(w)}
                    className={`press rounded-full px-4 py-2 text-sm font-medium transition-colors ${window === w ? "bg-thumb text-ink shadow-sm" : "text-ink-2 hover-fine:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="lg:col-span-8">
            <div className="rounded-[var(--radius-xl)] bg-raised p-6 shadow-panel sm:p-8">
              {stats && stats.traded > 0 ? <Deviation stats={stats} /> : <p className="py-16 text-center text-sm text-ink-3">No traded batches in this window yet.</p>}
            </div>
            {live && v.net ? (
              <a
                href={`${v.net.tapeUrl}/v1/markets/${v.net.deployment.markets[spec.symbol]!.id}/prints.csv`}
                className="press mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-ink hairline"
                download
              >
                <Download size={15} strokeWidth={1.75} aria-hidden /> Every {spec.ticker} print, as CSV
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

function Chain({ links, spec }: { links: ChainLink[]; spec: MarketSpec }) {
  const { fmt } = priceFormat(spec);
  // As many whole cards as fit, led by a note that the chain goes on: never a card cut by a fade.
  const [ref, size] = useSize<HTMLDivElement>();
  const fit = size.width > 0 ? Math.max(1, Math.floor((size.width - 112) / 208)) : 0;
  const shown = links.slice(-fit);
  return (
    <div ref={ref} className="relative mt-10" aria-label={`The last ${shown.length} batches of ${spec.ticker} and their receipt hashes`} role="list">
      <div className="flex min-h-[188px] items-stretch justify-end">
        {shown.length ? (
          <div className="flex shrink-0 items-center" aria-hidden>
            <span className="text-xs text-ink-3">earlier</span>
            <span className="ml-3 h-px w-14 bg-gradient-to-r from-transparent to-champagne" />
          </div>
        ) : null}
        {shown.map((l) => (
          <div key={l.upTo} role="listitem" className="flex shrink-0 items-center motion-safe:animate-[link-in_420ms_cubic-bezier(0.23,1,0.32,1)]">
            {/* every card hangs from the chain: the one before it, or the earlier ones */}
            <span className="flex w-7 items-center" aria-hidden>
              <span className={`h-px flex-1 ${l.ok ? "bg-champagne" : "bg-halt"}`} />
            </span>
            <div className="w-[180px] rounded-[var(--radius-lg)] bg-raised p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <span className="dial-label text-ink-3">Batch</span>
                {l.ok ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-buy" title="Links to the previous print and recomputes">
                    <Check size={12} strokeWidth={2.2} aria-hidden /> linked
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-halt">broken</span>
                )}
              </div>
              <p className="tnum mt-1 text-sm font-semibold text-ink">{l.upTo.toLocaleString("en-US")}</p>
              <p className="tnum mt-3 text-lg font-semibold text-ink">{l.traded ? fmt(l.tick) : "No cross"}</p>
              <p className="tnum text-xs text-ink-2">{l.devBps === null ? `${l.closed ? "last close" : "reference"} ${fmt(l.refTick)}` : `${l.devBps >= 0 ? "+" : "−"}${Math.abs(l.devBps).toFixed(1)} bp vs ${l.closed ? "last close" : "reference"}`}</p>
              <p className="mt-3 font-mono text-[11px] text-ink-3">
                {l.hash.slice(0, 10)}…{l.hash.slice(-4)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Deviation({ stats }: { stats: FairStats }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const R = Math.max(8, Math.min(50, Math.ceil(stats.maxAbs) + 2));
  const bins = stats.histogram.filter((h) => h.bps >= -R && h.bps <= R);
  const max = Math.max(1, ...bins.map((b) => b.count));
  const W = Math.max(280, size.width);
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 30 };
  const bw = (W - pad.l - pad.r) / (2 * R + 1);
  const x = (bps: number) => pad.l + (bps + R) * bw;
  const y = (c: number) => H - pad.b - (c / max) * (H - pad.t - pad.b);
  const lag = (ms: number | null) => (ms === null ? "on-chain only" : `${(ms / 1000).toFixed(2)} s`);

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <div className="col-span-2">
          {/* which price the distance is from: in session the reference; while closed the last close, which is discovery */}
          <dt className="text-sm text-ink-3">
            {stats.closedShare === 1
              ? "Mean distance from the last close: discovery, not slippage"
              : stats.closedShare === 0
                ? "Mean distance from the reference"
                : "Mean distance from the reference, or the last close while closed"}
          </dt>
          <dd className="numerals mt-1 text-[clamp(2.5rem,5vw,3.5rem)] leading-none text-ink">
            {stats.meanAbs.toFixed(2)} <span className="font-sans text-base text-ink-3">bp</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">95% within</dt>
          <dd className="tnum mt-1 text-xl font-semibold text-ink">{stats.p95Abs.toFixed(2)} bp</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">Widest</dt>
          <dd className="tnum mt-1 text-xl font-semibold text-ink">{stats.maxAbs.toFixed(2)} bp</dd>
        </div>
      </dl>
      <div ref={ref} className="mt-8 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} role="img" aria-label={`Deviation of ${stats.traded} traded batches from the reference: mean ${stats.meanAbs.toFixed(2)} bp, 95% within ${stats.p95Abs.toFixed(2)} bp.`}>
          {bins.map((b) => (
            <rect key={b.bps} x={x(b.bps) + 1} y={y(b.count)} width={Math.max(1, bw - 2)} height={H - pad.b - y(b.count)} rx={Math.min(2, bw / 4)} fill={b.bps === 0 ? "var(--ink)" : "color-mix(in oklch, var(--ink) 55%, transparent)"} />
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" />
          <line x1={x(0) + bw / 2} x2={x(0) + bw / 2} y1={pad.t - 6} y2={H - pad.b} stroke="var(--champagne)" strokeWidth="1.5" />
          {[-stats.p95Abs, stats.p95Abs].map((p) => (
            <line key={p} x1={x(p) + bw / 2} x2={x(p) + bw / 2} y1={pad.t} y2={H - pad.b} stroke="var(--ink-3)" strokeDasharray="3 4" />
          ))}
          {[-R, 0, R].map((t) => (
            <text key={t} x={x(t) + bw / 2} y={H - 8} textAnchor={t < 0 ? "start" : t > 0 ? "end" : "middle"} className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
              {t === 0 ? "reference" : `${t > 0 ? "+" : "−"}${Math.abs(t)} bp`}
            </text>
          ))}
        </svg>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Batches cleared</dt>
          <dd className="tnum mt-0.5 text-ink">{stats.batches.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Traded</dt>
          <dd className="tnum mt-0.5 text-ink">{stats.traded.toLocaleString("en-US")}</dd>
        </div>
        <div>
          {/* the rule only applies in session: say so when every batch here cleared against the last close */}
          <dt className="text-ink-3">{stats.closedShare === 1 ? "Reference" : "Reference published after close"}</dt>
          <dd className="tnum mt-0.5 text-ink">
            {stats.closedShare === 1
              ? `The last close, all ${stats.batches.toLocaleString("en-US")} (market closed)`
              : stats.refLagMean === null
                ? "Enforced by contract, in session"
                : `${lag(stats.refLagP95)} p95`}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Receipt chain</dt>
          <dd className={`mt-0.5 ${stats.chainOk ? "text-buy" : "text-halt"}`}>{stats.chainOk ? "Every link verified" : "A link failed to verify"}</dd>
        </div>
      </dl>
    </div>
  );
}
