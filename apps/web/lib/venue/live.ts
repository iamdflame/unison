"use client";

import { buyLock } from "@unison/engine";
import { LightReader } from "@unison/sdk/light";
import { RelayerClient } from "@unison/sdk/relayer";
import { TapeClient, type MarketSummary, type Print as TapePrint } from "@unison/sdk/tape";
import { Side, Status } from "@unison/sdk/types";
import type { CurveQuote } from "@unison/sdk/light";
import type { Address } from "viem";
import { marketByTicker, type MarketSpec } from "../content/markets.ts";
import type { AccountState, BookOrder, MarketState, MyFill, MyOrder, Print } from "../demo/engine.ts";
import { createStore, type Store } from "../store/createStore.ts";
import { regimeNow } from "../unison/regimeNow.ts";
import { statusOfRegime } from "../unison/vaultCurve.ts";
import type { SimOrder } from "../sim/batch.ts";
import type { NetConfig } from "./config.ts";
import { describeError, identity, loadSigner } from "./identity.ts";

/**
 * Live venue: the same MarketState / AccountState the simulation produces, filled from the tape (prints, heads,
 * pending orders, account history over SSE), the chain (ledger balances, resting depth) and the relayer (every
 * action, gasless). Components can't tell the difference, which is the point.
 *
 * Watching costs no contract toolkit: the tape is fetch and SSE, and the two chain reads are hand-encoded
 * eth_calls (`LightReader`). The signing half loads when a signature is near (`identity.loadSigner`).
 */
let clients: { net: NetConfig; tape: TapeClient; relayer: RelayerClient; reader: LightReader } | null = null;
export function liveClients(net: NetConfig) {
  if (!clients || clients.net !== net) {
    clients = {
      net,
      tape: new TapeClient(net.tapeUrl),
      relayer: new RelayerClient(net.relayerUrl),
      reader: new LightReader(net.rpcUrl, net.deployment.exchange as Address),
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

/**
 * The vault's quote for the auction now forming, as the venue merges it: its on-chain curve, with bids capped by the
 * vault's AUSD on the ledger and asks by its base (a vault that holds no stock bids and doesn't offer).
 */
export function vaultOrders(c: CurveQuote, baseBal: bigint, quoteBal: bigint, tickSize: bigint, baseUnit: bigint, decimals: number): SimOrder[] {
  const out: SimOrder[] = [];
  let quoteLeft = quoteBal;
  for (let k = 0; c.bidTop > 0 && c.bidPerTick > 0n && k < c.bidTicks && quoteLeft > 0n; k++) {
    const tick = c.bidTop - k;
    if (tick <= 0) break;
    const price = BigInt(tick) * tickSize;
    const cost = (c.bidPerTick * price) / baseUnit;
    const qty = cost <= quoteLeft ? c.bidPerTick : (quoteLeft * baseUnit) / price;
    quoteLeft -= cost <= quoteLeft ? cost : quoteLeft;
    if (qty > 0n) out.push({ id: -30_000 - k, side: "buy", tick, qty: units(qty, decimals) });
  }
  let baseLeft = baseBal;
  for (let k = 0; c.askBottom > 0 && c.askPerTick > 0n && k < c.askTicks && baseLeft > 0n; k++) {
    const qty = c.askPerTick <= baseLeft ? c.askPerTick : baseLeft;
    baseLeft -= qty;
    out.push({ id: -40_000 - k, side: "sell", tick: c.askBottom + k, qty: units(qty, decimals) });
  }
  return out;
}

/**
 * The band, in bp, that produced a print's upper edge. The venue rounds the reference to the nearest tick and takes
 * half = ⌊refTick × bandBps / 10,000⌋ (ExchangeClearing._band), so the smallest whole bandBps giving that half is
 * ⌈half × 10,000 / refTick⌉. Null when the print carries no band.
 */
export function bandOfPrint(bandHi: number, refPrice: bigint, tickSize: bigint): number | null {
  if (tickSize <= 0n) return null;
  const refTick = Number((refPrice + tickSize / 2n) / tickSize);
  const half = bandHi - refTick;
  return refTick > 0 && half > 0 ? Math.ceil((half * 10_000) / refTick) : null;
}

export class LiveMarket {
  readonly store: Store<MarketState>;
  readonly marketId: number;
  private subscribers = 0;
  private bookSubscribers = 0;
  private stop: (() => void) | null = null;
  private stopBook: (() => void) | null = null;
  private tickSize = 0n;
  private baseUnit = 1n;
  private quoteDecimals = 6;
  /** the tape has answered once: until then the block stays 0, which the terminal reads as "no real price yet" */
  private loaded = false;
  /** a push-feed market whose reference this page reads itself, fresher than the tape's last print */
  private liveRef = false;
  /**
   * The band the venue last used in each fixed regime, read back from its prints. It is the market's own on-chain
   * parameter, which can change (WMON's moved from ±200 to ±50 bp at the causal cutover); the static spec is only the
   * fallback until a print shows it.
   */
  private usedBand: Partial<Record<MarketState["regime"]["name"], number>> = {};

  constructor(
    readonly spec: MarketSpec,
    readonly net: NetConfig,
  ) {
    this.marketId = net.deployment.markets[spec.symbol]!.id;
    const tick = Number(spec.seedPrice) / Number(spec.tickSize);
    const regime = regimeNow(spec, new Date());
    const causal = net.deployment.markets[spec.symbol]?.reference === "chainlink-causal";
    this.store = createStore<MarketState>({ spec, block: 0, refTick: tick, regime, lo: tick, hi: tick, book: [], prints: [], last: null, forming: 0, lastAuction: 0, vault: [], bookLoaded: false, causal });
  }

  /** Reference-counted. Lists retain without the book (`book: false`): only the terminal polls depth. */
  retain(opts: { book?: boolean } = {}) {
    const book = opts.book !== false;
    this.subscribers++;
    if (book) this.bookSubscribers++;
    if (!this.stop) this.stop = this.start();
    if (book && !this.stopBook) this.stopBook = this.startBook();
    return () => {
      this.subscribers--;
      if (book) this.bookSubscribers--;
      if (this.bookSubscribers <= 0 && this.stopBook) {
        this.stopBook();
        this.stopBook = null;
      }
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
    // the chain's own reading wins over the last print's (a halt still shows, which the adapter can't know)
    if (this.liveRef && !s.halted) return;
    const refTick = s.ref ? Math.round(Number(BigInt(s.ref.price) / this.tickSize)) : this.store.get().refTick;
    const regime = regimeNow(this.spec, new Date());
    const name = s.halted ? "HALTED" : s.regime;
    const lp = s.lastPrint;
    const lastRef = lp ? Math.round(Number(BigInt(lp.refPrice) / this.tickSize)) : 0;
    const used = lp && lp.bandHi > 0 && lastRef > 0 ? Math.round(((lp.bandHi - lastRef) / lastRef) * 10_000) : null;
    if (lp && lp.regime !== "DISCOVERY") {
      const b = bandOfPrint(lp.bandHi, BigInt(lp.refPrice), this.tickSize);
      if (b !== null) this.usedBand[lp.regime as MarketState["regime"]["name"]] = b;
    }
    const byName: Record<string, number> = {
      LIVE: this.usedBand.LIVE ?? this.spec.bandBps,
      EXTENDED: this.usedBand.EXTENDED ?? this.spec.regime.extBandBps,
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
    const { tape } = liveClients(this.net);
    let alive = true;
    const load = async () => {
      const [summary, prints] = await Promise.all([tape.market(this.marketId), tape.prints(this.marketId, { limit: 600, traded: true })]);
      if (!alive) return;
      this.applySummary(summary);
      this.loaded = true;
      const list = prints.map((p) => this.toPrint(p)).reverse();
      this.store.set((m) => ({ ...m, prints: list, last: list.at(-1) ?? null, block: summary.lastPrint?.upTo ?? Math.max(m.block, 1), lastAuction: Math.max(m.lastAuction, summary.lastPrint?.upTo ?? 0) }));
    };
    load().catch(() => undefined);

    const summaryTimer = setInterval(() => tape.market(this.marketId).then((s) => alive && this.applySummary(s)).catch(() => undefined), 10_000);

    const stream = tape.stream(["heads", `prints:${this.marketId}`], {
      head: (h) => this.loaded && this.store.set((m) => ({ ...m, block: h.block })),
      print: (p) => {
        if (p.marketId !== this.marketId) return;
        // every auction, traded or not, restarts the count to the next one
        this.store.set((m) => (p.upTo > m.lastAuction ? { ...m, lastAuction: p.upTo } : m));
        if (p.volume === "0") return;
        const pr = this.toPrint(p);
        this.store.set((m) => ({ ...m, prints: [...m.prints.slice(-899), pr], last: pr, refTick: pr.refTick }));
        // An order waiting on this batch changes state with the print, not with an account event.
        if (this.bookSubscribers > 0 && awaitingClear()) void refreshAccount(this.net);
      },
    });
    return () => {
      alive = false;
      clearInterval(summaryTimer);
      stream.close();
    };
  }

  /** Pending orders (tape) and resting depth (chain) near the reference: the batch now forming. */
  private startBook() {
    const { tape, reader } = liveClients(this.net);
    const dep = this.net.deployment.markets[this.spec.symbol];
    const vaultAddr = dep?.vault as Address | undefined;
    // A push-feed market's reference moves without a print (the tape knows it only from the last trade): read it the
    // way the venue does when it clears, so the band, the vault's quote and the ticket match the next auction.
    // a causal market (SPEC §7.4) reads its causal adapter: the latest observation, stamped with Chainlink's own time
    const pushRef =
      dep?.reference === "chainlink"
        ? (this.net.deployment.chainlinkReference as Address | undefined)
        : dep?.reference === "chainlink-causal"
          ? (this.net.deployment.causalReference as Address | undefined)
          : undefined;
    const causal = dep?.reference === "chainlink-causal";
    const NAME: Record<number, MarketState["regime"]["name"]> = { 0: "LIVE", 1: "EXTENDED", 2: "DISCOVERY", 3: "HALTED" };
    let alive = true;
    const refreshBook = async () => {
      if (pushRef && this.tickSize > 0n) {
        const r = await reader.reference(pushRef, BigInt(this.marketId)).catch(() => null);
        if (r && r.price > 0n && alive) {
          this.liveRef = true;
          const refTick = Math.round(Number(r.price / this.tickSize));
          const name = NAME[r.status] ?? this.store.get().regime.name;
          const bandBps =
            name === "LIVE"
              ? (this.usedBand.LIVE ?? this.spec.bandBps)
              : name === "EXTENDED"
                ? (this.usedBand.EXTENDED ?? this.spec.regime.extBandBps)
                : name === "HALTED"
                  ? 0
                  : this.store.get().regime.bandBps;
          const half = Math.max(1, Math.round((refTick * bandBps) / 10_000));
          const refAt = causal ? Number(r.publishTimeMs) : undefined;
          this.store.set((s) => ({ ...s, refTick, regime: { ...s.regime, name, bandBps }, lo: refTick - half, hi: refTick + half, ...(refAt ? { refAt } : {}) }));
        }
      }
      const m = this.store.get();
      const span = 40;
      // the vault's curve for the reference the next auction would use, and what it holds to back it
      const vaultRead =
        vaultAddr && dep && m.refTick > 0 && this.tickSize > 0n
          ? Promise.all([
              reader.curve(vaultAddr, BigInt(this.marketId), BigInt(m.refTick) * this.tickSize, Status[statusOfRegime(m.regime.name)], BigInt(m.refTick), BigInt(Math.max(0, m.lo)), BigInt(Math.max(0, m.hi))),
              reader.balanceOf(vaultAddr, dep.base as Address),
              reader.balanceOf(vaultAddr, dep.quote as Address),
            ]).catch(() => null)
          : Promise.resolve(null);
      const [pending, bids, asks, vq] = await Promise.all([
        tape.pending(this.marketId),
        reader.depthRange(BigInt(this.marketId), Side.BID, BigInt(m.refTick - span), BigInt(m.refTick + span)).catch(() => [] as bigint[]),
        reader.depthRange(BigInt(this.marketId), Side.ASK, BigInt(m.refTick - span), BigInt(m.refTick + span)).catch(() => [] as bigint[]),
        vaultRead,
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
      const vault = vq ? vaultOrders(vq[0], vq[1], vq[2], this.tickSize, this.baseUnit, decimals) : [];
      // loaded once the vault's quote is in too (the first refresh can run before the tick size is known), so a
      // ticket never opens on a book that is missing its main quote
      this.store.set((s) => ({ ...s, book, vault, forming: pending.orders.length, bookLoaded: s.bookLoaded || !vaultAddr || vq !== null }));
    };
    refreshBook().catch(() => undefined);
    const bookTimer = setInterval(() => refreshBook().catch(() => undefined), 1500);
    return () => {
      alive = false;
      clearInterval(bookTimer);
    };
  }

  /** Signs (session key, or one Face ID) and relays an order. */
  async place(side: "buy" | "sell", tick: number, qty: number, ioc: boolean): Promise<MyOrder | { error: string }> {
    if (!identity.get()) return { error: "Sign in with a passkey first." };
    const { relayer } = liveClients(this.net);
    try {
      const { relayOrder } = await loadSigner();
      // a causal market takes auction orders only, and a relayer may hold its signature for at most 60 s
      const causal = !!this.store.get().causal;
      if (causal) ioc = true;
      const amount = BigInt(Math.round(qty * Number(this.baseUnit)));
      const { job, nonce } = await relayOrder(this.net, {
        marketId: this.marketId,
        side,
        tick,
        qty: amount,
        ioc,
        ...(causal ? { ttlSeconds: 60 } : {}),
      });
      const placed: MyOrder = { id: Number(nonce % 1_000_000_000n), side, tick, qty, filled: 0, quote: 0, fee: 0, ioc, status: "pending", placedBlock: this.store.get().block, batches: [], locked: 0 };
      // What the order holds leaves the free balance now, as it will on chain: until the account reloads, the ticket
      // must not offer it again. A bid holds its notional at the limit plus the fee cap, an ask its base.
      const ticker = this.spec.ticker;
      const quoteDecimals = this.net.deployment.tokens?.AUSD?.decimals ?? 6;
      const bid = side === "buy" && this.tickSize > 0n ? units(buyLock(amount, BigInt(tick) * this.tickSize, BigInt(this.spec.maxFeeBps), this.baseUnit), quoteDecimals) : 0;
      liveAccount.set((a) => ({
        ...a,
        ...(side === "buy"
          ? { quote: Math.max(0, a.quote - bid), lockedQuote: a.lockedQuote + bid }
          : { base: { ...a.base, [ticker]: Math.max(0, (a.base[ticker] ?? 0) - qty) }, lockedBase: { ...a.lockedBase, [ticker]: (a.lockedBase[ticker] ?? 0) + qty } }),
        orders: { ...a.orders, [ticker]: [placed, ...(a.orders[ticker] ?? [])] },
      }));
      relayer
        .waitForJob(job)
        .then((j) => {
          const slot = j.result?.slot;
          if (slot !== undefined && slot !== null) orderAliases.set((a) => ({ ...a, [placed.id]: Number(slot) }));
          return refreshAccount(this.net);
        })
        .catch(async (e: unknown) => {
          liveAccount.set((a) => ({
            ...a,
            orders: { ...a.orders, [ticker]: (a.orders[ticker] ?? []).map((o) => (o.id === placed.id ? { ...o, status: "expired" } : o)) },
          }));
          // the chain's balances replace the hold taken above
          void refreshAccount(this.net);
          console.warn(await describeError(e).catch(() => e));
        });
      return placed;
    } catch (e) {
      return { error: await describeError(e).catch(() => (e instanceof Error ? e.message : "The order could not be sent.")) };
    }
  }

  async cancel(slot: number) {
    if (!identity.get()) return;
    const { relayCancel } = await loadSigner();
    await relayCancel(this.net, slot);
    await refreshAccount(this.net);
  }
}

const awaitingClear = () => Object.values(liveAccount.get().orders).some((list) => list.some((o) => o.status === "pending" || o.settling));

let inflight: Promise<void> | null = null;
let again = false;
/** Refreshes the account; calls during a refresh coalesce into one more after it. */
export function refreshAccount(net: NetConfig): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = loadAccount(net).finally(() => {
    inflight = null;
    if (again) {
      again = false;
      void refreshAccount(net);
    }
  });
  return inflight;
}

/**
 * Ledger balances (chain) and orders with their per-auction fills (tape) for the signed-in account. Each fill is
 * one auction's uniform price, so a certificate always states a price that every order in that batch got.
 */
async function loadAccount(net: NetConfig) {
  const id = identity.get();
  if (!id) return;
  const { tape, reader } = liveClients(net);
  const tokens = net.deployment.tokens ?? {};
  const quoteToken = tokens.AUSD;
  const [quote, orders, ...bases] = await Promise.all([
    quoteToken ? reader.balanceOf(id.account, quoteToken.address as Address).catch(() => 0n) : Promise.resolve(0n),
    tape.orders(id.account, { status: "all" }).catch(() => null),
    ...Object.entries(tokens)
      .filter(([sym]) => sym !== "AUSD")
      .map(([sym, t]) => reader.balanceOf(id.account, t.address as Address).then((b) => [sym, units(b, t.decimals)] as const).catch(() => [sym, 0] as const)),
  ]);
  if (identity.get()?.account !== id.account) return; // signed out or switched while this was in flight
  const quoteDecimals = quoteToken?.decimals ?? 6;
  const symbolOf = (marketId: number) => Object.values(net.deployment.markets).find((m) => m.id === marketId)?.symbol.split("/")[0] ?? "?";
  const decOf = (sym: string) => tokens[sym]?.decimals ?? 18;
  const byTicker: Record<string, MyOrder[]> = {};
  const myFills: MyFill[] = [];
  let lockedQuote = 0n;
  const lockedBase: Record<string, number> = {};
  for (const o of orders ?? []) {
    const t = symbolOf(o.marketId);
    const d = decOf(t);
    const spec = marketByTicker(t);
    const tickSize = spec?.tickSize ?? 10_000n;
    // Funds an order holds until it is done: a bid its whole lock (notional at the limit plus the fee cap, settled
    // at its final claim), an ask its unsold base.
    if (o.status === "pending" || o.status === "open") {
      if (o.side === 0) lockedQuote += buyLock(BigInt(o.qty), BigInt(o.tick) * tickSize, BigInt(spec?.maxFeeBps ?? 10), 10n ** BigInt(d));
      else lockedBase[t] = (lockedBase[t] ?? 0) + units(BigInt(o.qty) - BigInt(o.filled), d);
    }
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
        ticker: t,
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
        orderQty: qty,
        // a call auction while the market was closed: the certificate names the last close and the cadence
        ...(f.regime === "DISCOVERY" ? { closed: true } : {}),
      });
    }
  }
  myFills.sort((a, b) => b.block - a.block || b.orderId - a.orderId);
  liveAccount.set((a) => ({
    ...a,
    quote: units(quote, quoteDecimals),
    base: Object.fromEntries(bases),
    ...(orders ? { lockedQuote: units(lockedQuote, quoteDecimals), lockedBase } : {}),
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
