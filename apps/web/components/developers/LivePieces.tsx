"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { marketByTicker } from "@/lib/content/markets";
import { demoMarket } from "@/lib/demo/engine";
import { useVenue } from "@/lib/venue";
import { liveClients } from "@/lib/venue/live";
import { Hallmark } from "@/components/ui/Hallmark";

interface Line {
  id: number;
  event: "head" | "print";
  /** what a person reads: block, price and size in their units */
  text: string;
  /** the exact JSON a client receives, one hover away */
  raw: string;
}

type PrintData = { marketId: number; upTo: number; price: string; volume: string; refPrice: string; regime: string; receiptHash?: string };
const usd = (q: string) => `$${(Number(q) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shares = (v: string) => (Number(BigInt(v) / 10n ** 12n) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One event as a person reads it; the raw JSON stays on the line for anyone who hovers. */
function readable(event: Line["event"], data: unknown, tickerOf: (id: number) => string): string {
  if (event === "head") {
    const h = data as { block: number; ts: number };
    return `block ${h.block.toLocaleString("en-US")} · ${new Date(h.ts).toISOString().slice(11, 19)} UTC`;
  }
  const p = data as PrintData;
  const t = tickerOf(p.marketId);
  // an auction that ran and found no cross still prints, with nothing traded
  if (p.volume === "0") return [`block ${p.upTo.toLocaleString("en-US")}`, `${t} no trade`, `ref ${usd(p.refPrice)}`, p.regime.toLowerCase()].join(" · ");
  return [`block ${p.upTo.toLocaleString("en-US")}`, `${t} ${usd(p.price)}`, `${shares(p.volume)} ${t}`, `ref ${usd(p.refPrice)}`, p.regime.toLowerCase(), p.receiptHash ?? ""]
    .filter(Boolean)
    .join(" · ");
}

/** lines the console holds: its height (22.5rem) at 11.5/18.4 px, so it is always full */
const MAX = 18;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

/**
 * The tape's SSE stream, as it arrives: one line per event, the same JSON a client receives. In the simulation,
 * events of the same shape from the in-browser venue, labelled as such. It opens with the recent past (the last
 * prints, each after its block's head), so it arrives full rather than filling from empty.
 */
export function TapeConsole() {
  const v = useVenue();
  const [lines, setLines] = useState<Line[]>([]);
  const seq = useRef(0);
  const live = v.ready && v.mode === "live" && !!v.net;

  useEffect(() => {
    if (!v.ready) return;
    const ids = live ? v.net!.deployment.markets : {};
    const tickerOf = (id: number) => Object.entries(ids).find(([, m]) => m.id === id)?.[0].split("/")[0] ?? (live ? `market ${id}` : "aNVDA");
    const push = (event: Line["event"], data: unknown) =>
      setLines((l) => [...l.slice(-(MAX - 1)), { id: ++seq.current, event, text: readable(event, data, tickerOf), raw: JSON.stringify(data) }]);
    if (live) {
      const { tape } = liveClients(v.net!);
      const firstId = v.net!.deployment.markets[marketByTicker("aNVDA")!.symbol]?.id ?? 0;
      let streaming = false;
      tape
        .prints(firstId, { limit: MAX / 2, traded: true })
        .then((ps) => {
          if (streaming) return; // the live stream got there first
          for (const p of [...ps].reverse()) {
            push("head", { block: p.upTo, ts: p.ts });
            push("print", { marketId: p.marketId, upTo: p.upTo, tick: p.tick, price: p.price, volume: p.volume, refPrice: p.refPrice, regime: p.regime, receiptHash: short(p.receiptHash), chainOk: p.chainOk });
          }
        })
        .catch(() => undefined);
      const stream = tape.stream(["heads", "prints"], {
        head: (h) => {
          streaming = true;
          push("head", { block: h.block, ts: h.ts });
        },
        print: (p) => push("print", { marketId: p.marketId, upTo: p.upTo, tick: p.tick, price: p.price, volume: p.volume, refPrice: p.refPrice, regime: p.regime, receiptHash: short(p.receiptHash), chainOk: p.chainOk }),
      });
      return () => stream.close();
    }
    const m = demoMarket(marketByTicker("aNVDA")!);
    const release = m.retain({ book: false });
    let lastBlock = 0;
    let lastPrint = m.store.get().last?.block ?? 0;
    let seeded = false;
    const printLine = (p: { block: number; tick: number; volume: number; refTick: number }, regime: string) => ({
      marketId: 0,
      upTo: p.block,
      tick: p.tick,
      price: String(p.tick * 10_000),
      volume: String(Math.round(p.volume * 1e6)) + "000000000000",
      refPrice: String(p.refTick * 10_000),
      regime,
    });
    const off = m.store.subscribe(() => {
      const s = m.store.get();
      if (!seeded) {
        // the recent past first: the simulation's last prints, each after its block's head
        seeded = true;
        for (const p of s.prints.slice(-MAX / 2)) {
          push("head", { block: p.block, ts: p.ts });
          push("print", printLine(p, s.regime.name));
        }
        lastBlock = s.block;
        lastPrint = s.last?.block ?? lastPrint;
        return;
      }
      if (s.block !== lastBlock) {
        lastBlock = s.block;
        push("head", { block: s.block, ts: Date.now() });
      }
      if (s.last && s.last.block !== lastPrint) {
        lastPrint = s.last.block;
        push("print", printLine(s.last, s.regime.name));
      }
    });
    return () => {
      off();
      release();
    };
  }, [v.ready, live, v.net]);

  return (
    <figure className="overflow-hidden rounded-[var(--radius-lg)] bg-sunken">
      <figcaption className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-ink-3">
        <span className="font-mono">GET /v1/stream?topics=heads,prints</span>
        <Hallmark>{live ? "Live" : "Simulation"}</Hallmark>
      </figcaption>
      <div className="flex h-[22.5rem] flex-col justify-end overflow-hidden p-4 font-mono text-[11.5px] leading-[1.6] [font-variant-ligatures:none]" aria-live="off">
        {lines.map((l) => (
          <div key={l.id} title={l.raw} className="truncate motion-safe:animate-[fade-in_240ms_ease-out]">
            <span className={`inline-block w-[6ch] ${l.event === "print" ? "text-ink" : "text-ink-3"}`}>{l.event}</span>
            <span className={l.event === "print" ? "text-ink" : "text-ink-3"}>{l.text}</span>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Formatted for reading; hover a line for the JSON a client receives.</p>
    </figure>
  );
}

/** The active network's contracts, with a copy button each. */
export function Contracts() {
  const v = useVenue();
  if (!v.ready) return null;
  if (v.mode !== "live" || !v.net) {
    return <p className="text-sm text-ink-2">Contract addresses appear here when this site is connected to a Unison network.</p>;
  }
  const d = v.net.deployment;
  const rows: [string, string][] = [
    ["Exchange", d.exchange],
    ...(d.gateway ? ([["Order gateway", d.gateway]] as [string, string][]) : []),
    ...(d.operatorReference ? ([["Signed reference", d.operatorReference]] as [string, string][]) : []),
    ...(d.chainlinkReference ? ([["Chainlink reference", d.chainlinkReference]] as [string, string][]) : []),
    ...Object.values(d.markets).flatMap((m) => (m.vault ? ([[`${m.symbol.split("/")[0]} vault`, m.vault]] as [string, string][]) : [])),
    ...Object.values(d.tokens ?? {}).map((t) => [t.symbol, t.address] as [string, string]),
  ];
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-panel">
      <p className="border-b border-line px-6 py-3 text-xs text-ink-3">
        {v.net.network === "mainnet" ? "Monad" : v.net.network === "testnet" ? "Monad testnet" : "Local devnet"} · chain {d.chainId}
      </p>
      <ul className="divide-y divide-line">
        {rows.map(([label, address]) => (
          <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 text-sm">
            <span className="min-w-0">
              <span className="block text-ink">{label}</span>
              {v.net!.explorer ? (
                <a href={`${v.net!.explorer}/address/${address}`} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-ink-3 hover-fine:text-ink">
                  {address}
                </a>
              ) : (
                <span className="block truncate font-mono text-xs text-ink-3">{address}</span>
              )}
            </span>
            <CopyAddress address={address} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : `Copy ${address}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard refused */
        }
      }}
      className="press grid size-8 place-items-center rounded-full text-ink-3 hover-fine:bg-ink/[0.06] hover-fine:text-ink"
    >
      {done ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
