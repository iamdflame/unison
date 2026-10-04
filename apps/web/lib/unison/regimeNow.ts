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
 * FX trades Sunday 22:00 → Friday 22:00 UTC (contracts/src/pricing/Session.sol FX_OPEN / FX_CLOSE, seconds since
 * Monday 00:00 UTC). Returns the status and, when closed, when the window shut.
 */
const WEEK = 7 * 86_400;
const FX_OPEN = 597_600;
const FX_CLOSE = 424_800;
function fxSession(now: Date): { status: number; closedSince: Date | null } {
  const unix = Math.floor(now.getTime() / 1000);
  const mondayUtc = unix - ((unix - 4 * 86_400) % WEEK); // the epoch began on a Thursday
  const sec = unix - mondayUtc;
  const open = sec >= FX_OPEN || sec < FX_CLOSE;
  return { status: open ? 0 : 2, closedSince: open ? null : new Date((mondayUtc + FX_CLOSE) * 1000) };
}

/**
 * The regime and band an equity market would clear under at `now`, from the bit-exact engine port and the market's
 * mainnet parameters. DISCOVERY widens with √(time since the close), so on a Saturday the band is visibly wider than
 * on a Friday night.
 */
export function regimeNow(m: MarketSpec, now: Date = new Date()): RegimeNow {
  const fx = m.kind === "fx" ? fxSession(now) : null;
  const status = m.kind === "crypto" ? 0 : fx ? fx.status : usEquitySession(now);
  const closed = status === 2 ? (fx ? fx.closedSince : lastClose(now)) : null;
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
