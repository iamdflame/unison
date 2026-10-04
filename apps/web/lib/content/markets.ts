import config from "../../../../deploy/monad-mainnet.json";

/** Public market specification, read straight from the mainnet deploy config (one source of truth). */
export interface MarketSpec {
  id: number;
  symbol: string; // "aNVDA/AUSD"
  ticker: string; // "aNVDA"
  underlying: string; // "NVDA"
  name: string;
  kind: "equity" | "etf" | "gold" | "fx" | "crypto";
  reference: "operator" | "chainlink" | "pyth" | "manual";
  tickSize: bigint;
  bandBps: number;
  feeBps: number;
  regime: { extBandBps: number; reopenBandBps: number; discFloorBps: number; discCapBps: number; discHorizonSec: number; discCadence: number };
  /** quote units (AUSD, 6 decimals) */
  seedPrice: bigint;
}

const NAMES: Record<string, [string, string, MarketSpec["kind"]]> = {
  aNVDA: ["NVDA", "NVIDIA", "equity"],
  aSPY: ["SPY", "S&P 500 ETF", "etf"],
  aQQQ: ["QQQ", "Nasdaq-100 ETF", "etf"],
  aAAPL: ["AAPL", "Apple", "equity"],
  aTSLA: ["TSLA", "Tesla", "equity"],
  aCOIN: ["COIN", "Coinbase", "equity"],
  aMSTR: ["MSTR", "Strategy", "equity"],
  aGLD: ["GLD", "Gold (SPDR)", "gold"],
  WMON: ["MON", "Monad", "crypto"],
  GBPm: ["GBP", "British pound", "fx"],
};

type RawMarket = (typeof config.markets)[number];

export const MARKETS: readonly MarketSpec[] = (config.markets as RawMarket[]).map((m, id) => {
  const ticker = m.symbol.split("/")[0]!;
  const [underlying, name, kind] = NAMES[ticker] ?? [ticker, ticker, "equity"];
  const [extBandBps, reopenBandBps, discFloorBps, discCapBps, discHorizonSec, discCadence] = m.regime as number[];
  return {
    id,
    symbol: m.symbol,
    ticker,
    underlying,
    name,
    kind,
    reference: m.reference as MarketSpec["reference"],
    tickSize: BigInt(m.tickSize),
    bandBps: m.bandBps,
    feeBps: m.feeBps,
    regime: {
      extBandBps: extBandBps!,
      reopenBandBps: reopenBandBps!,
      discFloorBps: discFloorBps!,
      discCapBps: discCapBps!,
      discHorizonSec: discHorizonSec!,
      discCadence: discCadence!,
    },
    seedPrice: BigInt(m.seedPrice),
  };
});

export const marketByTicker = (ticker: string) => MARKETS.find((m) => m.ticker.toLowerCase() === ticker.toLowerCase());

/** A market's prices: one tick in dollars, the decimals prices print with, and tick → "$180.27". */
export function priceFormat(spec: MarketSpec) {
  const unit = Number(spec.tickSize) / 1e6;
  const decimals = unit >= 0.01 ? 2 : unit >= 0.0001 ? 4 : 6;
  return { unit, decimals, fmt: (tick: number) => `$${(tick * unit).toFixed(decimals)}` };
}
