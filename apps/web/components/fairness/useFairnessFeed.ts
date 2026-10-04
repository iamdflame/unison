"use client";

import type { FairnessWindow, Print as TapePrint } from "@unison/sdk";
import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import type { MarketSpec } from "@/lib/content/markets";
import { demoMarket, type Print } from "@/lib/demo/engine";
import { receiptHash, ZERO_HASH } from "@/lib/unison/receipt";
import { useVenue } from "@/lib/venue";
import { liveClients } from "@/lib/venue/live";

/** One link of the receipt chain: a batch's print, its deviation from the reference, and its hash. */
export interface ChainLink {
  upTo: number;
  ts: number;
  tick: number;
  refTick: number;
  traded: boolean;
  /** (price − reference) / reference, bp; null when nothing traded */
  devBps: number | null;
  hash: string;
  prev: string;
  /** links to the previous print and recomputes */
  ok: boolean;
}

export interface FairStats {
  batches: number;
  traded: number;
  meanAbs: number;
  p95Abs: number;
  maxAbs: number;
  /** ms from batch close to the reference's publish time; null where only the chain knows it */
  refLagMean: number | null;
  refLagP95: number | null;
  chainOk: boolean;
  histogram: { bps: number; count: number }[];
}

const LINKS = 12;

/** Simulated receipt hashes, per market and batch: computed once, as the chain grows (the markets are singletons too). */
const simHashes = new Map<string, Hex>();

function statsOf(devs: number[], batches: number): FairStats {
  const abs = devs.map(Math.abs).sort((a, b) => a - b);
  const hist = new Map<number, number>();
  for (const d of devs) {
    const b = Math.max(-50, Math.min(50, Math.round(d)));
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  return {
    batches,
    traded: devs.length,
    meanAbs: abs.length ? abs.reduce((s, x) => s + x, 0) / abs.length : 0,
    p95Abs: abs.length ? abs[Math.min(abs.length - 1, Math.ceil(abs.length * 0.95) - 1)]! : 0,
    maxAbs: abs.at(-1) ?? 0,
    refLagMean: null,
    refLagP95: null,
    chainOk: true,
    histogram: Array.from({ length: 101 }, (_, i) => ({ bps: i - 50, count: hist.get(i - 50) ?? 0 })),
  };
}

/**
 * The record for one market: the latest links of its receipt chain and its deviation statistics. Live from the
 * tape on a Unison network; in the simulation, the same chain computed in the browser over simulated prints.
 */
export function useFairnessFeed(spec: MarketSpec, window: FairnessWindow) {
  const v = useVenue();
  const marketId = v.mode === "live" && v.net ? v.net.deployment.markets[spec.symbol]?.id : undefined;
  const live = marketId !== undefined;
  const [links, setLinks] = useState<ChainLink[]>([]);
  const [stats, setStats] = useState<FairStats | null>(null);

  // live: the tape's own chain, verified as it indexed it
  useEffect(() => {
    if (!live || !v.net) return;
    const { tape } = liveClients(v.net);
    const tickSize = Number(spec.tickSize);
    const toLink = (p: TapePrint): ChainLink => ({
      upTo: p.upTo,
      ts: p.ts,
      tick: p.tick,
      refTick: Math.round(Number(p.refPrice) / tickSize),
      traded: p.volume !== "0",
      devBps: p.deviationBps,
      hash: p.receiptHash,
      prev: p.prevReceiptHash,
      ok: p.chainOk,
    });
    let alive = true;
    tape
      .prints(marketId!, { limit: LINKS })
      .then((ps) => alive && setLinks(ps.map(toLink).reverse()))
      .catch(() => undefined);
    const stream = tape.stream([`prints:${marketId}`], {
      print: (p) => {
        if (p.marketId !== marketId) return;
        setLinks((l) => (l.some((x) => x.upTo === p.upTo) ? l : [...l, toLink(p)].slice(-LINKS)));
      },
    });
    const loadStats = () =>
      tape
        .fairness(marketId!, { window })
        .then((f) =>
          alive &&
          setStats({
            batches: f.batches,
            traded: f.traded,
            meanAbs: f.meanAbsDevBps,
            p95Abs: f.p95AbsDevBps,
            maxAbs: f.maxAbsDevBps,
            refLagMean: f.meanRefLagMs,
            refLagP95: f.p95RefLagMs,
            chainOk: f.chainOk,
            histogram: f.histogram,
          }),
        )
        .catch(() => undefined);
    void loadStats();
    const t = setInterval(loadStats, 15_000);
    return () => {
      alive = false;
      stream.close();
      clearInterval(t);
    };
  }, [live, v.net, marketId, spec.tickSize, window]);

  // simulation: the venue's chain rule applied to simulated prints, in the browser
  const [prints, setPrints] = useState<readonly Print[]>([]);
  const sim = useMemo(() => (live ? null : demoMarket(spec)), [live, spec]);
  useEffect(() => {
    if (!sim) return;
    const release = sim.retain({ book: false });
    const push = () => setPrints(sim.store.get().prints);
    push();
    const off = sim.store.subscribe(push);
    return () => {
      off();
      release();
    };
  }, [sim]);

  const simFeed = useMemo(() => {
    if (live || prints.length === 0) return null;
    const tickSize = spec.tickSize;
    const chain: ChainLink[] = [];
    let prev: Hex = ZERO_HASH;
    for (const p of prints) {
      const key = `${spec.ticker}:${p.block}`;
      let h = simHashes.get(key);
      if (!h) {
        h = receiptHash(prev, { marketId: spec.id, upTo: p.block, tick: p.tick, volume: BigInt(Math.round(p.volume * 1e6)) * 10n ** 12n, refPrice: BigInt(p.refTick) * tickSize, refTimeMs: p.ts, status: 0 }, Math.floor(p.ts / 1000));
        simHashes.set(key, h);
      }
      chain.push({ upTo: p.block, ts: p.ts, tick: p.tick, refTick: p.refTick, traded: p.volume > 0, devBps: p.volume > 0 ? ((p.tick - p.refTick) / p.refTick) * 10_000 : null, hash: h, prev, ok: true });
      prev = h;
    }
    const devs = chain.filter((c) => c.devBps !== null).map((c) => c.devBps!);
    return { links: chain.slice(-LINKS), stats: statsOf(devs, chain.length) };
  }, [live, prints, spec]);

  return live ? { links, stats, live } : { links: simFeed?.links ?? [], stats: simFeed?.stats ?? null, live };
}
