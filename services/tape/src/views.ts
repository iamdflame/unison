/**
 * API response shapes (docs/API.md) built from the store and the indexer's live state. Shared by the REST
 * handlers and the SSE account events, so both always say the same thing about an order.
 */
import type { MarketDeployment } from "@unison/sdk";
import type {
  AccountOrder,
  Fill,
  MarketSummary,
  PendingOrders,
  Receipt,
  ReferenceQuote,
  TapeSession,
  Transfer,
} from "@unison/sdk/tape";
import type { ClaimRow, SessionRow, TapeStore, TransferRow } from "./db.ts";
import {
  groupOrderEvents,
  orderFills,
  orderView,
  recomputeFill,
  toPrint,
  type MarketPricing,
  type OrderEvents,
} from "./derive.ts";

export interface MarketMeta extends MarketPricing {
  id: number;
  symbol: string;
  base: string;
  quote: string;
  vault: string | null;
  reference: MarketDeployment["reference"];
  baseDecimals: number;
  quoteDecimals: number;
  /** on-chain state when the tape started */
  lastClearedAtStart: number;
  statusAtStart: number;
  haltedAtStart: boolean;
}

/** What the API needs from the indexer besides the store. */
export interface TapeState {
  readonly chainId: number;
  readonly startBlock: number;
  readonly head: number;
  readonly indexed: number;
  readonly markets: ReadonlyMap<number, MarketMeta>;
  /** newest cleared batch (last indexed print, or the on-chain value at start) */
  lastCleared(marketId: number): number;
  halted(marketId: number): boolean;
  /** latest reference from the relay, when RELAY_URL is set and fresh */
  relayReference(marketId: number): ReferenceQuote | null;
}

const PRINT_SCAN = 500;

/** The auctions that can have filled an order: its first one for IOC, else every traded print its limit accepts. */
function auctionsFor(store: TapeStore, o: OrderEvents) {
  const p = o.placed;
  return (p.flags & 1) === 1
    ? store.printsFromUpTo(p.marketId, p.batch, 1)
    : store.crossingPrints(p.marketId, p.batch, p.side, p.tick, PRINT_SCAN);
}

export function viewOf(store: TapeStore, state: TapeState, o: OrderEvents): AccountOrder {
  const meta = state.markets.get(o.placed.marketId);
  return orderView(o, {
    ...(meta ? { pricing: meta } : {}),
    lastCleared: state.lastCleared(o.placed.marketId),
    prints: auctionsFor(store, o),
  });
}

/** The current (latest) order in a slot, with its events. */
export function slotOrder(store: TapeStore, account: string, marketId: number, slot: number): OrderEvents | undefined {
  const e = store.slotEvents(account, marketId, slot);
  const orders = groupOrderEvents(e.placed, e.claims, e.cancels);
  return orders[orders.length - 1];
}

export function accountOrders(store: TapeStore, state: TapeState, account: string, status: "open" | "all"): AccountOrder[] {
  const orders = groupOrderEvents(store.ordersPlaced(account), store.claims(account), store.cancels(account));
  const out: AccountOrder[] = [];
  for (let i = orders.length - 1; i >= 0; i--) {
    const v = viewOf(store, state, orders[i]!);
    if (status === "all" || v.status === "pending" || v.status === "open") out.push(v);
  }
  return out;
}

export function pendingOrders(store: TapeStore, state: TapeState, marketId: number): PendingOrders {
  const lastCleared = state.lastCleared(marketId);
  const placed = store.ordersPlacedAfterBatch(marketId, lastCleared);
  const cancels = store.cancelsByAccounts(marketId, [...new Set(placed.map((p) => p.account))]);
  return {
    lastCleared,
    orders: groupOrderEvents(placed, [], cancels)
      .filter((o) => !o.cancel)
      .map(({ placed: p }) => ({
        account: p.account,
        slot: p.slot,
        side: p.side as 0 | 1,
        tick: p.tick,
        qty: p.qty,
        flags: p.flags,
        batch: p.batch,
      })),
  };
}

export function receiptOf(
  store: TapeStore,
  state: TapeState,
  marketId: number,
  account: string,
  slot: number,
): Receipt | undefined {
  const o = slotOrder(store, account, marketId, slot);
  if (!o) return undefined;
  const meta = state.markets.get(marketId);
  const auctions = auctionsFor(store, o);
  const order = orderView(o, { ...(meta ? { pricing: meta } : {}), lastCleared: state.lastCleared(marketId), prints: auctions });
  const f = orderFills(o, auctions, meta?.baseUnit ?? 10n ** 18n);
  // the auctions that filled it, once each
  const prints = [...new Map(f.fills.map((x) => [`${x.print.block}:${x.print.logIndex}`, x.print])).values()];
  return {
    order,
    prints: prints.map(toPrint),
    verification: {
      chainOk: prints.every((p) => p.chainOk),
      recomputed: meta ? recomputeFill(order, f, meta.baseUnit) : null,
    },
  };
}

export function marketSummary(store: TapeStore, state: TapeState, m: MarketMeta, now = Date.now()): MarketSummary {
  const last = store.lastPrint(m.id);
  const lastTraded = store.lastPrint(m.id, true);
  const day = store.prints(m.id, { from: now - 86_400_000, traded: true, asc: true });
  const halted = state.halted(m.id);
  let ref = state.relayReference(m.id);
  if (!ref) {
    const accepted = store.lastReference(m.id);
    if (accepted && (!last || accepted.block > last.block || (accepted.block === last.block && accepted.logIndex > last.logIndex))) {
      ref = { price: accepted.price, publishTimeMs: accepted.publishTimeMs, status: accepted.status };
    } else if (last) {
      ref = { price: last.refPrice, publishTimeMs: last.refTimeMs, status: last.status };
    }
  }
  return {
    id: m.id,
    symbol: m.symbol,
    base: m.base,
    quote: m.quote,
    vault: m.vault,
    reference: m.reference,
    tickSize: m.tickSize.toString(),
    baseUnit: m.baseUnit.toString(),
    baseDecimals: m.baseDecimals,
    quoteDecimals: m.quoteDecimals,
    status: (last?.status ?? m.statusAtStart) as 0 | 1 | 2 | 3,
    regime: halted ? "HALTED" : ((last?.regime as MarketSummary["regime"] | undefined) ?? "LIVE"),
    halted,
    lastPrint: lastTraded ? toPrint(lastTraded) : null,
    auctions: store.printCount(m.id),
    ref,
    volume24h: day.reduce((a, p) => a + BigInt(p.volume), 0n).toString(),
    prints24h: day.length,
    open24h: day[0]?.price ?? null,
  };
}

export const fillOf = (c: ClaimRow): Fill => ({
  marketId: c.marketId,
  slot: c.slot,
  side: c.side as 0 | 1,
  baseAmount: c.baseAmount,
  quoteAmount: c.quoteAmount,
  fee: c.fee,
  done: c.done,
  tx: c.tx,
  block: c.block,
  ts: c.ts,
});

export const transferOf = (t: TransferRow): Transfer => ({
  kind: t.kind,
  token: t.token,
  amount: t.amount,
  counterparty: t.counterparty,
  tx: t.tx,
  ts: t.ts,
});

export const sessionOf = (s: SessionRow): TapeSession => ({
  key: s.key,
  expiry: s.expiry,
  maxQty: s.maxQty,
  maxNotional: s.maxNotional,
  marketMask: s.marketMask,
  tx: s.tx,
  ts: s.ts,
});

/** Latest grant per key, newest first. */
export function latestSessions(rows: readonly SessionRow[]): TapeSession[] {
  const byKey = new Map<string, SessionRow>();
  for (const r of rows) byKey.set(r.key, r);
  return [...byKey.values()].sort((a, b) => b.block - a.block || b.logIndex - a.logIndex).map(sessionOf);
}
