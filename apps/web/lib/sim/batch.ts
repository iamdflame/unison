import { compute, ONE } from "@unison/engine";

/**
 * One batch on the real clearing engine (bit-exact with the contracts), for the site's instruments. Quantities are
 * shares with 6 decimals of precision; prices are ticks of $0.01.
 */
export interface SimOrder {
  id: number;
  side: "buy" | "sell";
  tick: number;
  qty: number;
  you?: boolean;
}

export interface BatchOutcome {
  traded: boolean;
  /** uniform clearing tick */
  tick: number;
  /** shares traded */
  volume: number;
  /** shares filled per order id */
  fills: Map<number, number>;
}

const SCALE = 1_000_000;
const toUnits = (q: number) => BigInt(Math.round(q * SCALE));

export function clearBatch(orders: readonly SimOrder[], band: { lo: number; hi: number; refTick: number }): BatchOutcome {
  const n = band.hi - band.lo + 1;
  const bids = new Array<bigint>(n).fill(0n);
  const asks = new Array<bigint>(n).fill(0n);
  let bidAbove = 0n;
  let askBelow = 0n;
  for (const o of orders) {
    const q = toUnits(o.qty);
    if (o.side === "buy") {
      if (o.tick > band.hi) bidAbove += q;
      else if (o.tick >= band.lo) bids[o.tick - band.lo]! += q;
    } else {
      if (o.tick < band.lo) askBelow += q;
      else if (o.tick <= band.hi) asks[o.tick - band.lo]! += q;
    }
  }
  const r = compute({
    lo: BigInt(band.lo),
    hi: BigInt(band.hi),
    refTick: BigInt(band.refTick),
    bidAbove,
    askBelow,
    bids,
    asks,
  });
  const fills = new Map<number, number>();
  if (!r.traded) return { traded: false, tick: band.refTick, volume: 0, fills };
  const t = Number(r.tick);
  const bidRatio = Number((r.bidRatio * 1_000_000n) / ONE) / 1_000_000;
  const askRatio = Number((r.askRatio * 1_000_000n) / ONE) / 1_000_000;
  for (const o of orders) {
    let filled = 0;
    if (o.side === "buy") filled = o.tick > t ? o.qty : o.tick === t ? o.qty * bidRatio : 0;
    else filled = o.tick < t ? o.qty : o.tick === t ? o.qty * askRatio : 0;
    fills.set(o.id, Math.round(filled * 100) / 100);
  }
  return { traded: true, tick: t, volume: Number(r.volume) / SCALE, fills };
}

/** Cumulative demand (bids with limit ≥ t) and supply (asks with limit ≤ t) at each tick of a window. */
export function curves(orders: readonly SimOrder[], lo: number, hi: number) {
  const ticks: number[] = [];
  const demand: number[] = [];
  const supply: number[] = [];
  for (let t = lo; t <= hi; t++) {
    ticks.push(t);
    demand.push(orders.filter((o) => o.side === "buy" && o.tick >= t).reduce((a, o) => a + o.qty, 0));
    supply.push(orders.filter((o) => o.side === "sell" && o.tick <= t).reduce((a, o) => a + o.qty, 0));
  }
  return { ticks, demand, supply };
}

/** A seeded batch of orders around a reference, the way a real batch arrives: mostly near the price, a few far. */
export function seededOrders(seed: number, refTick: number, count = 12): SimOrder[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: SimOrder[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? "buy" : "sell";
    const offset = Math.round((rand() - 0.5) * 36);
    const tick = refTick + offset + (side === "buy" ? 6 : -6);
    out.push({ id: i + 1, side, tick, qty: Math.round((0.6 + rand() * 4.4) * 10) / 10 });
  }
  return out;
}
