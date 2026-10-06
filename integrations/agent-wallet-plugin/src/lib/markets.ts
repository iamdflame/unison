import type { PublicClient } from "viem";
import { chainlinkCausalReferenceAbi, unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { exchange, markets, type Market } from "./venue.ts";
import { fromUnits } from "./units.ts";

/** One market as the chain has it now: its parameters, its last auction, and, if causal, Chainlink's latest observation. */
export interface MarketState {
  market: Market;
  active: boolean;
  halted: boolean;
  tickSize: bigint;
  baseUnit: bigint;
  minTick: bigint;
  maxTick: bigint;
  feeBps: number;
  maxFeeBps: number;
  bandBps: number;
  auctions: bigint;
  lastCleared: bigint;
  /** the last auction's price (quote units per base unit), if one has printed */
  lastPrice: bigint | null;
  /** Chainlink's newest observation, as the causal adapter prices it (quote units per base unit) */
  reference: { price: bigint; observedAt: bigint; status: number; round: bigint } | null;
}

const SESSION = ["open", "extended hours", "closed"] as const;

export async function readMarket(client: PublicClient, market: Market): Promise<MarketState> {
  const id = BigInt(market.id);
  const [m, regime] = await Promise.all([
    client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [id] }),
    client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "regimeOf", args: [id] }),
  ]);
  const ref = market.causal
    ? await client
        .readContract({ address: m.refAdapter, abi: chainlinkCausalReferenceAbi, functionName: "latest", args: [id] })
        .then(([price, observedAt, status, round]) => ({ price, observedAt, status: Number(status), round }))
        .catch(() => null)
    : null;
  return {
    market,
    active: m.active,
    halted: regime.halted,
    tickSize: m.tickSize,
    baseUnit: m.baseUnit,
    minTick: BigInt(m.minTick),
    maxTick: BigInt(m.maxTick),
    feeBps: Number(m.feeBps),
    maxFeeBps: Number(m.maxFeeBps),
    bandBps: Number(m.bandBps),
    auctions: m.auctions,
    lastCleared: m.lastCleared,
    lastPrice: m.lastPrintTick > 0n ? m.lastPrintTick * m.tickSize : null,
    reference: ref,
  };
}

export const readMarkets = (client: PublicClient) => Promise.all(markets.map((m) => readMarket(client, m)));

/** What a person or agent reads about a market (strings throughout, so `--json` output is exact). */
export function describeMarket(s: MarketState, nowSec: bigint) {
  const q = s.market.quote;
  const price = (p: bigint | null) => (p === null ? null : `${fromUnits(p, q.decimals)} ${q.symbol}`);
  return {
    id: s.market.id,
    market: s.market.symbol,
    rule: s.market.control ? "old rule: priced when the auction clears (the challenge's control; not for trading)" : s.market.causal ? "causal: priced at Chainlink's first observation after your order is sealed" : "priced when the auction clears",
    state: s.halted ? "halted" : !s.active ? "inactive" : s.reference ? (SESSION[s.reference.status] ?? "closed") : "open",
    reference: s.reference ? price(s.reference.price) : null,
    referenceAgeSec: s.reference ? Number(nowSec - s.reference.observedAt) : null,
    chainlinkRound: s.reference ? s.reference.round.toString() : null,
    lastAuctionPrice: price(s.lastPrice),
    auctions: s.auctions.toString(),
    fee: `${s.feeBps / 100}%`,
    priceStep: `${fromUnits(s.tickSize, q.decimals)} ${q.symbol}`,
  };
}
