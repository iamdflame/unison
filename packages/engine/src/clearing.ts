/**
 * Uniform-price frequent-batch-auction clearing — bit-exact port of `contracts/src/core/Clearing.sol`.
 *
 * Levels in priority order:
 *   BID: [ABOVE(hi), hi, hi-1, ..., lo]   (index 0 = ABOVE, index j = tick hi-(j-1))
 *   ASK: [BELOW(lo), lo, lo+1, ..., hi]   (index 0 = BELOW, index j = tick lo+(j-1))
 * Every level before the marginal level is fully filled, the marginal level receives `marginalFill`,
 * every later level gets nothing. All fills at price(tick*).
 */
export const ONE = 10n ** 18n;

export interface ClearingInput {
  lo: bigint;
  hi: bigint;
  refTick: bigint;
  /** bid liquidity with limit tick > hi */
  bidAbove: bigint;
  /** ask liquidity with limit tick < lo */
  askBelow: bigint;
  /** bids[i] = bid liquidity with limit exactly lo + i */
  bids: readonly bigint[];
  /** asks[i] = ask liquidity with limit exactly lo + i */
  asks: readonly bigint[];
}

export interface ClearingResult {
  traded: boolean;
  tick: bigint;
  volume: bigint;
  bidMarginal: bigint;
  bidRatio: bigint;
  bidMarginalFill: bigint;
  askMarginal: bigint;
  askRatio: bigint;
  askMarginalFill: bigint;
}

export class ClearingError extends Error {}

const NO_TRADE: ClearingResult = {
  traded: false,
  tick: 0n,
  volume: 0n,
  bidMarginal: 0n,
  bidRatio: 0n,
  bidMarginalFill: 0n,
  askMarginal: 0n,
  askRatio: 0n,
  askMarginalFill: 0n,
};

export function compute(x: ClearingInput): ClearingResult {
  if (x.hi < x.lo) throw new ClearingError("EmptyBand");
  const n = Number(x.hi - x.lo + 1n);
  if (x.bids.length !== n || x.asks.length !== n) throw new ClearingError("BadArrays");

  const demand: bigint[] = new Array<bigint>(n);
  let acc = x.bidAbove;
  for (let i = n - 1; i >= 0; i--) {
    acc += x.bids[i]!;
    demand[i] = acc;
  }

  let supply = x.askBelow;
  let bestE = 0n;
  let bestImb = 0n;
  let bestDist = 0n;
  let bestIdx = 0;
  let found = false;
  for (let i = 0; i < n; i++) {
    supply += x.asks[i]!;
    const d = demand[i]!;
    const e = d < supply ? d : supply;
    if (e > 0n) {
      const imb = d > supply ? d - supply : supply - d;
      const t = x.lo + BigInt(i);
      const dist = t > x.refTick ? t - x.refTick : x.refTick - t;
      let better = false;
      if (!found || e > bestE) better = true;
      else if (e === bestE) {
        if (imb < bestImb) better = true;
        else if (imb === bestImb && dist < bestDist) better = true;
        // equal on all keys: keep the lower tick (already stored, scanning upward)
      }
      if (better) {
        found = true;
        bestE = e;
        bestImb = imb;
        bestDist = dist;
        bestIdx = i;
      }
    }
  }
  if (!found) return { ...NO_TRADE };

  const [bidMarginal, bidRatio, bidMarginalFill] = allocate(x.bidAbove, n, bestE, (j) => x.bids[n - j]!);
  const [askMarginal, askRatio, askMarginalFill] = allocate(x.askBelow, n, bestE, (j) => x.asks[j - 1]!);
  return {
    traded: true,
    tick: x.lo + BigInt(bestIdx),
    volume: bestE,
    bidMarginal,
    bidRatio,
    bidMarginalFill,
    askMarginal,
    askRatio,
    askMarginalFill,
  };
}

/** Walks one side's levels in priority order until `v` is exhausted. */
function allocate(outside: bigint, n: number, v: bigint, level: (j: number) => bigint): [bigint, bigint, bigint] {
  if (v <= outside) return [0n, ratio(v, outside), v];
  let cum = outside;
  for (let j = 1; j <= n; j++) {
    const q = level(j);
    if (cum + q >= v) {
      const need = v - cum;
      return [BigInt(j), ratio(need, q), need];
    }
    cum += q;
  }
  throw new ClearingError("BadArrays");
}

function ratio(need: bigint, q: bigint): bigint {
  if (q === 0n) return 0n;
  if (need >= q) return ONE;
  return (need * ONE) / q;
}

export const bidLevelTick = (hi: bigint, j: bigint): bigint => hi - (j - 1n);
export const askLevelTick = (lo: bigint, j: bigint): bigint => lo + (j - 1n);

export interface BandParams {
  refPrice: bigint;
  tickSize: bigint;
  minTick: bigint;
  maxTick: bigint;
  bandBps: bigint;
  maxBandTicks: bigint;
}

/** Reference-centred band, exactly as `ExchangeClearing._startAuction` computes it. */
export function band(p: BandParams): { refTick: bigint; lo: bigint; hi: bigint } {
  let refTick = (p.refPrice + p.tickSize / 2n) / p.tickSize;
  if (refTick < p.minTick) refTick = p.minTick;
  if (refTick > p.maxTick) refTick = p.maxTick;
  let hw = (refTick * p.bandBps) / 10_000n;
  if (hw === 0n) hw = 1n;
  const maxHw = (p.maxBandTicks - 1n) / 2n;
  if (hw > maxHw) hw = maxHw;
  const lo = refTick > p.minTick + hw ? refTick - hw : p.minTick;
  const hi = refTick + hw < p.maxTick ? refTick + hw : p.maxTick;
  return { refTick, lo, hi };
}
