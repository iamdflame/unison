/**
 * The causal clock (SPEC §7.4). On a causal market an auction prices at the first Chainlink observation made more than
 * `skewSec` after its oldest waiting order, and holds exactly the orders sealed before that observation. The
 * observation time is Chainlink's `startedAt`: the time inside the report the oracle quorum signed, never the
 * chain's clock. These helpers find that observation in the feed's own history, so a keeper, an agent or a verifier
 * can name it. The contract checks it is the first, so nobody can name another.
 *
 *   const p = await causalPayload(publicClient, adapter, marketId, oldestOrderTime + skew);
 *   if (p) await client.clear(marketId, p.payload);
 */
import { encodeAbiParameters, parseAbi, type Address, type Hex, type PublicClient } from "viem";

export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const causalFeedsAbi = parseAbi([
  "function feeds(uint256) view returns (address base, address quote, uint8 baseDecimals, uint8 quoteFeedDecimals, uint8 quoteTokenDecimals, uint32 maxAgeSec, uint32 quoteMaxAgeSec, uint32 openSec, uint32 closeSec, uint16 depegBps, bool set)",
]);

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** One round of a Chainlink feed. */
export interface Observation {
  round: bigint;
  answer: bigint;
  /** when the oracle observed the price (unix seconds, signed by the oracle quorum) */
  observedAt: bigint;
  /** when the report landed on chain (unix seconds) */
  arrivedAt: bigint;
}

/** How a causal adapter reads one market (`ChainlinkCausalReference.feeds`). */
export interface CausalFeed {
  base: Address;
  /** the quote/USD feed, or the zero address when the quote token is USD */
  quote: Address;
  maxAgeSec: number;
  quoteMaxAgeSec: number;
  openSec: number;
  closeSec: number;
  depegBps: number;
}

/** The first round of a Chainlink proxy phase has no predecessor in its phase. */
const firstOfPhase = (round: bigint) => (round & 0xffff_ffff_ffff_ffffn) <= 1n;

export async function latestObservation(client: PublicClient, feed: Address): Promise<Observation> {
  const [round, answer, startedAt, updatedAt] = await client.readContract({
    address: feed,
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  return { round, answer, observedAt: startedAt, arrivedAt: updatedAt };
}

/** A round of `feed`, or null when it does not exist (yet). */
export async function observation(client: PublicClient, feed: Address, round: bigint): Promise<Observation | null> {
  try {
    const [, answer, startedAt, updatedAt] = await client.readContract({
      address: feed,
      abi: aggregatorAbi,
      functionName: "getRoundData",
      args: [round],
    });
    return updatedAt === 0n ? null : { round, answer, observedAt: startedAt, arrivedAt: updatedAt };
  } catch {
    return null;
  }
}

/**
 * The first observation of `feed` made strictly after `afterSec`, or null when none has landed yet. It walks back
 * from the latest round, so it is cheapest right after a round lands, which is when a keeper asks.
 */
export async function firstObservationAfter(
  client: PublicClient,
  feed: Address,
  afterSec: bigint,
  maxBack = 2_000,
): Promise<Observation | null> {
  let cur = await latestObservation(client, feed);
  if (cur.observedAt <= afterSec) return null;
  for (let i = 0; i < maxBack && !firstOfPhase(cur.round); i++) {
    const prev = await observation(client, feed, cur.round - 1n);
    if (!prev || prev.observedAt <= afterSec) break;
    cur = prev;
  }
  return cur;
}

/** The round of `feed` in force at `atSec`: the newest one observed at or before it. */
export async function roundInForce(client: PublicClient, feed: Address, atSec: bigint, maxBack = 2_000): Promise<Observation> {
  let cur = await latestObservation(client, feed);
  for (let i = 0; i < maxBack && cur.observedAt > atSec; i++) {
    if (firstOfPhase(cur.round)) break;
    const prev = await observation(client, feed, cur.round - 1n);
    if (!prev) break;
    cur = prev;
  }
  if (cur.observedAt > atSec) throw new Error(`no round of ${feed} observed at or before ${atSec}`);
  return cur;
}

export async function causalFeed(client: PublicClient, adapter: Address, marketId: bigint): Promise<CausalFeed> {
  const [base, quote, , , , maxAgeSec, quoteMaxAgeSec, openSec, closeSec, depegBps, set] = await client.readContract({
    address: adapter,
    abi: causalFeedsAbi,
    functionName: "feeds",
    args: [marketId],
  });
  if (!set) throw new Error(`market ${marketId} has no feed on ${adapter}`);
  return { base, quote, maxAgeSec, quoteMaxAgeSec, openSec, closeSec, depegBps };
}

/** Session.isOpen: a weekly window [openSec, closeSec) in seconds since Monday 00:00 UTC; open == close = always. */
export function sessionOpen(openSec: number, closeSec: number, atSec: bigint): boolean {
  if (openSec === closeSec) return true;
  const day = 86_400n;
  const w = Number(((atSec / day + 3n) % 7n) * day + (atSec % day));
  return openSec < closeSec ? w >= openSec && w < closeSec : w >= openSec || w < closeSec;
}

/**
 * Whether a causal market may clear without a new observation (a DISCOVERY call auction): its session is closed, or
 * its feed has been silent for longer than `maxAgeSec`. Mirrors the adapter's empty-payload rule.
 */
export function closedAt(f: Pick<CausalFeed, "openSec" | "closeSec" | "maxAgeSec">, latest: Observation, nowSec: bigint): boolean {
  return !sessionOpen(f.openSec, f.closeSec, nowSec) || nowSec - latest.arrivedAt > BigInt(f.maxAgeSec);
}

export function encodeCausalPayload(baseRound: bigint, quoteRound: bigint): Hex {
  return encodeAbiParameters([{ type: "uint80" }, { type: "uint80" }], [baseRound, quoteRound]);
}

/**
 * The clear payload for the auction whose orders were sealed by `afterSec` (the oldest waiting order's time plus the
 * market's skew): the first base observation after it, and the quote round in force at that observation. Null when
 * that observation has not landed yet.
 */
export async function causalPayload(
  client: PublicClient,
  adapter: Address,
  marketId: bigint,
  afterSec: bigint,
): Promise<{ payload: Hex; base: Observation; quote?: Observation } | null> {
  const f = await causalFeed(client, adapter, marketId);
  const base = await firstObservationAfter(client, f.base, afterSec);
  if (!base) return null;
  if (f.quote === ZERO) return { payload: encodeCausalPayload(base.round, 0n), base };
  const quote = await roundInForce(client, f.quote, base.observedAt);
  return { payload: encodeCausalPayload(base.round, quote.round), base, quote };
}
