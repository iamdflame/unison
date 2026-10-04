import { describe, expect, it } from "vitest";
import type { MyFill } from "../lib/demo/engine.ts";
import { costBasis } from "../lib/unison/costBasis.ts";

const fill = (side: "buy" | "sell", qty: number, price: number, block: number): MyFill => ({
  ticker: "aNVDA",
  orderId: block,
  side,
  qty,
  tick: Math.round(price * 100),
  block,
  ts: block * 1000,
  refTick: 18000,
  batchVolume: qty,
  participants: 2,
  limitTick: Math.round(price * 100),
  bandLo: 17000,
  bandHi: 19000,
});
const price = (f: MyFill) => f.tick / 100;
const noFee = () => 0;

describe("costBasis", () => {
  it("averages buys, starting from what the account already held", () => {
    const b = costBasis([fill("buy", 10, 190, 2), fill("buy", 10, 200, 1)], { aNVDA: { qty: 20, price: 180 } }, price, noFee).aNVDA!;
    expect(b.qty).toBe(40);
    expect(b.avg).toBeCloseTo((20 * 180 + 10 * 200 + 10 * 190) / 40, 9);
    expect(b.realized).toBe(0);
  });

  it("realises a sale against the average and leaves the average alone", () => {
    const b = costBasis([fill("buy", 10, 100, 1), fill("sell", 4, 110, 2)], {}, price, noFee).aNVDA!;
    expect(b.qty).toBe(6);
    expect(b.avg).toBeCloseTo(100, 9);
    expect(b.realized).toBeCloseTo(40, 9);
  });

  it("counts the fee in the cost and against the sale", () => {
    const bps = () => 3;
    const b = costBasis([fill("buy", 10, 100, 1), fill("sell", 10, 100, 2)], {}, price, bps).aNVDA!;
    expect(b.qty).toBe(0);
    // paid 0.3 on the way in (in the average) and 0.3 on the way out
    expect(b.realized).toBeCloseTo(-0.6, 9);
  });

  it("takes fills in the order they cleared, whatever order they are listed in", () => {
    const listed = [fill("sell", 5, 120, 3), fill("buy", 5, 100, 1)];
    expect(costBasis(listed, {}, price, noFee).aNVDA!.realized).toBeCloseTo(100, 9);
  });
});
