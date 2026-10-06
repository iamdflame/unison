"use client";

import type { MarketSummary, TapeHealth } from "@unison/sdk";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { causalWait } from "@/lib/content/facts";
import { MARKETS, marketName, priceFormat, specOfSymbol, type MarketSpec } from "@/lib/content/markets";
import { shallowEqual } from "@/lib/store/createStore";
import { useMarket, useVenue } from "@/lib/venue";
import type { NetConfig } from "@/lib/venue/config";
import { liveClients } from "@/lib/venue/live";

type Level = "ok" | "slow" | "down";
const LEVEL: Record<Level, { word: string; dot: string }> = {
  ok: { word: "Operational", dot: "bg-buy" },
  slow: { word: "Lagging", dot: "bg-halt" },
  down: { word: "Not answering", dot: "bg-sell" },
};

interface Probe<T> {
  level: Level;
  data: T | null;
  at: number;
}

async function probe<T>(url: string): Promise<Probe<T>> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const data = (await r.json()) as T;
    return { level: r.ok ? "ok" : "down", data, at: Date.now() };
  } catch {
    return { level: "down", data: null, at: Date.now() };
  }
}

/** A causal market (SPEC §7.4): its deployment record names the causal adapter as its reference. */
const causalIn = (net: NetConfig | null, id: number) => !!net && Object.values(net.deployment.markets).some((d) => d.id === id && d.reference === "chainlink-causal");

const ago = (ms: number) => (ms < 1500 ? "just now" : ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);

/** The venue's health, live: chain, indexer, relayer, reference relay, and every market's last clear. */
export function Status() {
  const v = useVenue();
  const net = v.mode === "live" ? v.net : null;
  const [tape, setTape] = useState<Probe<TapeHealth> | null>(null);
  const [relayer, setRelayer] = useState<Probe<{ ok: boolean; queued: number; faucet: boolean }> | null>(null);
  const [relay, setRelay] = useState<Probe<{ ok: boolean; signer: string }> | null>(null);
  const [markets, setMarkets] = useState<MarketSummary[] | null>(null);
  /** per market: the oldest batch an order still waits in (null: nothing waiting) */
  const [waiting, setWaiting] = useState<Record<number, number | null>>({});
  /**
   * per causal market whose oldest waiting order Chainlink has already priced: the latest it can have reached the chain
   * (unix ms). Waiting for Chainlink is the rule working; waiting after it is the keeper's delay.
   */
  const [pricedBy, setPricedBy] = useState<Record<number, number>>({});
  /** when this page first saw each market's oldest batch priced: frequent observations must not hide a stalled keeper */
  const firstSeen = useRef<Record<number, { batch: number; at: number }>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!net) return;
    let alive = true;
    const load = async () => {
      const [t, r, rl, ms] = await Promise.all([
        probe<TapeHealth>(`${net.tapeUrl}/health`),
        probe<{ ok: boolean; queued: number; faucet: boolean }>(`${net.relayerUrl}/health`),
        net.relayUrl ? probe<{ ok: boolean; signer: string }>(`${net.relayUrl}/health`) : Promise.resolve(null),
        liveClients(net).tape.markets().catch(() => null),
      ]);
      const pend = ms
        ? await Promise.all(ms.map((m) => liveClients(net).tape.pending(m.id).then((p) => [m.id, p.orders.length ? Math.min(...p.orders.map((o) => o.batch)) : null] as const).catch(() => [m.id, null] as const)))
        : [];
      // A causal market's orders wait for Chainlink's next observation by design. What counts is how long one made after
      // the oldest order has been on chain without a clear: no longer than since this page first saw it, and no longer
      // than since the latest observation landed (an observation lands about 13 s after it is made; 20 s bounds it).
      const causalRef = net.deployment.causalReference as Address | undefined;
      const skewSec = net.deployment.skewSec ?? 2;
      const priced = causalRef
        ? await Promise.all(
            pend
              .filter(([id, oldest]) => oldest !== null && causalIn(net, id))
              .map(([id, oldest]) =>
                Promise.all([liveClients(net).reader.blockTime(BigInt(oldest!)), liveClients(net).reader.reference(causalRef, BigInt(id))])
                  .then(([sealedSec, r]) => {
                    const observedSec = Number(r.publishTimeMs / 1000n);
                    if (observedSec <= sealedSec + skewSec) return null;
                    const seen = firstSeen.current[id];
                    const at = seen?.batch === oldest ? seen.at : Date.now();
                    firstSeen.current[id] = { batch: oldest!, at };
                    return [id, Math.min(at, (observedSec + 20) * 1000)] as const;
                  })
                  .catch(() => null),
              ),
          )
        : [];
      if (!alive) return;
      setWaiting(Object.fromEntries(pend));
      setPricedBy(Object.fromEntries(priced.filter((o) => o !== null)));
      setTape(t.data && t.data.lagBlocks > 20 ? { ...t, level: "slow" } : t);
      setRelayer(r);
      setRelay(rl);
      setMarkets(ms);
      setNow(Date.now());
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [net]);

  if (!v.ready) return <div className="h-[600px]" aria-busy="true" />;

  if (!net) return <SimulatedStatus />;

  const head = tape?.data?.head;
  const causalMarket = (id: number) => causalIn(net, id);
  const causalNames = (markets ?? []).filter((m) => causalMarket(m.id)).map((m) => marketName(m.symbol));
  // A quiet market may go minutes without a clear (the keeper only pays for one that trades or merges). Lagging
  // means orders waiting on batches the keeper should have cleared by now.
  const STALE_BLOCKS = 40;
  // On a causal market that is an auction Chainlink has priced, on chain for over 45 s, still not cleared.
  const CAUSAL_STALE_MS = 45_000;
  const lagging = (id: number) => {
    const oldest = waiting[id];
    if (oldest === null || oldest === undefined) return false;
    if (causalMarket(id)) return pricedBy[id] !== undefined && now - pricedBy[id] > CAUSAL_STALE_MS;
    return head !== undefined && head - oldest > STALE_BLOCKS;
  };
  const issues = [tape, relayer, relay].filter((p) => p && p.level !== "ok").length + (markets ?? []).filter((m) => lagging(m.id)).length;
  const network = net.network === "mainnet" ? "Monad mainnet" : net.network === "testnet" ? "Monad testnet" : "the local devnet";

  const rows: [string, string, Probe<unknown> | null, string][] = [
    ["Chain", `Blocks on ${network}`, tape, head ? `Block ${head.toLocaleString("en-US")}` : "—"],
    ["Tape", "Indexes every print, order and receipt", tape, tape?.data ? `${tape.data.lagBlocks} block${tape.data.lagBlocks === 1 ? "" : "s"} behind` : "—"],
    ["Relayer", "Submits signed actions, without gas", relayer, relayer?.data ? `${relayer.data.queued} queued${relayer.data.faucet ? " · faucet on" : ""}` : "—"],
    ...(net.relayUrl ? ([["Reference relay", "Signs the price each batch clears against", relay, relay?.data?.signer ? `signer ${relay.data.signer.slice(0, 6)}…${relay.data.signer.slice(-4)}` : "—"]] as [string, string, Probe<unknown> | null, string][]) : []),
  ];

  return (
    <>
      <section className="mx-auto max-w-[1440px] px-5 pt-36 pb-10 sm:px-8 lg:px-12 lg:pt-44">
        <h1 className="text-display-xl max-w-4xl text-ink">{tape === null ? "Checking…" : issues === 0 ? "Everything is running." : "Something is degraded."}</h1>
        <p className="text-lede mt-7 max-w-2xl text-ink-2">Live from {network}, checked every five seconds.</p>
      </section>

      <section aria-label="Services" className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8 lg:px-12">
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
          {rows.map(([name, what, p, detail]) => {
            const level = p?.level ?? "down";
            return (
              <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_140px]">
                <div>
                  <p className="text-[15px] font-semibold text-ink">{name}</p>
                  <p className="text-sm text-ink-3">{what}</p>
                </div>
                <p className="tnum hidden text-sm text-ink-2 sm:block">{detail}</p>
                <p className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                  <span aria-hidden className={`size-2 rounded-full ${p ? LEVEL[level].dot : "bg-ink-3"}`} />
                  {p ? LEVEL[level].word : "Checking"}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="markets-status" className="mx-auto max-w-[1440px] px-5 pb-28 sm:px-8 lg:px-12">
        <h2 id="markets-status" className="text-[17px] font-semibold text-ink">
          Markets
        </h2>
        <div className="mt-4 overflow-x-auto rounded-[var(--radius-xl)] bg-raised shadow-panel">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="px-6 py-3 font-medium">Market</th>
                <th scope="col" className="px-4 py-3 font-medium">Regime</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Last batch</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Last trade</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Trades, 24 h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(markets ?? []).map((m) => {
                const spec = specOfSymbol(m.symbol);
                const { fmt } = spec ? priceFormat(spec) : { fmt: (t: number) => String(t) };
                const last = m.lastPrint;
                return (
                  <tr key={m.id}>
                    <th scope="row" className="px-6 py-3.5 font-semibold text-ink">
                      {marketName(m.symbol)}
                    </th>
                    <td className="px-4 py-3.5">
                      <RegimeBadge name={m.halted ? "HALTED" : m.regime} plain causal={causalMarket(m.id)} />
                    </td>
                    <td className="tnum px-4 py-3.5 text-right text-ink-2">
                      {lagging(m.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <span aria-hidden className={`size-2 rounded-full ${LEVEL.slow.dot}`} />
                          {causalMarket(m.id)
                            ? `Priced by Chainlink ${ago(now - pricedBy[m.id]!)} or earlier; not cleared`
                            : `Orders waiting ${(head! - waiting[m.id]!).toLocaleString("en-US")} blocks`}
                        </span>
                      ) : last ? (
                        <>
                          {`#${last.upTo.toLocaleString("en-US")} · ${ago(now - last.ts)}`}
                          {causalMarket(m.id) && waiting[m.id] != null ? (
                            <span className="block text-xs text-ink-3">{pricedBy[m.id] !== undefined ? "Priced by Chainlink, clearing" : "Orders sealed, waiting for Chainlink"}</span>
                          ) : null}
                        </>
                      ) : (
                        "Never"
                      )}
                    </td>
                    <td className="tnum px-4 py-3.5 text-right text-ink">{last && last.volume !== "0" ? fmt(last.tick) : "—"}</td>
                    <td className="tnum px-6 py-3.5 text-right text-ink-2">{m.prints24h.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-3">
          The keeper clears a market when orders are waiting and the auction would trade, so a quiet market prints less often than its cadence, and its last batch can be minutes old.
          {causalNames.length
            ? ` On ${causalNames.join(" and ")}, orders wait for Chainlink's next observation by design (typically ${causalWait("WMON/AUSD")?.p50 ?? "half a minute"} for MON); a market is flagged only once Chainlink has priced its waiting orders and 45 s pass without a clear.`
            : null}
        </p>
      </section>
    </>
  );
}

/**
 * The same board for the simulation: what runs (the clearing engine, in this browser), what is simulated (the
 * references and the order flow), what isn't connected, and every market's last batch, all labelled as such.
 */
function SimulatedStatus() {
  const rows: [string, string, string, string, string][] = [
    ["Clearing engine", "The contracts' auction, bit-exact, in your browser", "every block in session, every 10 overnight", "Running", "bg-buy"],
    ["Reference prices", "A simulated feed for each market", "labelled on every screen", "Simulated", "bg-champagne"],
    ["Network", "No chain, tape or relayer connected to this copy of the site", "—", "Not connected", "bg-ink-3"],
  ];
  return (
    <>
      <section className="mx-auto max-w-[1440px] px-5 pt-36 pb-10 sm:px-8 lg:px-12 lg:pt-44">
        <h1 className="text-display-xl max-w-4xl text-ink">Running the simulation.</h1>
        <p className="text-lede mt-7 max-w-2xl text-ink-2">
          This copy of the site isn&apos;t connected to a Unison network, so every market here clears on the real clearing
          engine in your browser, on the venue&apos;s own schedule. Live status appears when the site is pointed at a network.
        </p>
      </section>

      <section aria-label="Services" className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8 lg:px-12">
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
          {rows.map(([name, what, detail, word, dot]) => (
            <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_140px]">
              <div>
                <p className="text-[15px] font-semibold text-ink">{name}</p>
                <p className="text-sm text-ink-3">{what}</p>
              </div>
              <p className="hidden text-sm text-ink-2 sm:block">{detail}</p>
              <p className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                <span aria-hidden className={`size-2 rounded-full ${dot}`} />
                {word}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="markets-status" className="mx-auto max-w-[1440px] px-5 pb-28 sm:px-8 lg:px-12">
        <h2 id="markets-status" className="text-[17px] font-semibold text-ink">
          Markets, simulated
        </h2>
        <div className="mt-4 overflow-x-auto rounded-[var(--radius-xl)] bg-raised shadow-panel">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="px-6 py-3 font-medium">Market</th>
                <th scope="col" className="px-4 py-3 font-medium">Regime and band</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Last batch</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Last trade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {MARKETS.map((spec) => (
                <SimulatedRow key={spec.ticker} spec={spec} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-3">Order flow, references and prints are generated in your browser; the auctions are the real ones.</p>
      </section>
    </>
  );
}

function SimulatedRow({ spec }: { spec: MarketSpec }) {
  const { value: m } = useMarket(
    spec.ticker,
    (s) => ({ block: s.last?.block ?? null, tick: s.last?.tick ?? null, regime: s.regime.name, band: s.regime.bandBps }),
    shallowEqual,
    { book: false },
  );
  const { fmt } = priceFormat(spec);
  return (
    <tr>
      <th scope="row" className="px-6 py-3.5 font-semibold text-ink">
        {spec.ticker}
      </th>
      <td className="px-4 py-3.5">
        <RegimeBadge name={m.regime} bandBps={m.band} plain />
      </td>
      <td className="tnum px-4 py-3.5 text-right text-ink-2">{m.block !== null ? `#${m.block.toLocaleString("en-US")}` : "—"}</td>
      <td className="tnum px-6 py-3.5 text-right text-ink">{m.tick !== null ? fmt(m.tick) : "—"}</td>
    </tr>
  );
}
