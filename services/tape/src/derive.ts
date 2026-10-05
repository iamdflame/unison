/**
 * Pure derivations over stored rows: regimes, the receipt hash chain, order lifecycle, candles, fairness and
 * vault series. No I/O, so every rule here is unit-tested directly.
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { bpsDiff, Status } from "@unison/sdk";
import type {
  AccountOrder,
  OrderFill,
  Candle,
  Fairness,
  OrderStatus,
  Print,
  RegimeName,
  VaultFlow,
  VaultPoint,
} from "@unison/sdk/tape";
import { buyLock } from "@unison/engine";
import type { ClaimRow, OrderCancelledRow, OrderPlacedRow, PrintRow, VaultEventRow, VaultSnapshotRow } from "./db.ts";

export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

/**
 * Regime of a print (SPEC §6), from its status, band and the previous print's status (`Market.lastStatus` at
 * the time, as `_regimeBandBps` reads it).
 */
export function regimeOf(status: number, bandLo: number, bandHi: number, prevStatus: number): RegimeName {
  if ((bandLo === 0 && bandHi === 0) || status === Status.HALTED) return "HALTED";
  if (status === Status.CLOSED) return "DISCOVERY";
  const wasClosed = prevStatus === Status.CLOSED || prevStatus === Status.HALTED;
  if (wasClosed && (status === Status.OPEN || status === Status.EXTENDED)) return "REOPENING";
  if (status === Status.EXTENDED) return "EXTENDED";
  return "LIVE";
}

/**
 * The receipt hash exactly as `ExchangeClearing._finalize` computes it:
 * keccak256(abi.encode(prev, marketId, upTo, tick, volume, refPrice, refTimeMs, status, block.timestamp)),
 * where block.timestamp is that of the block holding the BatchCleared log.
 */
export function receiptHash(
  prev: Hex,
  p: { marketId: number; upTo: number; tick: number; volume: string; refPrice: string; refTimeMs: number; status: number },
  blockTimestamp: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint8" },
        { type: "uint256" },
      ],
      [
        prev,
        BigInt(p.marketId),
        BigInt(p.upTo),
        BigInt(p.tick),
        BigInt(p.volume),
        BigInt(p.refPrice),
        BigInt(p.refTimeMs),
        p.status,
        BigInt(blockTimestamp),
      ],
    ),
  );
}

/** (price − ref) / ref in bp (2 decimals), null when nothing traded. */
export function deviationBps(price: string, refPrice: string, volume: string): number | null {
  if (volume === "0" || refPrice === "0") return null;
  return bpsDiff(BigInt(price), BigInt(refPrice));
}

/** Derived fields of a print given the previous print of its market (undefined = the market's first). */
export function derivePrint(
  p: Omit<PrintRow, "prevReceiptHash" | "chainOk" | "regime" | "deviationBps">,
  prev: { receiptHash: string; status: number } | undefined,
  anchor: { receiptHash: string; status: number } = { receiptHash: ZERO_HASH, status: Status.OPEN },
): Pick<PrintRow, "prevReceiptHash" | "chainOk" | "regime" | "deviationBps"> {
  const before = prev ?? anchor;
  const prevReceiptHash = before.receiptHash.toLowerCase();
  const recomputed = receiptHash(prevReceiptHash as Hex, p, Math.floor(p.ts / 1000));
  return {
    prevReceiptHash,
    chainOk: recomputed.toLowerCase() === p.receiptHash.toLowerCase(),
    regime: regimeOf(p.status, p.bandLo, p.bandHi, before.status),
    deviationBps: deviationBps(p.price, p.refPrice, p.volume),
  };
}

export const toPrint = (r: PrintRow): Print => ({
  marketId: r.marketId,
  upTo: r.upTo,
  block: r.block,
  tx: r.tx,
  logIndex: r.logIndex,
  ts: r.ts,
  tick: r.tick,
  price: r.price,
  volume: r.volume,
  refPrice: r.refPrice,
  refTimeMs: r.refTimeMs,
  status: r.status,
  regime: r.regime as RegimeName,
  bandLo: r.bandLo,
  bandHi: r.bandHi,
  receiptHash: r.receiptHash,
  prevReceiptHash: r.prevReceiptHash,
  chainOk: r.chainOk,
  deviationBps: r.deviationBps,
});

const CSV_COLUMNS = [
  "marketId",
  "upTo",
  "block",
  "tx",
  "logIndex",
  "ts",
  "tick",
  "price",
  "volume",
  "refPrice",
  "refTimeMs",
  "status",
  "regime",
  "bandLo",
  "bandHi",
  "receiptHash",
  "prevReceiptHash",
  "chainOk",
  "deviationBps",
] as const satisfies readonly (keyof Print)[];

export function printsCsv(prints: readonly Print[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of prints) lines.push(CSV_COLUMNS.map((c) => (p[c] === null ? "" : String(p[c]))).join(","));
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------- candles

export const RESOLUTION_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
} as const;

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** OHLCV from traded prints (any order); `n` counts prints. */
export function buildCandles(prints: readonly PrintRow[], resMs: number): Candle[] {
  const sorted = prints.filter((p) => p.volume !== "0").sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const out: Candle[] = [];
  let cur: { t: number; o: bigint; h: bigint; l: bigint; c: bigint; v: bigint; n: number } | undefined;
  const flush = () => {
    if (cur) out.push({ t: cur.t, o: `${cur.o}`, h: `${cur.h}`, l: `${cur.l}`, c: `${cur.c}`, v: `${cur.v}`, n: cur.n });
  };
  for (const p of sorted) {
    const t = Math.floor(p.ts / resMs) * resMs;
    const px = BigInt(p.price);
    if (!cur || cur.t !== t) {
      flush();
      cur = { t, o: px, h: px, l: px, c: px, v: 0n, n: 0 };
    }
    cur.h = max(cur.h, px);
    cur.l = min(cur.l, px);
    cur.c = px;
    cur.v += BigInt(p.volume);
    cur.n += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------- fairness

export const FAIRNESS_WINDOW_MS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 } as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function fairness(prints: readonly PrintRow[]): Fairness {
  const traded = prints.filter((p) => p.volume !== "0");
  const devs = traded
    .map((p) => p.deviationBps)
    .filter((d): d is number => d !== null)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const lags = prints
    .filter((p) => p.closeTs !== null)
    .map((p) => p.refTimeMs - p.closeTs! * 1000)
    .sort((a, b) => a - b);
  const histogram = Array.from({ length: 101 }, (_, i) => ({ bps: i - 50, count: 0 }));
  for (const p of traded) {
    if (p.deviationBps === null) continue;
    const b = Math.max(-50, Math.min(50, Math.round(p.deviationBps)));
    histogram[b + 50]!.count += 1;
  }
  const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    batches: prints.length,
    traded: traded.length,
    volume: traded.reduce((a, p) => a + BigInt(p.volume), 0n).toString(),
    meanAbsDevBps: round2(mean(devs)),
    p95AbsDevBps: round2(percentile(devs, 95)),
    maxAbsDevBps: round2(devs.length ? devs[devs.length - 1]! : 0),
    meanRefLagMs: Math.round(mean(lags)),
    p95RefLagMs: Math.round(percentile(lags, 95)),
    chainOk: prints.every((p) => p.chainOk),
    histogram,
  };
}

// ---------------------------------------------------------------------------------------------- orders

export interface MarketPricing {
  tickSize: bigint;
  baseUnit: bigint;
  maxFeeBps: bigint;
}

type Pos = { block: number; logIndex: number };
const cmpPos = (a: Pos, b: Pos) => a.block - b.block || a.logIndex - b.logIndex;
const slotKey = (account: string, marketId: number, slot: number) => `${account}:${marketId}:${slot}`;

export interface OrderEvents {
  placed: OrderPlacedRow;
  claims: ClaimRow[];
  cancel?: OrderCancelledRow;
}

/**
 * Slots are reused once an order is done, so each Claimed / OrderCancelled belongs to the latest placement in
 * the same (account, market, slot) that precedes it.
 */
export function groupOrderEvents(
  placed: readonly OrderPlacedRow[],
  claims: readonly ClaimRow[],
  cancels: readonly OrderCancelledRow[],
): OrderEvents[] {
  const bySlot = new Map<string, OrderEvents[]>();
  const orders = [...placed].sort(cmpPos).map((p) => ({ placed: p, claims: [] as ClaimRow[] }) as OrderEvents);
  for (const o of orders) {
    const k = slotKey(o.placed.account, o.placed.marketId, o.placed.slot);
    bySlot.set(k, [...(bySlot.get(k) ?? []), o]);
  }
  const owner = (e: Pos & { account: string; marketId: number; slot: number }) => {
    const list = bySlot.get(slotKey(e.account, e.marketId, e.slot)) ?? [];
    let found: OrderEvents | undefined;
    for (const o of list) if (cmpPos(o.placed, e) < 0) found = o;
    return found;
  };
  for (const c of [...claims].sort(cmpPos)) owner(c)?.claims.push(c);
  for (const c of [...cancels].sort(cmpPos)) {
    const o = owner(c);
    if (o && !o.cancel) o.cancel = c;
  }
  return orders;
}

/** Position of the event that ended the order (its final claim or its cancel), if any. */
export function endOf(o: OrderEvents): Pos | undefined {
  const done = o.claims.find((c) => c.done);
  if (done && o.cancel) return cmpPos(done, o.cancel) < 0 ? done : o.cancel;
  return done ?? o.cancel;
}

/**
 * The traded auctions that may have filled an order: prints from its batch on, before it ended, at a price its
 * limit accepts. An IOC order lives for one auction. `prints` are the market's prints with upTo >= batch, oldest
 * first. A price better than the limit is not a full fill: an order that is the marginal one on the long side is
 * rationed and keeps joining later auctions. Claims say what it actually received (orderFills).
 */
export function fillingPrints(o: OrderEvents, prints: readonly PrintRow[]): PrintRow[] {
  const p = o.placed;
  const end = endOf(o);
  const isBid = p.side === 0;
  const out: PrintRow[] = [];
  for (const pr of prints) {
    if (pr.upTo < p.batch) continue;
    if (end && cmpPos(pr, end) > 0) break;
    if (pr.volume !== "0" && (isBid ? pr.tick <= p.tick : pr.tick >= p.tick)) out.push(pr);
    if ((p.flags & 1) === 1) break;
  }
  return out;
}

export interface OrderFillRow {
  print: PrintRow;
  /** base units received in this auction */
  qty: bigint;
  /** false when one claim paid out several auctions and this one's share is apportioned by volume */
  exact: boolean;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * What each auction gave an order, read from its claims. The keeper claims after every clear, so a claim pays out
 * the order's crossing auctions since the previous claim: bids receive the base they bought, asks the gross quote
 * they sold for (net + fee). One auction in that window: exact. Several: the claim is apportioned by auction
 * volume and marked inexact. `settling`: an auction after the last claim crossed the order, so a fill is on its
 * way. `unattributed`: a claim paid out with no crossing auction in view (prints missing from the scan).
 */
export function orderFills(
  o: OrderEvents,
  prints: readonly PrintRow[],
  unit: bigint,
): { fills: OrderFillRow[]; settling: boolean; unattributed: boolean } {
  const isBid = o.placed.side === 0;
  const candidates = fillingPrints(o, prints);
  const fills: OrderFillRow[] = [];
  let unattributed = false;
  let i = 0;
  for (const c of o.claims) {
    const amount = isBid ? BigInt(c.baseAmount) : BigInt(c.quoteAmount) + BigInt(c.fee);
    const window: PrintRow[] = [];
    while (i < candidates.length && cmpPos(candidates[i]!, c) < 0) window.push(candidates[i++]!);
    if (amount === 0n) continue;
    if (window.length === 0) {
      unattributed = true;
      continue;
    }
    const total = window.reduce((a, pr) => a + BigInt(pr.volume), 0n);
    let left = amount;
    window.forEach((pr, k) => {
      const share = k === window.length - 1 ? left : (amount * BigInt(pr.volume)) / total;
      left -= share;
      if (share === 0n) return;
      fills.push({ print: pr, qty: isBid ? share : ceilDiv(share * unit, BigInt(pr.price)), exact: window.length === 1 });
    });
  }
  return { fills, settling: i < candidates.length, unattributed };
}

/**
 * The account-facing view of one order. Amounts come from its Claimed events (the keeper auto-claims every
 * block): bids receive base as they fill and settle quote (refund, fee) when done; asks receive gross quote as
 * they fill and get their unfilled base back when done. Until an order is done, a bid's quote and an ask's filled
 * base come from its per-auction fills at each auction's uniform price.
 */
export function orderView(
  o: OrderEvents,
  ctx: { pricing?: MarketPricing; lastCleared: number; prints: readonly PrintRow[] },
): AccountOrder {
  const p = o.placed;
  const qty = BigInt(p.qty);
  const doneClaim = o.claims.find((c) => c.done);
  let status: OrderStatus = "open";
  if (o.cancel) status = "cancelled";
  else if (doneClaim) status = "closed";
  else if (p.batch > ctx.lastCleared) status = "pending";

  const base = o.claims.reduce((a, c) => a + BigInt(c.baseAmount), 0n);
  const quoteAmt = o.claims.reduce((a, c) => a + BigInt(c.quoteAmount), 0n);
  const fee = o.claims.reduce((a, c) => a + BigInt(c.fee), 0n);
  const unit = ctx.pricing?.baseUnit ?? 10n ** 18n;
  const settled = doneClaim !== undefined;
  const { fills, settling } = orderFills(o, ctx.prints, unit);

  let filled: bigint;
  let quote: bigint;
  if (p.side === 0) {
    filled = base;
    if (settled && ctx.pricing) {
      const lock = buyLock(qty, BigInt(p.tick) * ctx.pricing.tickSize, ctx.pricing.maxFeeBps, ctx.pricing.baseUnit);
      quote = lock - quoteAmt - fee;
      if (quote < 0n) quote = 0n;
    } else {
      quote = fills.reduce((a, f) => a + ceilDiv(f.qty * BigInt(f.print.price), unit), 0n);
    }
  } else {
    quote = quoteAmt + fee;
    filled = settled ? qty - base : fills.reduce((a, f) => a + f.qty, 0n);
    if (filled > qty) filled = qty;
    if (filled < 0n) filled = 0n;
  }
  return {
    marketId: p.marketId,
    slot: p.slot,
    side: p.side as 0 | 1,
    tick: p.tick,
    qty: p.qty,
    flags: p.flags,
    batch: p.batch,
    placedTx: p.tx,
    placedTs: p.ts,
    status,
    filled: filled.toString(),
    quote: quote.toString(),
    fee: fee.toString(),
    avgPrice: filled > 0n && quote > 0n ? ((quote * unit) / filled).toString() : null,
    claims: o.claims.map((c) => ({
      tx: c.tx,
      ts: c.ts,
      baseAmount: c.baseAmount,
      quoteAmount: c.quoteAmount,
      fee: c.fee,
      done: c.done,
    })),
    fills: fills.map(toOrderFill),
    settling: settling && !settled && !o.cancel,
  };
}

export const toOrderFill = (f: OrderFillRow): OrderFill => ({
  upTo: f.print.upTo,
  block: f.print.block,
  ts: f.print.ts,
  tick: f.print.tick,
  price: f.print.price,
  qty: f.qty.toString(),
  volume: f.print.volume,
  refPrice: f.print.refPrice,
  bandLo: f.print.bandLo,
  bandHi: f.print.bandHi,
  receiptHash: f.print.receiptHash,
  regime: f.print.regime,
  exact: f.exact,
});

/**
 * Recomputes a settled order's exchange from the uniform prices of the auctions that filled it. Bids: what it
 * paid must equal Σ qty × price / baseUnit, rounded up per auction. Asks: its fills plus the base returned must
 * add up to the order. Each within the valuation's rounding (≤ 3 units per auction). null when it can't be
 * checked (not settled, nothing filled, a claim that covered several auctions, or prints missing from view).
 */
export function recomputeFill(
  view: AccountOrder,
  f: { fills: readonly OrderFillRow[]; unattributed: boolean },
  baseUnit: bigint,
): boolean | null {
  if (view.status !== "closed" && view.status !== "cancelled") return null;
  const filled = BigInt(view.filled);
  if (filled === 0n || f.fills.length === 0 || f.unattributed || f.fills.some((x) => !x.exact)) return null;
  if (filled > BigInt(view.qty)) return false;
  const n = BigInt(f.fills.length);
  const sumQty = f.fills.reduce((a, x) => a + x.qty, 0n);
  if (view.side === 0) {
    const paid = f.fills.reduce((a, x) => a + ceilDiv(x.qty * BigInt(x.print.price), baseUnit), 0n);
    const diff = BigInt(view.quote) - paid;
    return sumQty === filled && diff >= -3n * n && diff <= 3n * n;
  }
  // an ask's per-auction qty is its gross quote over the price, so it can sit one price step off the truth
  const slack = f.fills.reduce((a, x) => a + baseUnit / BigInt(x.print.price) + 1n, 0n);
  const diff = sumQty - filled;
  return diff >= -slack && diff <= slack;
}

// ---------------------------------------------------------------------------------------------- vaults

/** Last snapshot per `resMs` bucket. */
export function vaultPoints(snaps: readonly VaultSnapshotRow[], resMs: number): VaultPoint[] {
  const byBucket = new Map<number, VaultSnapshotRow>();
  for (const s of [...snaps].sort((a, b) => a.t - b.t)) byBucket.set(Math.floor(s.t / resMs) * resMs, s);
  return [...byBucket.entries()].map(([t, s]) => {
    const supply = BigInt(s.supply);
    return {
      t,
      nav: s.nav,
      supply: s.supply,
      sharePrice: supply === 0n ? "0" : ((BigInt(s.nav) * 10n ** BigInt(s.decimals)) / supply).toString(),
      spreadPnl: s.spreadPnl,
      inventoryPnl: s.inventoryPnl,
      base: s.base,
      quote: s.quote,
    };
  });
}

/** Requests joined with their executions, newest request first. */
export function vaultFlows(events: readonly VaultEventRow[]): VaultFlow[] {
  const flows = new Map<number, VaultFlow>();
  for (const e of [...events].sort(cmpPos)) {
    if (e.event === "DepositRequested" || e.event === "RedeemRequested") {
      flows.set(e.requestId, {
        id: e.requestId,
        owner: e.owner,
        kind: e.event === "DepositRequested" ? "deposit" : "redeem",
        amount: e.amount ?? "0",
        requestedTx: e.tx,
        requestedTs: e.ts,
        executed: null,
      });
      continue;
    }
    const f = flows.get(e.requestId);
    if (!f) continue; // executed before the indexed range started
    f.executed =
      e.event === "Deposited"
        ? { tx: e.tx, ts: e.ts, shares: e.shares ?? "0", swingFee: e.swingFee ?? "0" }
        : { tx: e.tx, ts: e.ts, baseOut: e.baseOut ?? "0", quoteOut: e.quoteOut ?? "0", swingFee: e.swingFee ?? "0" };
  }
  return [...flows.values()].sort((a, b) => b.id - a.id);
}
