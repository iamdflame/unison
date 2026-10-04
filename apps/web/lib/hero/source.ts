"use client";

import type { MarketSpec } from "../content/markets.ts";
import { bootVenue, marketFor, venue } from "../venue/index.ts";
import type { HeroFrame } from "./feed.ts";

/** A typical order, in dollars: the hero measures a print's weight in orders of this size. */
const TYPICAL_ORDER = 3_000;

export interface HeroSource {
  stop: () => void;
  live: boolean;
  /** the market's last print, in dollars, when the source starts */
  last: number | null;
}

/**
 * The hero's beat from the venue itself: the same market the terminal trades, live when the network answers and
 * otherwise this visit's simulation. One tape per visit, so the price on the dial is the price on the board and in
 * the terminal. It is imported once the page is idle, so the first paint carries none of it.
 */
export async function heroSource(spec: MarketSpec, onFrame: (f: HeroFrame) => void): Promise<HeroSource> {
  await bootVenue();
  const market = marketFor(spec);
  const release = market.retain({ book: false });
  const unit = Number(spec.tickSize) / 1e6;
  let prev = market.store.get();
  const unsubscribe = market.store.subscribe(() => {
    const m = market.store.get();
    if (m.block === prev.block && m.last === prev.last) return;
    const print = m.last && m.last !== prev.last ? m.last : null;
    onFrame({
      block: m.block,
      ts: Date.now(),
      ref: m.refTick * unit,
      price: print ? print.tick * unit : null,
      volume: print ? (print.volume * print.tick * unit) / TYPICAL_ORDER : 0,
      // orders that arrived since the last frame (the count restarts at each auction)
      orders: m.forming >= prev.forming ? m.forming - prev.forming : m.forming,
      regime: m.regime,
    });
    prev = m;
  });
  const first = market.store.get().last;
  return {
    stop: () => {
      unsubscribe();
      release();
    },
    live: venue.get().mode === "live",
    last: first ? first.tick * unit : null,
  };
}
