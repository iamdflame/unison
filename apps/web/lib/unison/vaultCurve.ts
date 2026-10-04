import type { VaultParams } from "../content/markets.ts";

/**
 * TypeScript port of `LiquidityVault.curve` (contracts/src/liquidity/LiquidityVault.sol), integer for integer, so
 * the page can show what the vault would quote for any reference, regime and inventory. Solidity's int division
 * truncates toward zero, as BigInt's does.
 */
export type RefStatus = "OPEN" | "EXTENDED" | "CLOSED" | "HALTED";

export interface VaultQuote {
  /** highest bid tick and ticks quoted below it (0 = no bids) */
  bidTop: number;
  bidTicks: number;
  /** lowest ask tick and ticks quoted above it (0 = no asks) */
  askBottom: number;
  askTicks: number;
  /** base units per tick, each side */
  perTick: bigint;
  /** half-spread in ticks, after the regime multiplier */
  half: number;
  /** inventory skew in ticks (> 0: overweight base, both sides move down) */
  skew: number;
}

const NONE: VaultQuote = { bidTop: 0, bidTicks: 0, askBottom: 0, askTicks: 0, perTick: 0n, half: 0, skew: 0 };

export function vaultCurve(
  p: VaultParams,
  v: { refPrice: bigint; refTick: number; status: RefStatus; baseBalance: bigint; quoteBalance: bigint; baseUnit: bigint },
): VaultQuote {
  if (v.refPrice === 0n || v.status === "HALTED") return NONE;
  const baseVal = (v.baseBalance * v.refPrice) / v.baseUnit;
  const navQ = v.quoteBalance + baseVal;
  if (navQ === 0n) return NONE;

  const mult = v.status === "OPEN" ? 1n : v.status === "EXTENDED" ? BigInt(p.extMult) : BigInt(p.closedMult);
  let half = (BigInt(v.refTick) * BigInt(p.spreadBps) * mult) / 10_000n;
  if (half === 0n) half = 1n;
  const skew = (((baseVal * 10_000n) / navQ - 5_000n) * BigInt(p.maxSkewTicks)) / 5_000n;

  const bidTop = BigInt(v.refTick) - half - skew;
  const askBot = BigInt(v.refTick) + half - skew;
  let perTickQuote = (navQ * BigInt(p.depthBps)) / 10_000n;
  const sideCap = (navQ * BigInt(p.maxAuctionBps)) / 10_000n;
  if (perTickQuote * BigInt(p.widthTicks) > sideCap) perTickQuote = sideCap / BigInt(p.widthTicks);
  const perTick = (perTickQuote * v.baseUnit) / v.refPrice;
  if (perTick === 0n) return { ...NONE, half: Number(half), skew: Number(skew) };

  return {
    bidTop: bidTop >= 1n ? Number(bidTop) : 0,
    bidTicks: bidTop >= 1n ? p.widthTicks : 0,
    askBottom: askBot >= 1n ? Number(askBot) : 0,
    askTicks: askBot >= 1n ? p.widthTicks : 0,
    perTick,
    half: Number(half),
    skew: Number(skew),
  };
}

/** The status the vault sees for a regime (REOPENING and LIVE are both an OPEN reference). */
export const statusOfRegime = (regime: string): RefStatus =>
  regime === "EXTENDED" ? "EXTENDED" : regime === "DISCOVERY" ? "CLOSED" : regime === "HALTED" ? "HALTED" : "OPEN";
