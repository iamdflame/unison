"use client";

import {
  buildCancel,
  buildOrder,
  decodeUnisonError,
  RelayerClient,
  Side,
  TapeClient,
  UnisonClient,
  type MarketSummary,
  type Print as TapePrint,
} from "@unison/sdk";
import { createPublicClient, http, type Address } from "viem";
import { marketByTicker, type MarketSpec } from "../content/markets.ts";
import type { AccountState, BookOrder, MarketState, MyFill, MyOrder, Print } from "../demo/engine.ts";
import { createStore, type Store } from "../store/createStore.ts";
import { regimeNow } from "../unison/regimeNow.ts";
import type { NetConfig } from "./config.ts";
import { identity, signAction } from "./identity.ts";

/**
 * Live venue: the same MarketState / AccountState the simulation produces, filled from the tape (prints, heads,
 * pending orders, account history over SSE), the chain (ledger balances, resting depth) and the relayer (every
 * action, gasless). Components can't tell the difference, which is the point.
 */
let clients: { net: NetConfig; tape: TapeClient; relayer: RelayerClient; chain: UnisonClient } | null = null;
export function liveClients(net: NetConfig) {
  if (!clients || clients.net !== net) {
    const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
    clients = {
      net,
      tape: new TapeClient(net.tapeUrl),
      relayer: new RelayerClient(net.relayerUrl),
      chain: new UnisonClient({ publicClient: publicClient as never, deployment: net.deployment }),
    };
  }
  return clients;
}

/** Optimistic order ids → the on-chain slot the relayer reports once the order is placed. */
export const orderAliases = createStore<Record<number, number>>({});

export const liveAccount: Store<AccountState> = createStore<AccountState>({
  quote: 0,
  base: {},
  lockedQuote: 0,
  lockedBase: {},
  orders: {},
  fills: [],
});

const units = (s: string | bigint, decimals: number) => Number(BigInt(s)) / 10 ** decimals;

export class LiveMarket {
  readonly store: Store<MarketState>;
  readonly marketId: number;
  private subscribers = 0;
  private stop: (() => void) | null = null;
  private tickSize = 0n;
  private baseUnit = 1n;
  private quoteDecimals = 6;

  constructor(
    readonly spec: MarketSpec,
    readonly net: NetConfig,
  ) {
    this.marketId = net.deployment.markets[spec.symbol]!.id;
    const tick = Number(spec.seedPrice) / Number(spec.tickSize);
    const regime = regimeNow(spec, new Date());
    this.store = createStore<MarketState>({ spec, block: 0, refTick: tick, regime, lo: tick, hi: tick, book: [], prints: [], last: null, forming: 0 });
  }

  retain() {
    this.subscribers++;
    if (!this.stop) this.stop = this.start();
    return () => {
      this.subscribers--;
      if (this.subscribers <= 0 && this.stop) {
        this.stop();
        this.stop = null;
      }
    };
  }

  private toPrint(p: TapePrint): Print {
    const ref = this.tickSize > 0n ? Math.round(Number(BigInt(p.refPrice) / this.tickSize)) : p.tick;
    return { block: p.upTo, ts: p.ts, tick: p.tick, volume: units(p.volume, Math.log10(Number(this.baseUnit))), refTick: ref };
  }

  private applySummary(s: MarketSummary) {
    this.tickSize = BigInt(s.tickSize);
    this.baseUnit = BigInt(s.baseUnit);
    this.quoteDecimals = s.quoteDecimals;
    const refTick = s.ref ? Math.round(Number(BigInt(s.ref.price) / this.tickSize)) : this.store.get().refTick;
    const regime = regimeNow(this.spec, new Date());
    const name = s.halted ? "HALTED" : s.regime;
    const lp = s.lastPrint;
    const lastRef = lp ? Math.round(Number(BigInt(lp.refPrice) / this.tickSize)) : 0;
    const used = lp && lp.bandHi > 0 && lastRef > 0 ? Math.round(((lp.bandHi - lastRef) / lastRef) * 10_000) : null;
    const byName: Record<string, number> = {
      LIVE: this.spec.bandBps,
      EXTENDED: this.spec.regime.extBandBps,
      REOPENING: this.spec.regime.reopenBandBps,
      DISCOVERY: regime.bandBps,
      HALTED: 0,
    };
    // Fixed regimes show their nominal band (a print's edges are tick-rounded); DISCOVERY's widens with √t, so
    // the last print's is the truth there.
    const bandBps = name === "DISCOVERY" ? (used ?? regime.bandBps) : (byName[name] ?? used ?? regime.bandBps);
    const half = Math.max(1, Math.round((refTick * bandBps) / 10_000));
    this.store.set((m) => ({ ...m, refTick, regime: { ...regime, name, bandBps }, lo: refTick - half, hi: refTick + half }));
  }

  private start() {
    const { tape, chain } = liveClients(this.net);
    let alive = true;
    const load = async () => {
      const [summary, prints] = await Promise.all([tape.market(this.marketId), tape.prints(this.marketId, { limit: 600, traded: true })]);
      if (!alive) return;
      this.applySummary(summary);
      const list = prints.map((p) => this.toPrint(p)).reverse();
      this.store.set((m) => ({ ...m, prints: list, last: list.at(-1) ?? null, block: summary.lastPrint?.upTo ?? m.block }));
    };
    load().catch(() => undefined);

    // Pending orders (tape) and resting depth (chain) near the reference: the batch now forming.
    const refreshBook = async () => {
      const m = this.store.get();
      const span = 40;
      const [pending, bids, asks] = await Promise.all([
        tape.pending(this.marketId),
        chain.depthRange(BigInt(this.marketId), Side.BID, BigInt(m.refTick - span), BigInt(m.refTick + span)).catch(() => [] as readonly bigint[]),
        chain.depthRange(BigInt(this.marketId), Side.ASK, BigInt(m.refTick - span), BigInt(m.refTick + span)).catch(() => [] as readonly bigint[]),
      ]);
      if (!alive) return;
      const me = identity.get()?.account.toLowerCase();
      const decimals = Math.log10(Number(this.baseUnit));
      const book: BookOrder[] = pending.orders.map((o, i) => ({
        id: -(i + 1),
        side: o.side === 0 ? "buy" : "sell",
        tick: o.tick,
        qty: units(o.qty, decimals),
        owner: o.account.toLowerCase() === me ? "you" : "crowd",
        ioc: (o.flags & 1) === 1,
        placedBlock: o.batch,
      }));
      bids.forEach((q, i) => q > 0n && book.push({ id: -10_000 - i, side: "buy", tick: m.refTick - span + i, qty: units(q, decimals), owner: "crowd", ioc: false, placedBlock: 0 }));
      asks.forEach((q, i) => q > 0n && book.push({ id: -20_000 - i, side: "sell", tick: m.refTick - span + i, qty: units(q, decimals), owner: "crowd", ioc: false, placedBlock: 0 }));
      this.store.set((s) => ({ ...s, book }));
    };
    const bookTimer = setInterval(() => refreshBook().catch(() => undefined), 1500);
    const summaryTimer = setInterval(() => tape.market(this.marketId).then((s) => alive && this.applySummary(s)).catch(() => undefined), 10_000);

    const stream = tape.stream(["heads", `prints:${this.marketId}`], {
      head: (h) => this.store.set((m) => ({ ...m, block: h.block })),
      print: (p) => {
        if (p.marketId !== this.marketId || p.volume === "0") return;
        const pr = this.toPrint(p);
        this.store.set((m) => ({ ...m, prints: [...m.prints.slice(-899), pr], last: pr, refTick: pr.refTick }));
        void refreshAccount(this.net);
      },
    });
    return () => {
      alive = false;
      clearInterval(bookTimer);
      clearInterval(summaryTimer);
      stream.close();
    };
  }

  /** Signs (session key, or one Face ID) and relays an order. */
  async place(side: "buy" | "sell", tick: number, qty: number, ioc: boolean): Promise<MyOrder | { error: string }> {
    const id = identity.get();
    if (!id) return { error: "Sign in with a passkey first." };
    const { relayer } = liveClients(this.net);
    try {
      const order = buildOrder({
        account: id.account,
        marketId: BigInt(this.marketId),
        side: side === "buy" ? Side.BID : Side.ASK,
        tick,
        qty: BigInt(Math.round(qty * Number(this.baseUnit))),
        ioc,
      });
      const sig = await signAction(this.net, id, "Order", order);
      const { id: job } = await relayer.postOrder(order, sig);
      const placed: MyOrder = { id: Number(order.nonce % 1_000_000_000n), side, tick, qty, filled: 0, quote: 0, fee: 0, ioc, status: "pending", placedBlock: this.store.get().block, batches: [], locked: 0 };
      liveAccount.set((a) => ({ ...a, orders: { ...a.orders, [this.spec.ticker]: [placed, ...(a.orders[this.spec.ticker] ?? [])] } }));
      relayer
        .waitForJob(job)
        .then((j) => {
          const slot = j.result?.slot;
          if (slot !== undefined && slot !== null) orderAliases.set((a) => ({ ...a, [placed.id]: Number(slot) }));
          return refreshAccount(this.net);
        })
        .catch((e) => {
          liveAccount.set((a) => ({
            ...a,
            orders: { ...a.orders, [this.spec.ticker]: (a.orders[this.spec.ticker] ?? []).map((o) => (o.id === placed.id ? { ...o, status: "expired" } : o)) },
          }));
          console.warn(decodeUnisonError(e).message);
        });
      return placed;
    } catch (e) {
      return { error: decodeUnisonError(e).message };
    }
  }

  async cancel(slot: number) {
    const id = identity.get();
    if (!id) return;
    const { relayer } = liveClients(this.net);
    const c = buildCancel({ account: id.account, slot });
    const sig = await signAction(this.net, id, "Cancel", c);
    const { id: job } = await relayer.postCancel(c, sig);
    await relayer.waitForJob(job);
    await refreshAccount(this.net);
  }
}

/**
 * Ledger balances (chain) and orders with their per-auction fills (tape) for the signed-in account. Each fill is
 * one auction's uniform price, so a certificate always states a price that every order in that batch got.
 */
export async function refreshAccount(net: NetConfig) {
  const id = identity.get();
  if (!id) return;
  const { tape, chain } = liveClients(net);
  const tokens = net.deployment.tokens ?? {};
  const quoteToken = tokens.AUSD;
  const [quote, orders, ...bases] = await Promise.all([
    quoteToken ? chain.balanceOf(id.account, quoteToken.address as Address).catch(() => 0n) : Promise.resolve(0n),
    tape.orders(id.account, { status: "all" }).catch(() => null),
    ...Object.entries(tokens)
      .filter(([sym]) => sym !== "AUSD")
      .map(([sym, t]) => chain.balanceOf(id.account, t.address as Address).then((b) => [sym, units(b, t.decimals)] as const).catch(() => [sym, 0] as const)),
  ]);
  if (identity.get()?.account !== id.account) return; // signed out or switched while this was in flight
  const quoteDecimals = quoteToken?.decimals ?? 6;
  const symbolOf = (marketId: number) => Object.values(net.deployment.markets).find((m) => m.id === marketId)?.symbol.split("/")[0] ?? "?";
  const decOf = (sym: string) => tokens[sym]?.decimals ?? 18;
  const byTicker: Record<string, MyOrder[]> = {};
  const myFills: MyFill[] = [];
  for (const o of orders ?? []) {
    const t = symbolOf(o.marketId);
    const d = decOf(t);
    const tickSize = marketByTicker(t)?.tickSize ?? 10_000n;
    const qty = units(o.qty, d);
    const filled = units(o.filled, d);
    const side = o.side === 0 ? "buy" : "sell";
    const status: MyOrder["status"] =
      o.status === "pending" ? "pending" : o.status === "cancelled" ? "cancelled" : o.status === "open" ? (filled > 0 ? "partial" : "open") : filled >= qty - 1e-9 ? "filled" : filled > 0 ? "partial" : "expired";
    (byTicker[t] ??= []).push({
      id: o.slot,
      side,
      tick: o.tick,
      qty,
      filled,
      quote: units(o.quote, quoteDecimals),
      fee: units(o.fee, quoteDecimals),
      ioc: (o.flags & 1) === 1,
      status,
      settling: o.settling,
      placedBlock: o.batch,
      batches: o.fills.map((f) => f.upTo),
      locked: 0,
    });
    for (const f of o.fills) {
      myFills.push({
        orderId: o.slot,
        side,
        qty: units(f.qty, d),
        tick: f.tick,
        block: f.upTo,
        ts: f.ts,
        refTick: Math.round(Number(BigInt(f.refPrice)) / Number(tickSize)),
        batchVolume: units(f.volume, d),
        participants: 0,
        limitTick: o.tick,
        bandLo: f.bandLo,
        bandHi: f.bandHi,
        receipt: f.receiptHash,
      });
    }
  }
  myFills.sort((a, b) => b.block - a.block || b.orderId - a.orderId);
  liveAccount.set((a) => ({
    ...a,
    quote: units(quote, quoteDecimals),
    base: Object.fromEntries(bases),
    // keep what we had if the tape didn't answer this time
    ...(orders ? { orders: byTicker, fills: myFills } : {}),
  }));
}

/**
 * Keeps the signed-in account current: the tape pushes the account's orders, fills and transfers over SSE (one
 * refresh per burst), with a slow poll behind it for ledger changes the tape doesn't see.
 */
export function watchAccount(net: NetConfig) {
  let stream: { close: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watching: string | null = null;
  const soon = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void refreshAccount(net);
    }, 120);
  };
  const follow = () => {
    const account = identity.get()?.account ?? null;
    if (account === watching) return;
    watching = account;
    stream?.close();
    stream = null;
    if (!account) {
      liveAccount.set({ quote: 0, base: {}, lockedQuote: 0, lockedBase: {}, orders: {}, fills: [] });
      return;
    }
    stream = liveClients(net).tape.stream([`account:${account.toLowerCase()}`], { order: soon, fill: soon, transfer: soon, session: soon });
    void refreshAccount(net);
  };
  follow();
  const unsubscribe = identity.subscribe(follow);
  const poll = setInterval(() => void refreshAccount(net), 15_000);
  return () => {
    unsubscribe();
    clearInterval(poll);
    stream?.close();
  };
}

const live = new Map<string, LiveMarket>();
export function liveMarket(spec: MarketSpec, net: NetConfig): LiveMarket | null {
  if (!net.deployment.markets[spec.symbol]) return null;
  let m = live.get(spec.ticker);
  if (!m) {
    m = new LiveMarket(spec, net);
    live.set(spec.ticker, m);
  }
  return m;
}
