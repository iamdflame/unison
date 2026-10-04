"use client";

import type { MarketSummary, TapeHealth } from "@unison/sdk";
import { useEffect, useState } from "react";
import { RegimeBadge } from "@/components/app/RegimeBadge";
import { MARKETS, priceFormat, type MarketSpec } from "@/lib/content/markets";
import { shallowEqual } from "@/lib/store/createStore";
import { useMarket, useVenue } from "@/lib/venue";
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
      if (!alive) return;
      setWaiting(Object.fromEntries(pend));
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
  // A quiet market may go minutes without a clear (the keeper only pays for one that trades or merges). Lagging
  // means orders waiting on batches the keeper should have cleared by now.
  const STALE_BLOCKS = 40;
  const lagging = (id: number) => {
    const oldest = waiting[id];
    return head !== undefined && oldest !== null && oldest !== undefined && head - oldest > STALE_BLOCKS;
  };
  const issues = [tape, relayer, relay].filter((p) => p && p.level !== "ok").length + (markets ?? []).filter((m) => lagging(m.id)).length;
  const network = net.network === "mainnet" ? "Monad" : net.network === "testnet" ? "Monad testnet" : "the local devnet";

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
              <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
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
                const spec = MARKETS.find((s) => s.symbol === m.symbol);
                const { fmt } = spec ? priceFormat(spec) : { fmt: (t: number) => String(t) };
                const last = m.lastPrint;
                return (
                  <tr key={m.id}>
                    <th scope="row" className="px-6 py-3.5 font-semibold text-ink">
                      {m.symbol.split("/")[0]}
                    </th>
                    <td className="px-4 py-3.5">
                      <RegimeBadge name={m.halted ? "HALTED" : m.regime} />
                    </td>
                    <td className="tnum px-4 py-3.5 text-right text-ink-2">
                      {lagging(m.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <span aria-hidden className={`size-2 rounded-full ${LEVEL.slow.dot}`} /> Orders waiting {(head! - waiting[m.id]!).toLocaleString("en-US")} blocks
                        </span>
                      ) : last ? (
                        `#${last.upTo.toLocaleString("en-US")} · ${ago(now - last.ts)}`
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
        <p className="mt-4 text-sm text-ink-3">The keeper clears a market when orders are waiting and the auction would trade, so a quiet market prints less often than its cadence, and its last batch can be minutes old.</p>
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
            <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
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
        <RegimeBadge name={m.regime} bandBps={m.band} />
      </td>
      <td className="tnum px-4 py-3.5 text-right text-ink-2">{m.block !== null ? `#${m.block.toLocaleString("en-US")}` : "—"}</td>
      <td className="tnum px-6 py-3.5 text-right text-ink">{m.tick !== null ? fmt(m.tick) : "—"}</td>
    </tr>
  );
}
