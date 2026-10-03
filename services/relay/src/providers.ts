/**
 * Price providers for the reference relay. Every provider returns the latest observed price of one symbol
 * in quote units (6-decimals USD for AUSD markets) plus the time it was observed.
 *
 * Licensing: `alpaca` (IEX feed, free tier) is a licensed real-time source for development; production
 * equities use a licensed consolidated feed (Pyth Pro / Chainlink Data Streams adapters on-chain).
 * `yahoo` is an unofficial endpoint — demo only, never for real money.
 */
import { Status, type StatusCode } from "@unison/sdk";

export interface Quote {
  price: bigint;
  observedAtMs: number;
}

export interface PriceProvider {
  readonly name: string;
  latest(): Promise<Quote>;
}

export const toUnits = (x: number, decimals = 6): bigint => BigInt(Math.round(x * 10 ** decimals));

/** Constant price (tests). */
export class FixedProvider implements PriceProvider {
  readonly name = "fixed";
  price: bigint;
  constructor(price: bigint) {
    this.price = price;
  }
  async latest(): Promise<Quote> {
    return { price: this.price, observedAtMs: Date.now() };
  }
}

/**
 * Geometric Brownian motion for development and demos. The "true" price keeps moving 24/7 (weekend news),
 * while the relay only *publishes* it when the reference market is open — exactly the real-world situation
 * that Unison's DISCOVERY regime exists for.
 */
export class SimProvider implements PriceProvider {
  readonly name = "sim";
  private px: number;
  private lastMs: number;
  private readonly sigmaPerSqrtMs: number;
  private seed: number;

  constructor(start: number, annualVol = 0.3, seed = 7) {
    this.px = start;
    this.lastMs = Date.now();
    this.sigmaPerSqrtMs = annualVol / Math.sqrt(365.25 * 24 * 3600 * 1000);
    this.seed = seed;
  }

  private gauss(): number {
    // deterministic LCG + Box–Muller, so demo runs are reproducible
    this.seed = (this.seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const u1 = (this.seed + 1) / 2_147_483_649;
    this.seed = (this.seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const u2 = (this.seed + 1) / 2_147_483_649;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  async latest(): Promise<Quote> {
    const now = Date.now();
    const dt = Math.max(0, now - this.lastMs);
    if (dt > 0) {
      const s = this.sigmaPerSqrtMs * Math.sqrt(dt);
      this.px *= Math.exp(-0.5 * s * s + s * this.gauss());
      this.lastMs = now;
    }
    return { price: toUnits(this.px), observedAtMs: now };
  }
}

/** Alpaca market data (IEX), latest trade. Requires ALPACA_KEY_ID / ALPACA_SECRET_KEY. */
export class AlpacaProvider implements PriceProvider {
  readonly name = "alpaca";
  readonly symbol: string;
  private readonly key: string;
  private readonly secret: string;

  constructor(symbol: string, key: string, secret: string) {
    this.symbol = symbol;
    this.key = key;
    this.secret = secret;
  }

  async latest(): Promise<Quote> {
    const r = await fetch(`https://data.alpaca.markets/v2/stocks/${this.symbol}/trades/latest?feed=iex`, {
      headers: { "APCA-API-KEY-ID": this.key, "APCA-API-SECRET-KEY": this.secret },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) throw new Error(`alpaca ${this.symbol}: HTTP ${r.status}`);
    const j = (await r.json()) as { trade?: { p: number; t: string } };
    if (!j.trade) throw new Error(`alpaca ${this.symbol}: no trade`);
    return { price: toUnits(j.trade.p), observedAtMs: Date.parse(j.trade.t) };
  }
}

/** Yahoo Finance chart endpoint (unofficial, demo only). */
export class YahooProvider implements PriceProvider {
  readonly name = "yahoo";
  readonly symbol: string;
  constructor(symbol: string) {
    this.symbol = symbol;
  }
  async latest(): Promise<Quote> {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=1m&range=1d&includePrePost=true`,
      { headers: { "user-agent": "Mozilla/5.0 unison-relay" }, signal: AbortSignal.timeout(3_000) },
    );
    if (!r.ok) throw new Error(`yahoo ${this.symbol}: HTTP ${r.status}`);
    const j = (await r.json()) as {
      chart: { result?: { meta: { regularMarketPrice: number; regularMarketTime: number } }[] };
    };
    const meta = j.chart.result?.[0]?.meta;
    if (!meta) throw new Error(`yahoo ${this.symbol}: no data`);
    return { price: toUnits(meta.regularMarketPrice), observedAtMs: meta.regularMarketTime * 1000 };
  }
}

/** Status policy: the calendar decides the session; a stale source can only downgrade OPEN/EXTENDED. */
export function effectiveStatus(session: StatusCode, quote: Quote | undefined, maxStaleMs: number, nowMs: number): StatusCode {
  if (session === Status.HALTED || session === Status.CLOSED) return session;
  if (!quote || nowMs - quote.observedAtMs > maxStaleMs) return Status.CLOSED;
  return session;
}
