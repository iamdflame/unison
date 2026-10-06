/**
 * The standing challenge's arithmetic, exactly as the contracts do it, with no Envio imports, so it is unit-tested on
 * its own (test/score.test.ts) and the handlers stay thin.
 *
 *   - LatencyChallenge.edgeOf: every fill inside [start, end] is marked at the first observation made at least
 *     `horizonSec` after its order (ChainlinkCausalReference.readAfter(markoutMarketId, placedAt + horizonSec - 1)),
 *     worth = base * price / baseUnit; a buy's edge is worth - quote, a sell's quote - worth; notional sums quote.
 *   - ChainlinkCausalReference._price, for market 1 (WMON/AUSD): price = mulDiv(b * 10^quoteTokenDecimals,
 *     10^quoteFeedDecimals, q * 10^baseFeedDecimals), with q the AUSD/USD round in force at the observation.
 */

export const TERMS = {
  /** LatencyChallenge immutables, the same for both challenges (deploy/monad-mainnet-challenge.json) */
  start: 1791294517n,
  end: 1793145599n,
  horizonSec: 60n,
  epsilonBps: 2n,
  minFills: 30n,
  baseUnit: 10n ** 18n, // WMON
  /** feed and token decimals of market 1 (deploy/monad-mainnet-causal.json; both feeds report 8 decimals) */
  baseFeedDecimals: 8n,
  quoteFeedDecimals: 8n,
  quoteTokenDecimals: 6n,
} as const;

/** The two challenges, by address (lowercase). */
export const CHALLENGES: Record<string, "causal" | "old"> = {
  "0xdcd3e86518db6a40c4feba576efff598ca3b90d1": "causal",
  "0x5ce9d9f491e2d16c94f56ed09bea23e7109976e9": "old",
};

export const inWindow = (placedAt: bigint) => placedAt >= TERMS.start && placedAt <= TERMS.end;

/** The observation that marks a fill: the first observed strictly after placedAt + horizonSec - 1. */
export const marksFill = (observedAt: bigint, placedAt: bigint) => observedAt > placedAt + TERMS.horizonSec - 1n;

/** ChainlinkCausalReference._price for market 1: MON/USD over the AUSD/USD round in force, in AUSD units per WMON. */
export function priceOf(baseAnswer: bigint, quoteAnswer: bigint): bigint {
  if (baseAnswer <= 0n || quoteAnswer <= 0n) throw new Error("non-positive answer");
  return (baseAnswer * 10n ** TERMS.quoteTokenDecimals * 10n ** TERMS.quoteFeedDecimals) / (quoteAnswer * 10n ** TERMS.baseFeedDecimals);
}

/** A fill's edge at a mark price, in quote units. */
export function edgeOf(side: number, base: bigint, quote: bigint, price: bigint): bigint {
  const worth = (base * price) / TERMS.baseUnit;
  return side === 0 ? worth - quote : quote - worth;
}

/** edge / notional in basis points, to two decimals, as a string (BigDecimal-safe). */
export function edgeBps(edge: bigint, notional: bigint): string {
  if (notional === 0n) return "0";
  const scaled = (edge * 1_000_000n) / notional; // bps × 100
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Whether an account would win the pot now: enough counted fills and an edge above epsilon of its notional. */
export function qualifies(counted: bigint, edge: bigint, notional: bigint): boolean {
  return counted >= TERMS.minFills && edge > 0n && edge * 10_000n > TERMS.epsilonBps * notional;
}

/** The AUSD/USD round in force at time t, walking back from the newest: observed at or before t. */
export function quoteInForce<R extends { observedAt: bigint; previous?: string | null }>(
  newest: R | undefined,
  load: (id: string) => R | undefined,
  t: bigint,
): R | undefined {
  let r = newest;
  while (r && r.observedAt > t) r = r.previous ? load(r.previous) : undefined;
  return r;
}
