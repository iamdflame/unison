"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { marketByTicker } from "@/lib/content/markets";
import { demoMarket } from "@/lib/demo/engine";
import { useVenue } from "@/lib/venue";
import { liveClients } from "@/lib/venue/live";

interface Line {
  id: number;
  event: "head" | "print";
  data: string;
}

const MAX = 14;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

/**
 * The tape's SSE stream, as it arrives: one line per event, the same JSON a client receives. In the simulation,
 * events of the same shape from the in-browser venue, labelled as such.
 */
export function TapeConsole() {
  const v = useVenue();
  const [lines, setLines] = useState<Line[]>([]);
  const seq = useRef(0);
  const live = v.ready && v.mode === "live" && !!v.net;

  useEffect(() => {
    if (!v.ready) return;
    const push = (event: Line["event"], data: unknown) =>
      setLines((l) => [...l.slice(-(MAX - 1)), { id: ++seq.current, event, data: JSON.stringify(data) }]);
    if (live) {
      const stream = liveClients(v.net!).tape.stream(["heads", "prints"], {
        head: (h) => push("head", { block: h.block, ts: h.ts }),
        print: (p) => push("print", { marketId: p.marketId, upTo: p.upTo, tick: p.tick, price: p.price, volume: p.volume, refPrice: p.refPrice, regime: p.regime, receiptHash: short(p.receiptHash), chainOk: p.chainOk }),
      });
      return () => stream.close();
    }
    const m = demoMarket(marketByTicker("aNVDA")!);
    const release = m.retain({ book: false });
    let lastBlock = 0;
    let lastPrint = m.store.get().last?.block ?? 0;
    const off = m.store.subscribe(() => {
      const s = m.store.get();
      if (s.block !== lastBlock) {
        lastBlock = s.block;
        push("head", { block: s.block, ts: Date.now() });
      }
      if (s.last && s.last.block !== lastPrint) {
        lastPrint = s.last.block;
        push("print", { marketId: 0, upTo: s.last.block, tick: s.last.tick, price: String(s.last.tick * 10_000), volume: String(Math.round(s.last.volume * 1e6)) + "000000000000", refPrice: String(s.last.refTick * 10_000), regime: s.regime.name });
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
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`size-1.5 rounded-full ${live ? "bg-buy" : "bg-ink-3"}`} />
          {live ? "Live" : "Simulation"}
        </span>
      </figcaption>
      <div className="flex h-[22.5rem] flex-col justify-end overflow-hidden p-4 font-mono text-[11.5px] leading-[1.6]" aria-live="off">
        {lines.map((l) => (
          <div key={l.id} className="truncate motion-safe:animate-[fade-in_240ms_ease-out]">
            <span className={l.event === "print" ? "text-accent" : "text-ink-3"}>event: {l.event}</span>{" "}
            <span className={l.event === "print" ? "text-ink" : "text-ink-3"}>{l.data}</span>
          </div>
        ))}
      </div>
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
    <div className="overflow-hidden rounded-[var(--radius-xl)] bg-raised shadow-md">
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
