"use client";

import { buyLock, type RegimeName } from "@unison/engine";
import { BEAT_MS } from "../motion/tokens.ts";
import { facts } from "../content/facts.ts";
import type { MarketSpec } from "../content/markets.ts";
import { estimatedBlock } from "../hero/feed.ts";
import { clearBatch, type SimOrder } from "../sim/batch.ts";
import { createStore, type Store } from "../store/createStore.ts";
import { regimeNow, type RegimeNow } from "../unison/regimeNow.ts";
import { statusOfRegime, vaultCurve } from "../unison/vaultCurve.ts";

/**
 * Demo mode: a market that runs entirely in the browser on the real clearing engine, under the venue's own rules.
 * While the reference market trades there is an auction every block and the reference is published every block;
 * while it is closed (DISCOVERY) the reference holds at the last close, the crowd's sense of value keeps moving,
 * and an auction clears only every `discCadence` blocks, with orders gathering in between. The vault quotes from
 * the contract's own curve (its real parameters, for the benchmark's vault size, leaning with the inventory its
 * fills leave it); resting orders carry over; a paper account settles fills exactly as the contracts would (lock at
 * the limit plus the maximum fee; refund the difference). Labelled "Simulation".
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
  /** live: an auction crossed it and the fill is being settled (the keeper claims within a block or two) */
  settling?: boolean;
  placedBlock: number;
  /** batches that filled it */
  batches: number[];
  /** locked funds still held for it */
  locked: number;
}

export interface MyFill {
  ticker: string;
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
  /** the market was closed: the band was centred on the last close, and the auction was a call auction */
  closed?: boolean;
  /** the size of the order this fill belongs to */
  orderQty?: number;
  /** live: the auction's on-chain receipt hash */
  receipt?: string;
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
  /** orders that arrived since the last auction: the batch now forming */
  forming: number;
  /** the block of the last auction, whether or not it traded */
  lastAuction: number;
  /** the vault's quotes in the batch now forming (the simulation's; live, the chain's depth is the book) */
  vault: SimOrder[];
  /** the simulated vault's books, kept as LiquidityVault reports them (absent live: the chain has the real ones) */
  vaultBook?: VaultBook;
}

export interface VaultBook {
  /** shares and AUSD it holds */
  base: number;
  quote: number;
  /** what auctions paid it to be there: each fill against the reference */
  spreadPnl: number;
  /** what its holdings did as the reference moved */
  inventoryPnl: number;
  auctionsTraded: number;
  tradedBase: number;
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
const MAX_PRINTS = 900;
const E18 = 10n ** 18n;
/** The vault the simulation quotes for: the size the fairness benchmark used. */
export const SIM_VAULT_NAV = facts.benchmark.lpCapital;
/** A crowd order's typical size, in dollars (log-normal around it). */
const CROWD_NOTIONAL = 3_000;
/** Shares to two decimals; a token worth cents in whole units. */
const sizeOf = (q: number) => (q >= 100 ? Math.round(q) : Math.round(q * 100) / 100);

/**
 * The block the next auction clears at: the next block while the reference trades; in DISCOVERY, `discCadence`
 * blocks after the last (the contract reverts an earlier clear with TooEarly).
 */
export function nextAuction(m: MarketState): number {
  if (m.regime.name !== "DISCOVERY") return m.block + 1;
  return Math.max(m.block + 1, m.lastAuction + m.spec.regime.discCadence);
}

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

const PAPER: AccountState = {
  quote: 25_000,
  base: { aNVDA: 12, aSPY: 4, aQQQ: 4, aAAPL: 10, aTSLA: 6, aCOIN: 8, aMSTR: 6, aGLD: 6, WMON: 40_000, GBPm: 2_000 },
  lockedQuote: 0,
  lockedBase: {},
  orders: {},
  fills: [],
};

/** What the paper account starts with, by ticker: costed at each market's opening reference on Portfolio. */
export const PAPER_HOLDINGS: Readonly<Record<string, number>> = PAPER.base;

/** The simulation's paper account. */
export const account: Store<AccountState> = createStore<AccountState>(structuredClone(PAPER));

let nextId = 10_000;

export class DemoMarket {
  readonly store: Store<MarketState>;
  private rand: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = 0;
  private sigma: number;
  /** the published reference, in ticks (held at the close while the market is closed) */
  private ref: number;
  /** where the crowd thinks value is, in ticks; the reference follows it while the market trades */
  private fair: number;
  private regimeAt = 0;
  private lastAuction = 0;
  /** the simulated vault's inventory: shares, and AUSD */
  private vaultBase: number;
  private vaultQuote: number;
  private vaultSpread = 0;
  private vaultInventory = 0;
  private vaultAuctions = 0;
  private vaultTraded = 0;
  /** the reference the vault's holdings were last valued at */
  private markedAt = 0;

  constructor(readonly spec: MarketSpec) {
    this.rand = mulberry(spec.id * 7919 + 17);
    this.ref = Number(spec.seedPrice) / 1e6 / (Number(spec.tickSize) / 1e6);
    this.fair = this.ref;
    const tick = Math.round(this.ref);
    const regime = regimeNow(spec, new Date());
    const half = Math.max(2, Math.round((tick * regime.bandBps) / 10_000));
    this.sigma = spec.kind === "fx" ? 0.08 : spec.kind === "crypto" ? 0.9 : spec.kind === "etf" ? 0.18 : 0.45;
    const px = (tick * Number(spec.tickSize)) / 1e6;
    this.vaultQuote = SIM_VAULT_NAV / 2;
    this.vaultBase = px > 0 ? SIM_VAULT_NAV / 2 / px : 0;
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
      lastAuction: 0,
      vault: [],
    });
    this.markedAt = tick;
    // Warm up a history so charts aren't empty on arrival: about a hundred auctions, whatever the cadence.
    const beats = regime.name === "DISCOVERY" ? 100 * spec.regime.discCadence : 240;
    for (let i = 0; i < beats; i++) this.beat(Date.now() - (beats - i) * BEAT_MS, true);
  }

  /** Reference-counted: the market only beats while something is watching it. */
  retain(_opts?: { book?: boolean }) {
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

  private vaultBook(): VaultBook {
    return { base: this.vaultBase, quote: this.vaultQuote, spreadPnl: this.vaultSpread, inventoryPnl: this.vaultInventory, auctionsTraded: this.vaultAuctions, tradedBase: this.vaultTraded };
  }

  /** The vault's quotes for this reference and regime: LiquidityVault.curve, for the inventory it holds now. */
  private quotes(refTick: number, regime: RegimeName): SimOrder[] {
    const p = this.spec.vault;
    if (!p || refTick <= 0) return [];
    const refPrice = BigInt(refTick) * this.spec.tickSize;
    const q = vaultCurve(p, {
      refPrice,
      refTick,
      status: statusOfRegime(regime),
      baseBalance: (BigInt(Math.max(0, Math.round(this.vaultBase * 1e6))) * E18) / 1_000_000n,
      quoteBalance: BigInt(Math.max(0, Math.round(this.vaultQuote * 1e6))),
      baseUnit: E18,
    });
    const per = sizeOf(Number(q.perTick) / 1e18);
    if (per <= 0) return [];
    const out: SimOrder[] = [];
    for (let k = 0; k < q.bidTicks; k++) out.push({ id: -1 - k, side: "buy", tick: q.bidTop - k, qty: per });
    for (let k = 0; k < q.askTicks; k++) out.push({ id: -1_000 - k, side: "sell", tick: q.askBottom + k, qty: per });
    return out;
  }

  private beat(now: number, warmup: boolean) {
    const s = this.store.get();
    const unit = Number(this.spec.tickSize) / 1e6;
    const perBeat = this.sigma * Math.sqrt(BEAT_MS / 1000 / (365 * 24 * 3600));
    this.fair *= Math.exp(perBeat * 2.4 * this.normal());
    if (now - this.regimeAt > 30_000) this.regimeAt = now;
    const regime = now - this.regimeAt < 1 ? regimeNow(this.spec, new Date(now)) : s.regime;
    const discovery = regime.name === "DISCOVERY";
    if (discovery) {
      // The reference holds at the close. Value keeps moving, and only the auctions say where it is; it stays
      // well inside the band, which is centred on that close.
      const room = (this.ref * regime.bandBps * 0.6) / 10_000;
      this.fair = Math.min(this.ref + room, Math.max(this.ref - room, this.fair));
    } else {
      // A trading reference is published every block: it is where value is.
      this.ref = this.fair;
    }
    const refTick = Math.round(this.ref);
    const fairTick = Math.round(this.fair);
    // the vault's holdings, revalued as the reference moves: its inventory P&L
    if (this.markedAt > 0 && refTick !== this.markedAt) this.vaultInventory += this.vaultBase * (refTick - this.markedAt) * (Number(this.spec.tickSize) / 1e6);
    this.markedAt = refTick;
    const half = Math.max(2, Math.round((refTick * regime.bandBps) / 10_000));
    const lo = refTick - half;
    const hi = refTick + half;
    const block = estimatedBlock(now);
    const cadence = discovery ? this.spec.regime.discCadence : 1;

    // The crowd: limits around where it thinks value is, sometimes a burst.
    const book = s.book.filter((o) => o.owner === "you" || block - o.placedBlock < 60);
    const arrivals = this.rand() < 0.1 ? 4 + Math.floor(this.rand() * 6) : Math.floor(this.rand() * 3);
    const spread = Math.max(2, Math.round(refTick * 0.0006));
    const px = refTick * unit;
    for (let i = 0; i < arrivals; i++) {
      const side = this.rand() < 0.5 ? "buy" : "sell";
      const off = Math.round(this.normal() * spread);
      book.push({
        id: nextId++,
        side,
        tick: fairTick + (side === "buy" ? off - 1 : off + 1),
        qty: sizeOf((Math.exp(this.normal() * 0.7) * CROWD_NOTIONAL) / px),
        owner: "crowd",
        ioc: this.rand() < 0.25,
        placedBlock: block,
      });
    }
    const vault = this.quotes(refTick, regime.name);
    const common = { block, refTick, regime, lo, hi };

    // Between call auctions orders only gather (one auction a block at most); the auction takes all that gathered.
    if (Math.floor(block / cadence) <= Math.floor(this.lastAuction / cadence)) {
      this.store.set({ ...s, ...common, book, vault, forming: s.forming + arrivals, vaultBook: this.vaultBook() });
      return;
    }
    this.lastAuction = block;
    const out = clearBatch([...book, ...vault], { lo, hi, refTick });
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
      // The vault's fills move its inventory, and its next quotes lean to rebalance.
      const at = out.tick * unit;
      const refAt = refTick * unit;
      let filled = 0;
      for (const o of vault) {
        const f = out.fills.get(o.id) ?? 0;
        if (f <= 0) continue;
        const d = o.side === "buy" ? f : -f;
        this.vaultBase += d;
        this.vaultQuote -= d * at;
        // its spread: bought below the reference, or sold above it
        this.vaultSpread += o.side === "buy" ? f * (refAt - at) : f * (at - refAt);
        filled += f;
      }
      if (filled > 0) {
        this.vaultAuctions += 1;
        this.vaultTraded += filled;
      }
    }
    const prints = print ? [...s.prints.slice(-(MAX_PRINTS - 1)), print] : s.prints;
    this.store.set({
      ...s,
      ...common,
      book: next,
      vault: print ? this.quotes(refTick, regime.name) : vault,
      prints,
      last: print ?? s.last,
      forming: 0,
      lastAuction: block,
      vaultBook: this.vaultBook(),
    });
    // the orders that traded at the one price (not every order present)
    const traded = out.traded ? book.filter((o) => (out.fills.get(o.id) ?? 0) > 0).length : 0;
    if (!warmup && mine.length) settle(this.spec, mine, print, out.tick, refTick, block, now, traded, lo, hi, discovery);
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
    const order: MyOrder = {
      id: nextId++,
      side,
      tick,
      qty,
      filled: 0,
      quote: 0,
      fee: 0,
      ioc,
      status: "pending",
      placedBlock: s.block,
      batches: [],
      locked,
    };
    account.set((acc) => ({
      ...acc,
      quote: side === "buy" ? acc.quote - locked : acc.quote,
      lockedQuote: side === "buy" ? acc.lockedQuote + locked : acc.lockedQuote,
      base: side === "sell" ? { ...acc.base, [ticker]: (acc.base[ticker] ?? 0) - qty } : acc.base,
      lockedBase:
        side === "sell" ? { ...acc.lockedBase, [ticker]: (acc.lockedBase[ticker] ?? 0) + qty } : acc.lockedBase,
      orders: { ...acc.orders, [ticker]: [order, ...(acc.orders[ticker] ?? [])] },
    }));
    this.store.set((m) => ({
      ...m,
      book: [...m.book, { id: order.id, side, tick, qty, owner: "you", ioc, placedBlock: s.block }],
      forming: m.forming + 1,
    }));
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
        lockedBase:
          o.side === "sell"
            ? { ...acc.lockedBase, [ticker]: (acc.lockedBase[ticker] ?? 0) - o.locked }
            : acc.lockedBase,
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
  closed: boolean,
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
        next = {
          ...next,
          filled: o.filled + f,
          quote: o.quote + notional,
          fee: o.fee + fee,
          batches: [...o.batches, block],
        };
        if (o.side === "buy") {
          base[ticker] = (base[ticker] ?? 0) + f;
          next.locked = Math.max(0, o.locked - (notional + fee));
          lockedQuote -= Math.min(o.locked, notional + fee);
        } else {
          quote += notional - fee;
          next.locked = Math.max(0, o.locked - f);
          lockedBase[ticker] = (lockedBase[ticker] ?? 0) - f;
        }
        fills.unshift({
          ticker: spec.ticker,
          orderId: o.id,
          side: o.side,
          qty: f,
          tick,
          block,
          ts: now,
          refTick,
          batchVolume: print.volume,
          participants,
          limitTick: o.tick,
          bandLo,
          bandHi,
          closed,
          orderQty: o.qty,
        });
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
    return {
      ...acc,
      quote,
      lockedQuote: Math.max(0, lockedQuote),
      base,
      lockedBase,
      orders: { ...acc.orders, [ticker]: list },
      fills: fills.slice(0, 200),
    };
  });
}

/** Cancels the paper account's resting orders and restores its starting balances. */
export function resetPaperAccount() {
  for (const [ticker, list] of Object.entries(account.get().orders)) {
    const m = markets.get(ticker);
    for (const o of list) if (o.status === "open" || o.status === "pending" || o.status === "partial") m?.cancel(o.id);
  }
  account.set(structuredClone(PAPER));
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
