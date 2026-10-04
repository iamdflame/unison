import { compute, ONE } from "@unison/engine";
import { describe, expect, it } from "vitest";
import { clearBatch, type SimOrder } from "../lib/sim/batch.ts";

/** The original clearBatch, over the whole band: the reference the windowed one must equal exactly. */
function clearOverBand(orders: readonly SimOrder[], band: { lo: number; hi: number; refTick: number }) {
  const n = band.hi - band.lo + 1;
  const bids = new Array<bigint>(n).fill(0n);
  const asks = new Array<bigint>(n).fill(0n);
  let bidAbove = 0n;
  let askBelow = 0n;
  const units = (q: number) => BigInt(Math.round(q * 1_000_000));
  for (const o of orders) {
    if (o.side === "buy") {
      if (o.tick > band.hi) bidAbove += units(o.qty);
      else if (o.tick >= band.lo) bids[o.tick - band.lo]! += units(o.qty);
    } else {
      if (o.tick < band.lo) askBelow += units(o.qty);
      else if (o.tick <= band.hi) asks[o.tick - band.lo]! += units(o.qty);
    }
  }
  const r = compute({ lo: BigInt(band.lo), hi: BigInt(band.hi), refTick: BigInt(band.refTick), bidAbove, askBelow, bids, asks });
  const fills = new Map<number, number>();
  if (!r.traded) return { traded: false, tick: band.refTick, volume: 0, fills };
  const t = Number(r.tick);
  const bidRatio = Number((r.bidRatio * 1_000_000n) / ONE) / 1_000_000;
  const askRatio = Number((r.askRatio * 1_000_000n) / ONE) / 1_000_000;
  for (const o of orders) {
    const filled = o.side === "buy" ? (o.tick > t ? o.qty : o.tick === t ? o.qty * bidRatio : 0) : o.tick < t ? o.qty : o.tick === t ? o.qty * askRatio : 0;
    fills.set(o.id, Math.round(filled * 100) / 100);
  }
  return { traded: true, tick: t, volume: Number(r.volume) / 1_000_000, fills };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("clearBatch runs the engine over the tradable window", () => {
  it("gives the same auction as the whole band, on thousands of batches", () => {
    const r = rng(20261004);
    let traded = 0;
    let beyond = 0;
    for (let k = 0; k < 4000; k++) {
      const ref = 18_000 + Math.floor(r() * 400);
      const half = 1 + Math.floor(r() ** 2 * 2000); // mostly narrow bands, some 4,000 ticks wide
      const band = { lo: ref - half, hi: ref + half, refTick: ref + Math.floor((r() - 0.5) * 2 * half * 1.3) }; // ref sometimes outside
      const count = Math.floor(r() * 30);
      const orders: SimOrder[] = [];
      const hot = ref + Math.floor((r() - 0.5) * 20); // a crowded level, for pro-rata fills
      for (let i = 0; i < count; i++) {
        const far = r() < 0.08; // beyond the band on either side
        const tick = far ? (r() < 0.5 ? band.lo - 1 - Math.floor(r() * 50) : band.hi + 1 + Math.floor(r() * 50)) : r() < 0.3 ? hot : ref + Math.floor((r() - 0.5) * 2 * Math.min(half, 60));
        if (far) beyond++;
        orders.push({ id: i + 1, side: r() < 0.5 ? "buy" : "sell", tick, qty: Math.round((0.01 + r() * 8) * 100) / 100 });
      }
      const got = clearBatch(orders, band);
      const want = clearOverBand(orders, band);
      if (want.traded) traded++;
      expect({ traded: got.traded, tick: got.tick, volume: got.volume }).toEqual({ traded: want.traded, tick: want.tick, volume: want.volume });
      expect([...got.fills]).toEqual([...want.fills]);
    }
    // the sample exercised what matters: plenty of trades, and orders beyond the band
    expect(traded).toBeGreaterThan(1500);
    expect(beyond).toBeGreaterThan(1000);
  });

  it("trades at the reference when both sides are only beyond the band", () => {
    const band = { lo: 100, hi: 200, refTick: 150 };
    const orders: SimOrder[] = [
      { id: 1, side: "buy", tick: 260, qty: 2 },
      { id: 2, side: "sell", tick: 40, qty: 3 },
    ];
    expect(clearBatch(orders, band)).toEqual(clearOverBand(orders, band));
    expect(clearBatch(orders, band).tick).toBe(150);
  });

  it("does not trade when nothing can cross", () => {
    const band = { lo: 100, hi: 200, refTick: 150 };
    expect(clearBatch([], band).traded).toBe(false);
    expect(clearBatch([{ id: 1, side: "buy", tick: 400, qty: 1 }], band).traded).toBe(false);
    expect(clearBatch([{ id: 1, side: "buy", tick: 120, qty: 1 }, { id: 2, side: "sell", tick: 130, qty: 1 }], band).traded).toBe(false);
  });
});
