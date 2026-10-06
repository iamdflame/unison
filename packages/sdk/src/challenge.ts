/**
 * The standing challenge (contracts/src/challenge/LatencyChallenge.sol): a pot for anyone whose fills, each marked to
 * the first Chainlink observation at least `horizonSec` after the order, show an average edge after fees above
 * `epsilonBps` over at least `minFills` fills. These helpers name every fill's markout round from Chainlink's history
 * and ask the contract itself for the edge, so a score here is exactly what a claim would be judged on.
 *
 *   const s = await scoreAccount(publicClient, challenge, account);
 *   if (s.ready && s.qualifies) await wallet.writeContract({ address: challenge, abi: latencyChallengeAbi,
 *     functionName: "claim", args: [account, s.baseRounds, s.quoteRounds] });
 */
import type { Address, PublicClient } from "viem";
import { challengeAccountAbi } from "./abis/ChallengeAccount.ts";
import { latencyChallengeAbi } from "./abis/LatencyChallenge.ts";
import { causalFeed, firstObservationAfter, roundInForce } from "./causal.ts";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export interface ChallengeTerms {
  pot: Address;
  venue: Address;
  marketId: bigint;
  markout: Address;
  markoutMarketId: bigint;
  start: bigint;
  end: bigint;
  horizonSec: bigint;
  epsilonBps: number;
  minFills: bigint;
  sponsor: Address;
  paid: boolean;
}

export interface ChallengeFill {
  /** the order's registration time (unix seconds) */
  placedAt: bigint;
  /** 0 bought base, 1 sold base */
  side: number;
  /** base units */
  base: bigint;
  /** quote units paid (buy, fee included) or received (sell, fee deducted) */
  quote: bigint;
}

export interface ChallengeScore {
  fills: ChallengeFill[];
  /** false while some fill's markout observation hasn't landed yet: a claim can't be judged until it has */
  ready: boolean;
  /** the markout rounds, one per recorded fill (zero for fills outside the window) */
  baseRounds: bigint[];
  quoteRounds: bigint[];
  /** the contract's own reckoning, once ready: quote units, and fills counted */
  edge: bigint;
  notional: bigint;
  counted: bigint;
  /** edge / notional in bp (0 when nothing counted) */
  edgeBps: number;
  /** a claim would pay */
  qualifies: boolean;
}

export async function challengeTerms(client: PublicClient, challenge: Address): Promise<ChallengeTerms> {
  const c = { address: challenge, abi: latencyChallengeAbi } as const;
  const [pot, venue, marketId, markout, markoutMarketId, start, end, horizonSec, epsilonBps, minFills, sponsor, paid] =
    await Promise.all([
      client.readContract({ ...c, functionName: "pot" }),
      client.readContract({ ...c, functionName: "venue" }),
      client.readContract({ ...c, functionName: "marketId" }),
      client.readContract({ ...c, functionName: "markout" }),
      client.readContract({ ...c, functionName: "markoutMarketId" }),
      client.readContract({ ...c, functionName: "start" }),
      client.readContract({ ...c, functionName: "end" }),
      client.readContract({ ...c, functionName: "horizonSec" }),
      client.readContract({ ...c, functionName: "epsilonBps" }),
      client.readContract({ ...c, functionName: "minFills" }),
      client.readContract({ ...c, functionName: "sponsor" }),
      client.readContract({ ...c, functionName: "paid" }),
    ]);
  return {
    pot,
    venue,
    marketId,
    markout,
    markoutMarketId,
    start: BigInt(start),
    end: BigInt(end),
    horizonSec: BigInt(horizonSec),
    epsilonBps: Number(epsilonBps),
    minFills: BigInt(minFills),
    sponsor,
    paid,
  };
}

export async function challengeFills(client: PublicClient, account: Address): Promise<ChallengeFill[]> {
  const a = { address: account, abi: challengeAccountAbi } as const;
  const n = await client.readContract({ ...a, functionName: "fillCount" });
  const out: ChallengeFill[] = [];
  for (let i = 0n; i < n; i++) {
    const f = await client.readContract({ ...a, functionName: "fillAt", args: [i] });
    out.push({ placedAt: BigInt(f.placedAt), side: Number(f.side), base: f.base, quote: f.quote });
  }
  return out;
}

/** Scores an account: its fills, their markout rounds, and the contract's verdict on them. */
export async function scoreAccount(
  client: PublicClient,
  challenge: Address,
  account: Address,
  terms?: ChallengeTerms,
): Promise<ChallengeScore> {
  const t = terms ?? (await challengeTerms(client, challenge));
  const fills = await challengeFills(client, account);
  const feed = await causalFeed(client, t.markout, t.markoutMarketId);
  const baseRounds: bigint[] = [];
  const quoteRounds: bigint[] = [];
  let ready = true;
  for (const f of fills) {
    if (f.placedAt < t.start || f.placedAt > t.end) {
      baseRounds.push(0n);
      quoteRounds.push(0n);
      continue;
    }
    const b = await firstObservationAfter(client, feed.base, f.placedAt + t.horizonSec - 1n);
    if (!b) {
      ready = false;
      baseRounds.push(0n);
      quoteRounds.push(0n);
      continue;
    }
    baseRounds.push(b.round);
    quoteRounds.push(feed.quote === ZERO ? 0n : (await roundInForce(client, feed.quote, b.observedAt)).round);
  }
  let edge = 0n;
  let notional = 0n;
  let counted = 0n;
  if (ready && fills.length > 0) {
    [edge, notional, counted] = await client.readContract({
      address: challenge,
      abi: latencyChallengeAbi,
      functionName: "edgeOf",
      args: [account, baseRounds, quoteRounds],
    });
  }
  const edgeBps = notional > 0n ? Number((edge * 1_000_000n) / notional) / 100 : 0;
  const qualifies =
    ready && !t.paid && counted >= t.minFills && edge > 0n && edge * 10_000n > BigInt(t.epsilonBps) * notional;
  return { fills, ready, baseRounds, quoteRounds, edge, notional, counted, edgeBps, qualifies };
}
