import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { concat, decodeEventLog, keccak256, pad, toHex, type Hex } from "viem";
import { unisonExchangeAbi } from "@unison/sdk";
import type { ClaimRow, OrderCancelledRow, OrderPlacedRow, PrintRow, VaultEventRow } from "../src/db.ts";
import {
  buildCandles,
  derivePrint,
  fairness,
  fillingPrints,
  groupOrderEvents,
  orderView,
  percentile,
  receiptHash,
  recomputeFill,
  regimeOf,
  vaultFlows,
  vaultPoints,
  ZERO_HASH,
} from "../src/derive.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/devnet-e2e.json", import.meta.url), "utf8")) as {
  timestamps: Record<string, number>;
  logs: { address: string; topics: Hex[]; data: Hex; blockNumber: number; logIndex: number }[];
};

const E18 = 10n ** 18n;
const pricing = { tickSize: 10_000n, baseUnit: E18, maxFeeBps: 10n };

const pr = (block: number, over: Partial<PrintRow> = {}): PrintRow => ({
  block,
  logIndex: 0,
  tx: "0x01",
  ts: block * 1000,
  marketId: 0,
  upTo: block - 1,
  tick: 17_990,
  price: "179900000",
  volume: (2n * E18).toString(),
  refPrice: "179950000",
  refTimeMs: block * 1000 - 500,
  status: 0,
  bandLo: 17_810,
  bandHi: 18_170,
  receiptHash: ZERO_HASH,
  prevReceiptHash: ZERO_HASH,
  chainOk: true,
  regime: "LIVE",
  deviationBps: -2.77,
  closeTs: block - 2,
  ...over,
});

const placed = (o: Partial<OrderPlacedRow> = {}): OrderPlacedRow => ({
  block: 10,
  logIndex: 0,
  tx: "0xp",
  ts: 10_000,
  marketId: 0,
  account: "0xa",
  slot: 0,
  side: 0,
  tick: 18_000,
  qty: (3n * E18).toString(),
  flags: 0,
  batch: 10,
  ...o,
});

const claimRow = (block: number, o: Partial<ClaimRow>): ClaimRow => ({
  block,
  logIndex: 0,
  tx: `0xc${block}`,
  ts: block * 1000,
  marketId: 0,
  account: "0xa",
  slot: 0,
  side: 0,
  baseAmount: "0",
  quoteAmount: "0",
  fee: "0",
  done: false,
  ...o,
});

const cancelRow = (block: number, o: Partial<OrderCancelledRow> = {}): OrderCancelledRow => ({
  block,
  logIndex: 1,
  tx: `0xx${block}`,
  ts: block * 1000,
  marketId: 0,
  account: "0xa",
  slot: 0,
  releasedQty: "0",
  ...o,
});

describe("regimes (SPEC §6)", () => {
  it("derives the regime from status, band and the previous status", () => {
    expect(regimeOf(0, 17_800, 18_200, 0)).toBe("LIVE");
    expect(regimeOf(1, 17_800, 18_200, 1)).toBe("EXTENDED");
    expect(regimeOf(2, 17_000, 19_000, 0)).toBe("DISCOVERY");
    expect(regimeOf(0, 17_000, 19_000, 2)).toBe("REOPENING"); // first open auction after the weekend
    expect(regimeOf(1, 17_000, 19_000, 3)).toBe("REOPENING"); // after a halt
    expect(regimeOf(3, 0, 0, 0)).toBe("HALTED");
    expect(regimeOf(0, 0, 0, 0)).toBe("HALTED"); // halt override: no band was computed
    expect(regimeOf(2, 0, 0, 2)).toBe("HALTED");
  });
});

describe("receipt hash chain", () => {
  it("is keccak256 of nine abi.encode words in _finalize's order", () => {
    const p = { marketId: 3, upTo: 1_234, tick: 18_001, volume: "2000000000000000000", refPrice: "180010000", refTimeMs: 1_760_000_000_123, status: 1 };
    const prev = `0x${"ab".repeat(32)}` as Hex;
    const words = [prev, ...[3n, 1_234n, 18_001n, 2n * E18, 180_010_000n, 1_760_000_000_123n, 1n, 1_760_000_001n].map((v) => pad(toHex(v)))];
    expect(receiptHash(prev, p, 1_760_000_001)).toBe(keccak256(concat(words)));
  });

  it("recomputes every receipt the devnet exchange emitted (recorded logs, block.timestamp of the clear)", () => {
    let prev: Hex = ZERO_HASH;
    let n = 0;
    for (const l of fixture.logs) {
      let ev;
      try {
        ev = decodeEventLog({ abi: unisonExchangeAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      } catch {
        continue;
      }
      if (ev.eventName !== "BatchCleared" || ev.args.marketId !== 0n) continue;
      const a = ev.args;
      const ts = fixture.timestamps[String(l.blockNumber)]!;
      const r = receiptHash(
        prev,
        {
          marketId: 0,
          upTo: Number(a.upToBlock),
          tick: Number(a.tick),
          volume: a.volume.toString(),
          refPrice: a.refPrice.toString(),
          refTimeMs: Number(a.refTimeMs),
          status: a.status,
        },
        ts,
      );
      expect(r).toBe(a.receiptHash);
      expect(receiptHash(prev, { marketId: 0, upTo: Number(a.upToBlock), tick: Number(a.tick), volume: a.volume.toString(), refPrice: a.refPrice.toString(), refTimeMs: Number(a.refTimeMs), status: a.status }, ts + 1)).not.toBe(a.receiptHash);
      prev = a.receiptHash;
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("flags a print whose predecessor is missing or tampered", () => {
    const p = { marketId: 0, upTo: 9, tick: 18_000, volume: "1", refPrice: "180000000", refTimeMs: 9_000, status: 0 };
    const good = receiptHash(ZERO_HASH, p, 10);
    const base = { ...pr(10), ...p, ts: 10_000, price: "180000000", receiptHash: good, closeTs: null };
    expect(derivePrint(base, undefined).chainOk).toBe(true);
    expect(derivePrint(base, { receiptHash: `0x${"01".repeat(32)}`, status: 0 }).chainOk).toBe(false);
    expect(derivePrint({ ...base, volume: "2" }, undefined).chainOk).toBe(false);
    expect(derivePrint(base, undefined).deviationBps).toBe(0);
  });
});

describe("candles", () => {
  it("buckets traded prints into OHLCV and skips empty auctions", () => {
    const prints = [
      pr(61, { ts: 61_000, price: "100", volume: "5" }),
      pr(62, { ts: 62_000, price: "120", volume: "1" }),
      pr(63, { ts: 63_000, price: "90", volume: "0" }), // empty auction
      pr(64, { ts: 119_000, price: "95", volume: "2" }),
      pr(65, { ts: 120_000, price: "130", volume: "3" }),
    ];
    expect(buildCandles(prints, 60_000)).toEqual([
      { t: 60_000, o: "100", h: "120", l: "95", c: "95", v: "8", n: 3 },
      { t: 120_000, o: "130", h: "130", l: "130", c: "130", v: "3", n: 1 },
    ]);
  });
});

describe("fairness", () => {
  it("computes deviation and reference-lag statistics over a window", () => {
    const prints = [
      pr(10, { deviationBps: 1.5, refTimeMs: 8_400, closeTs: 8 }), // lag 400
      pr(11, { deviationBps: -2, refTimeMs: 9_900, closeTs: 9 }), // lag 900
      pr(12, { deviationBps: 0, refTimeMs: 10_100, closeTs: 10 }), // lag 100
      pr(13, { deviationBps: 75, refTimeMs: 11_200, closeTs: 11 }), // lag 200, clamps into the +50 bucket
      pr(14, { volume: "0", deviationBps: null, refTimeMs: 12_300, closeTs: null }),
    ];
    const f = fairness(prints);
    expect(f.batches).toBe(5);
    expect(f.traded).toBe(4);
    expect(f.volume).toBe((8n * E18).toString());
    expect(f.meanAbsDevBps).toBe(19.63); // (1.5 + 2 + 0 + 75) / 4
    expect(f.p95AbsDevBps).toBe(75);
    expect(f.maxAbsDevBps).toBe(75);
    expect(f.meanRefLagMs).toBe(400); // (400 + 900 + 100 + 200) / 4
    expect(f.p95RefLagMs).toBe(900);
    expect(f.chainOk).toBe(true);
    expect(f.histogram).toHaveLength(101);
    const at = (b: number) => f.histogram.find((h) => h.bps === b)!.count;
    expect([at(2), at(-2), at(0), at(50)]).toEqual([1, 1, 1, 1]);
    expect(fairness([...prints, pr(15, { chainOk: false })]).chainOk).toBe(false);
  });

  it("uses nearest-rank percentiles", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
});

describe("order lifecycle", () => {
  it("settles a bid exactly when done: quote = lock − refund − fee", () => {
    // 3 @ 180.00 limit, filled at 179.90: pay 539.7, fee ⌈3 bp⌉ = 0.16191, lock 540.540004
    const o = groupOrderEvents(
      [placed()],
      [claimRow(13, { baseAmount: (3n * E18).toString(), quoteAmount: "678094", fee: "161910", done: true })],
      [],
    )[0]!;
    const v = orderView(o, { pricing, lastCleared: 12, prints: [pr(12)] });
    expect(v).toMatchObject({ status: "closed", filled: (3n * E18).toString(), quote: "539700000", fee: "161910", avgPrice: "179900000" });
    expect(recomputeFill(v, fillingPrints(o, [pr(12)]), E18)).toBe(true);
    expect(recomputeFill({ ...v, quote: "539800000" }, [pr(12)], E18)).toBe(false);
  });

  it("estimates an open ask from its auctions until it settles, then reads base returned", () => {
    const ask = placed({ side: 1, tick: 17_970, qty: (2n * E18).toString() });
    const partial = claimRow(13, { side: 1, quoteAmount: "179846030", fee: "53970" }); // 1 filled @ 179.90 gross
    const open = orderView(groupOrderEvents([ask], [partial], [])[0]!, { pricing, lastCleared: 12, prints: [pr(12)] });
    expect(open).toMatchObject({ status: "open", filled: E18.toString(), quote: "179900000", fee: "53970", avgPrice: "179900000" });

    // cancelled after the auction: the unfilled base comes back with the final claim
    const done = claimRow(20, { side: 1, baseAmount: E18.toString(), done: true });
    const cancel = cancelRow(20, { releasedQty: E18.toString() });
    const closed = orderView(groupOrderEvents([ask], [partial, done], [cancel])[0]!, { pricing, lastCleared: 19, prints: [pr(12)] });
    expect(closed).toMatchObject({ status: "cancelled", filled: E18.toString(), quote: "179900000" });
    expect(closed.claims.map((c) => c.done)).toEqual([false, true]);
  });

  it("knows pending orders and cancels before the auction", () => {
    const p = placed({ batch: 20, block: 20 });
    expect(orderView(groupOrderEvents([p], [], [])[0]!, { pricing, lastCleared: 14, prints: [] }).status).toBe("pending");
    const c = orderView(groupOrderEvents([p], [], [cancelRow(21, { releasedQty: p.qty })])[0]!, { pricing, lastCleared: 14, prints: [] });
    expect(c).toMatchObject({ status: "cancelled", filled: "0", quote: "0", avgPrice: null });
  });

  it("assigns events to the right order when a slot is reused", () => {
    const first = placed({ block: 10, batch: 10 });
    const second = placed({ block: 30, batch: 30, tick: 17_000, tx: "0xq" });
    const orders = groupOrderEvents(
      [second, first],
      [claimRow(13, { baseAmount: "1", done: true }), claimRow(35, { baseAmount: "7" })],
      [],
    );
    expect(orders.map((o) => [o.placed.block, o.claims.map((c) => c.baseAmount)])).toEqual([
      [10, ["1"]],
      [30, ["7"]],
    ]);
  });

  it("finds the auctions that filled an order", () => {
    const bid = groupOrderEvents([placed({ batch: 10 })], [], [])[0]!;
    const prints = [
      pr(11, { upTo: 9 }), // before the order's batch
      pr(12, { upTo: 10, tick: 18_000 }), // at the limit: partial
      pr(13, { upTo: 12, tick: 18_010 }), // above a bid's limit: no fill
      pr(14, { upTo: 13, tick: 17_950 }), // strictly better, limit in band: filled in full
      pr(15, { upTo: 14, tick: 17_900 }),
    ];
    expect(fillingPrints(bid, prints).map((p) => p.block)).toEqual([12, 14]);
    const ioc = groupOrderEvents([placed({ batch: 10, flags: 1 })], [], [])[0]!;
    expect(fillingPrints(ioc, prints).map((p) => p.block)).toEqual([12]); // one auction only
  });
});

describe("vaults", () => {
  it("downsamples snapshots and prices shares per 10^decimals", () => {
    const snap = (t: number, nav: string, supply: string) => ({
      vault: "0xv", t, block: t, nav, supply, base: "0", quote: nav, spreadPnl: "5", inventoryPnl: "-3", decimals: 12,
    });
    const pts = vaultPoints([snap(3_700_000, "2000000", "1000000000000000000"), snap(100, "1000000", "1000000000000000000"), snap(3_500_000, "1500000", "1000000000000000000")], 3_600_000);
    expect(pts.map((p) => [p.t, p.nav, p.sharePrice])).toEqual([
      [0, "1500000", "1"],
      [3_600_000, "2000000", "2"],
    ]);
  });

  it("joins requests with executions (Redeemed.swingFee is a rate)", () => {
    const ev = (block: number, event: VaultEventRow["event"], requestId: number, f: Partial<VaultEventRow>): VaultEventRow => ({
      block, logIndex: 0, tx: `0x${block}`, ts: block, vault: "0xv", event, requestId, owner: "0xo",
      amount: null, shares: null, nav: null, baseOut: null, quoteOut: null, swingFee: null, ...f,
    });
    const flows = vaultFlows([
      ev(1, "DepositRequested", 0, { amount: "1000" }),
      ev(5, "Deposited", 0, { amount: "1000", shares: "999", nav: "5000", swingFee: "3" }),
      ev(6, "RedeemRequested", 1, { amount: "500" }),
      ev(9, "Redeemed", 1, { shares: "500", baseOut: "1", quoteOut: "2", swingFee: "30" }),
      ev(10, "DepositRequested", 2, { amount: "7" }),
    ]);
    expect(flows.map((f) => [f.id, f.kind, f.amount, f.executed?.swingFee ?? null])).toEqual([
      [2, "deposit", "7", null],
      [1, "redeem", "500", "30"],
      [0, "deposit", "1000", "3"],
    ]);
    expect(flows[2]!.executed).toMatchObject({ tx: "0x5", shares: "999" });
  });
});
