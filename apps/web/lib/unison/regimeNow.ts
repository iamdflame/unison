import { deriveRegime, regimeBandBps, type RegimeName } from "@unison/engine";
import { usEquitySession } from "@unison/sdk";
import type { MarketSpec } from "../content/markets.ts";
import { lastClose } from "../time/market.ts";

export interface RegimeNow {
  name: RegimeName;
  /** Band half-width in basis points for an auction right now (the contract's `_regimeBandBps`). */
  bandBps: number;
  /** Reference session status (0 OPEN, 1 EXTENDED, 2 CLOSED). */
  status: number;
  /** When the reference market closed, if it's closed. */
  closedSince: Date | null;
}

/**
 * The regime and band an equity market would clear under at `now`, from the bit-exact engine port and the market's
 * mainnet parameters. DISCOVERY widens with √(time since the close), so on a Saturday the band is visibly wider than
 * on a Friday night.
 */
export function regimeNow(m: MarketSpec, now: Date = new Date()): RegimeNow {
  const status = m.kind === "crypto" ? 0 : usEquitySession(now);
  const closed = status === 2 ? lastClose(now) : null;
  const regime = {
    ...m.regime,
    halted: false,
    closedSince: closed ? Math.floor(closed.getTime() / 1000) : 0,
    lastDiscoveryBatch: 0,
  };
  const market = { bandBps: m.bandBps, lastStatus: status };
  const bandBps = Number(regimeBandBps({ market, regime, status, now: Math.floor(now.getTime() / 1000) }));
  return { name: deriveRegime({ status, lastStatus: status }), bandBps, status, closedSince: closed };
}

export const REGIME_LABEL: Record<RegimeName, string> = {
  LIVE: "Live",
  EXTENDED: "Extended hours",
  DISCOVERY: "Discovery",
  REOPENING: "Reopening cross",
  HALTED: "Halted",
};

/** "±4.31%" */
export const bandLabel = (bps: number) => `±${(bps / 100).toFixed(2)}%`;
