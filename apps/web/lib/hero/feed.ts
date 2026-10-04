/**
 * The hero's heartbeat: one frame per 300 ms batch. Prices follow a seeded random walk around a reference at
 * realistic volatility (σ 45%/yr ≈ 0.44 bp per batch), and trades print only when a batch actually crosses. Flow is
 * simulated and labelled as such on the dial; when the tape is reachable the hero switches to live heads and prints.
 */
export interface HeroFrame {
  /** Batch number (Monad block). */
  block: number;
  /** Batch close, ms since epoch. */
  ts: number;
  /** Reference price, quote units per share (float for display). */
  ref: number;
  /** Uniform clearing price of this batch, or null if nothing crossed. */
  price: number | null;
  /** Shares that traded at the uniform price. */
  volume: number;
  /** Orders that arrived in this batch. */
  orders: number;
}

/** mulberry32: tiny, fast, seedable. */
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

const BLOCK_REF = { height: 110_314_659, unixMs: 1_791_071_084_000 }; // measured on Monad mainnet, Oct 2026
const BLOCK_MS = 304;

/** Monad's block height right now, extrapolated from a measured block (display only; live mode uses real heads). */
export const estimatedBlock = (nowMs: number) => BLOCK_REF.height + Math.floor((nowMs - BLOCK_REF.unixMs) / BLOCK_MS);

export function createHeroFeed({ seed = 7, ref = 181.2, tick = 0.01, sigmaAnnual = 0.45, beatMs = 300 } = {}) {
  const rand = rng(seed);
  const normal = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const perBeat = sigmaAnnual * Math.sqrt(beatMs / 1000 / (365 * 24 * 3600));
  let price = ref;
  let last: number | null = null;
  return {
    next(nowMs: number): HeroFrame {
      price *= Math.exp(perBeat * normal() * 2.2 - (perBeat * perBeat) / 2);
      // Orders per batch: mostly a few, sometimes a burst.
      const orders = rand() < 0.12 ? 6 + Math.floor(rand() * 9) : Math.floor(rand() * 4);
      const crosses = orders >= 2 && rand() < 0.72;
      let p: number | null = null;
      let volume = 0;
      if (crosses) {
        const offset = Math.round(normal() * 0.6) * tick;
        p = Math.round((price + offset) / tick) * tick;
        if (last !== null && Math.abs(p - last) > 8 * tick) p = last + Math.sign(p - last) * 8 * tick;
        volume = Math.max(1, Math.round(orders * (0.4 + rand() * 1.8) * 10) / 10);
        last = p;
      }
      return { block: estimatedBlock(nowMs), ts: nowMs, ref: Math.round(price / tick) * tick, price: p, volume, orders };
    },
  };
}
