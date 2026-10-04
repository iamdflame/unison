"use client";

import { buyLock } from "@unison/engine";
import { BEAT_MS } from "../motion/tokens.ts";
import type { MarketSpec } from "../content/markets.ts";
import { estimatedBlock } from "../hero/feed.ts";
import { clearBatch, type SimOrder } from "../sim/batch.ts";
import { createStore, type Store } from "../store/createStore.ts";
import { regimeNow, type RegimeNow } from "../unison/regimeNow.ts";

/**
 * Demo mode: a market that runs entirely in the browser on the real clearing engine, one batch per 300 ms beat.
 * The reference walks at NVDA-like volatility, the crowd places limit orders (some IOC), a vault quotes both sides
 * around the reference, resting orders carry over between batches, and a paper account settles fills exactly as
 * the contracts would (lock at the limit plus the maximum fee; refund the difference). Labelled "Simulation".
 */
export interface Print {
  block: number;
  ts: number;
  tick: number;
  volume: number;
  refTick: number;
}

export interface BookOrder extends SimOrder {
  owner: "crowd" | "you";
  ioc: boolean;
  placedBlock: number;
  /** shares already filled (yours only) */
  filled?: number;
}

export type MyOrderStatus = "pending" | "open" | "filled" | "partial" | "cancelled" | "expired";

export interface MyOrder {
  id: number;
  side: "buy" | "sell";
  tick: number;
  qty: number;
  filled: number;
  /** quote paid (buys) or received (sells), before fees */
  quote: number;
  fee: number;
  ioc: boolean;
  status: MyOrderStatus;
  placedBlock: number;
  /** batches that filled it */
  batches: number[];
  /** locked funds still held for it */
  locked: number;
}

export interface MyFill {
  orderId: number;
  side: "buy" | "sell";
  qty: number;
  tick: number;
  block: number;
  ts: number;
  refTick: number;
  batchVolume: number;
  participants: number;
  limitTick: number;
  bandLo: number;
  bandHi: number;
}

export interface MarketState {
  spec: MarketSpec;
  block: number;
  refTick: number;
  regime: RegimeNow;
  lo: number;
  hi: number;
  book: BookOrder[];
  prints: Print[];
  last: Print | null;
  /** orders that arrived in the batch now forming */
  forming: number;
}

export interface AccountState {
  quote: number; // AUSD free
  base: Record<string, number>; // free shares by ticker
  lockedQuote: number;
  lockedBase: Record<string, number>;
  orders: Record<string, MyOrder[]>;
  fills: MyFill[];
}

const FEE_BPS = 3;
const VAULT_SPREAD_TICKS = 6;
const MAX_PRINTS = 900;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const account: Store<AccountState> = createStore<AccountState>({
  quote: 25_000,
  base: { aNVDA: 12, aSPY: 4, aQQQ: 4, aAAPL: 10, aTSLA: 6, aCOIN: 8, aMSTR: 6, aGLD: 6, WMON: 40_000, GBPm: 2_000 },
  lockedQuote: 0,
  lockedBase: {},
  orders: {},
  fills: [],
});

let nextId = 10_000;

export class DemoMarket {
  readonly store: Store<MarketState>;
  private rand: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = 0;
  private sigma: number;
  private ref: number;
  private regimeAt = 0;

  constructor(readonly spec: MarketSpec) {
    this.rand = mulberry(spec.id * 7919 + 17);
    this.ref = Number(spec.seedPrice) / 1e6 / (Number(spec.tickSize) / 1e6);
    const tick = Math.round(this.ref);
    const regime = regimeNow(spec, new Date());
    const half = Math.max(2, Math.round((tick * regime.bandBps) / 10_000));
    this.sigma = spec.kind === "fx" ? 0.08 : spec.kind === "crypto" ? 0.9 : spec.kind === "etf" ? 0.18 : 0.45;
    this.store = createStore<MarketState>({
      spec,
      block: estimatedBlock(Date.now()),
      refTick: tick,
      regime,
      lo: tick - half,
      hi: tick + half,
      book: [],
      prints: [],
      last: null,
      forming: 0,
    });
    // Warm up a short history so charts aren't empty on arrival.
    for (let i = 0; i < 240; i++) this.beat(Date.now() - (240 - i) * BEAT_MS, true);
  }

  /** Reference-counted: the market only beats while something is watching it. */
  retain() {
    this.subscribers++;
    if (!this.timer) this.loop();
    return () => {
      this.subscribers--;
      if (this.subscribers <= 0 && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }

  private loop = () => {
    this.beat(Date.now(), false);
    this.timer = setTimeout(this.loop, BEAT_MS);
  };

  private normal() {
    const u = Math.max(this.rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private beat(now: number, warmup: boolean) {
    const s = this.store.get();
    const perBeat = this.sigma * Math.sqrt(BEAT_MS / 1000 / (365 * 24 * 3600));
    this.ref *= Math.exp(perBeat * 2.4 * this.normal());
    const refTick = Math.round(this.ref);
    if (now - this.regimeAt > 30_000) this.regimeAt = now;
    const regime = now - this.regimeAt < 1 ? regimeNow(this.spec, new Date(now)) : s.regime;
    const half = Math.max(2, Math.round((refTick * regime.bandBps) / 10_000));
    const lo = refTick - half;
    const hi = refTick + half;
    const block = estimatedBlock(now);

    // The crowd: mostly near the reference, sometimes a burst.
    const book = s.book.filter((o) => o.owner === "you" || block - o.placedBlock < 60);
    const arrivals = this.rand() < 0.1 ? 4 + Math.floor(this.rand() * 6) : Math.floor(this.rand() * 3);
    const spread = Math.max(2, Math.round(refTick * 0.0006));
    for (let i = 0; i < arrivals; i++) {
      const side = this.rand() < 0.5 ? "buy" : "sell";
      const off = Math.round(this.normal() * spread);
      book.push({
        id: nextId++,
        side,
        tick: refTick + (side === "buy" ? off - 1 : off + 1),
        qty: Math.round(Math.exp(this.normal() * 0.7) * 1.6 * 100) / 100,
        owner: "crowd",
        ioc: this.rand() < 0.25,
        placedBlock: block,
      });
    }
    // The vault quotes both sides around the reference (never pays a sniper: the reference is post-close).
    const vault: SimOrder[] = [];
    for (let k = 0; k < 6; k++) {
      vault.push({ id: -1 - k, side: "buy", tick: refTick - VAULT_SPREAD_TICKS - k * 2, qty: 3 + k });
      vault.push({ id: -100 - k, side: "sell", tick: refTick + VAULT_SPREAD_TICKS + k * 2, qty: 3 + k });
    }

    const batch = [...book, ...vault];
    const out = clearBatch(batch, { lo, hi, refTick });
    let print: Print | null = null;
    const next: BookOrder[] = [];
    const mine: { o: BookOrder; filled: number }[] = [];
    for (const o of book) {
      const f = out.traded ? (out.fills.get(o.id) ?? 0) : 0;
      if (o.owner === "you") mine.push({ o, filled: f });
      const left = Math.round((o.qty - f) * 100) / 100;
      if (left > 0.004 && !o.ioc) next.push({ ...o, qty: left });
    }
    if (out.traded && out.volume > 0) {
      print = { block, ts: now, tick: out.tick, volume: Math.round(out.volume * 100) / 100, refTick };
    }
    const prints = print ? [...s.prints.slice(-(MAX_PRINTS - 1)), print] : s.prints;
    this.store.set({
      ...s,
      block,
      refTick,
      regime,
      lo,
      hi,
      book: next,
      prints,
      last: print ?? s.last,
      forming: 0,
    });
    if (!warmup && mine.length) settle(this.spec, mine, print, out.tick, refTick, block, now, book.length, lo, hi);
  }

  /** Your order joins the batch now forming. */
  place(side: "buy" | "sell", tick: number, qty: number, ioc: boolean): MyOrder | { error: string } {
    const s = this.store.get();
    const a = account.get();
    const ticker = this.spec.ticker;
    const price = (tick * Number(this.spec.tickSize)) / 1e6;
    let locked = 0;
    if (side === "buy") {
      // The contract locks notional at the limit plus the maximum fee (engine.buyLock, 6-decimal quote units).
      const lock = buyLock(BigInt(Math.round(qty * 1e6)), BigInt(Math.round(price * 1e6)), 10n, 1_000_000n);
      locked = Number(lock) / 1e6;
      if (locked > a.quote) return { error: "Not enough free AUSD. Deposit first; funds in open orders are locked." };
    } else {
      if (qty > (a.base[ticker] ?? 0)) return { error: `Not enough free ${ticker}.` };
      locked = qty;
    }
    const order: MyOrder = { id: nextId++, side, tick, qty, filled: 0, quote: 0, fee: 0, ioc, status: "pending", placedBlock: s.block, batches: [], locked };
    account.set((acc) => ({
      ...acc,
      quote: side === "buy" ? acc.quote - locked : acc.quote,
      lockedQuote: side === "buy" ? acc.lockedQuote + locked : acc.lockedQuote,
      base: side === "sell" ? { ...acc.base, [ticker]: (acc.base[ticker] ?? 0) - qty } : acc.base,
      lockedBase: side === "sell" ? { ...acc.lockedBase, [ticker]: (acc.lockedBase[ticker] ?? 0) + qty } : acc.lockedBase,
      orders: { ...acc.orders, [ticker]: [order, ...(acc.orders[ticker] ?? [])] },
    }));
    this.store.set((m) => ({ ...m, book: [...m.book, { id: order.id, side, tick, qty, owner: "you", ioc, placedBlock: s.block }], forming: m.forming + 1 }));
    return order;
  }

  cancel(id: number) {
    const ticker = this.spec.ticker;
    this.store.set((m) => ({ ...m, book: m.book.filter((o) => o.id !== id) }));
    account.set((acc) => {
      const list = acc.orders[ticker] ?? [];
      const o = list.find((x) => x.id === id);
      if (!o || (o.status !== "open" && o.status !== "pending" && o.status !== "partial")) return acc;
      const done: MyOrder = { ...o, status: "cancelled", locked: 0 };
      return {
        ...acc,
        quote: o.side === "buy" ? acc.quote + o.locked : acc.quote,
        lockedQuote: o.side === "buy" ? acc.lockedQuote - o.locked : acc.lockedQuote,
        base: o.side === "sell" ? { ...acc.base, [ticker]: (acc.base[ticker] ?? 0) + o.locked } : acc.base,
        lockedBase: o.side === "sell" ? { ...acc.lockedBase, [ticker]: (acc.lockedBase[ticker] ?? 0) - o.locked } : acc.lockedBase,
        orders: { ...acc.orders, [ticker]: list.map((x) => (x.id === id ? done : x)) },
      };
    });
  }
}

/** Applies a batch's fills to the paper account, as `claim` would on-chain. */
function settle(
  spec: MarketSpec,
  mine: { o: BookOrder; filled: number }[],
  print: Print | null,
  tick: number,
  refTick: number,
  block: number,
  now: number,
  participants: number,
  bandLo: number,
  bandHi: number,
) {
  const ticker = spec.ticker;
  const unit = Number(spec.tickSize) / 1e6;
  account.set((acc) => {
    let quote = acc.quote;
    let lockedQuote = acc.lockedQuote;
    const base = { ...acc.base };
    const lockedBase = { ...acc.lockedBase };
    const fills = [...acc.fills];
    const list = (acc.orders[ticker] ?? []).map((o) => {
      const hit = mine.find((m) => m.o.id === o.id);
      if (!hit || (o.status !== "pending" && o.status !== "open" && o.status !== "partial")) return o;
      const f = Math.min(hit.filled, o.qty - o.filled);
      let next = { ...o };
      if (f > 0 && print) {
        const px = tick * unit;
        const notional = f * px;
        const fee = (notional * FEE_BPS) / 10_000;
        next = { ...next, filled: o.filled + f, quote: o.quote + notional, fee: o.fee + fee, batches: [...o.batches, block] };
        if (o.side === "buy") {
          base[ticker] = (base[ticker] ?? 0) + f;
          next.locked = Math.max(0, o.locked - (notional + fee));
          lockedQuote -= Math.min(o.locked, notional + fee);
        } else {
          quote += notional - fee;
          next.locked = Math.max(0, o.locked - f);
          lockedBase[ticker] = (lockedBase[ticker] ?? 0) - f;
        }
        fills.unshift({ orderId: o.id, side: o.side, qty: f, tick, block, ts: now, refTick, batchVolume: print.volume, participants, limitTick: o.tick, bandLo, bandHi });
      }
      const complete = next.filled >= next.qty - 0.004;
      const ended = complete || next.ioc;
      if (ended) {
        // Release what is left of the lock: the unspent quote (buys) or the unfilled shares (sells).
        if (o.side === "buy") {
          quote += next.locked;
          lockedQuote -= next.locked;
        } else {
          base[ticker] = (base[ticker] ?? 0) + next.locked;
          lockedBase[ticker] = (lockedBase[ticker] ?? 0) - next.locked;
        }
        next.locked = 0;
        next.status = complete ? "filled" : next.filled > 0 ? "partial" : "expired";
      } else {
        next.status = next.filled > 0 ? "partial" : "open";
      }
      return next;
    });
    return { ...acc, quote, lockedQuote: Math.max(0, lockedQuote), base, lockedBase, orders: { ...acc.orders, [ticker]: list }, fills: fills.slice(0, 200) };
  });
}

const markets = new Map<string, DemoMarket>();
export function demoMarket(spec: MarketSpec): DemoMarket {
  let m = markets.get(spec.ticker);
  if (!m) {
    m = new DemoMarket(spec);
    markets.set(spec.ticker, m);
  }
  return m;
}

export const demoRefTick = refTickOf;
function refTickOf(m: MarketState) {
  return m.refTick;
}
