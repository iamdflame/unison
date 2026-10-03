/**
 * The relay core: keeps the latest published reference per market and signs batch-bound reports.
 *
 * Publication policy (SPEC §7.2):
 *   - OPEN / EXTENDED: the reference is the provider's latest price (if fresh).
 *   - CLOSED: the reference is FROZEN at the last price published while open (Friday's close), with status
 *     CLOSED; Unison's DISCOVERY auctions discover the weekend price around it within a √t band.
 *   - HALTED: manual / mirrored halt; the frozen price is published with status HALTED.
 * Every report carries a publish time ≥ the previous one for the market (the adapter enforces monotonicity)
 * and is bound to one batch ≤ the chain head, so it can't be stockpiled for future auctions.
 */
import type { Address, Hex, LocalAccount } from "viem";
import {
  encodeReport,
  reportToJson,
  signReferenceEcdsa,
  Status,
  usEquitySession,
  type SignedReport,
  type StatusCode,
} from "@unison/sdk";
import { effectiveStatus, type PriceProvider, type Quote } from "./providers.ts";

export interface RelayMarket {
  marketId: bigint;
  symbol: string;
  provider: PriceProvider;
  /** session source: "us-equity" calendar, or "always" for 24/7 dev markets */
  session: "us-equity" | "always";
  maxStaleMs: number;
}

export interface RelayConfig {
  chainId: number;
  venue: Address;
  adapter: Address;
  signer: LocalAccount;
  signerId: number;
  markets: RelayMarket[];
  /** reject batches older than head - maxBatchLag */
  maxBatchLag: bigint;
  headBlock: () => Promise<bigint>;
  now?: () => number;
  sessionOverride?: StatusCode;
}

interface MarketState {
  published?: bigint; // last reference published while open (frozen when closed)
  lastQuote?: Quote;
  lastPublishMs: number;
  halted: boolean;
}

export class RelayError extends Error {
  readonly status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export class Relay {
  readonly cfg: RelayConfig;
  private readonly state = new Map<bigint, MarketState>();

  constructor(cfg: RelayConfig) {
    this.cfg = cfg;
    for (const m of cfg.markets) this.state.set(m.marketId, { lastPublishMs: 0, halted: false });
  }

  private now(): number {
    return this.cfg.now ? this.cfg.now() : Date.now();
  }

  private market(marketId: bigint): [RelayMarket, MarketState] {
    const m = this.cfg.markets.find((x) => x.marketId === marketId);
    const s = this.state.get(marketId);
    if (!m || !s) throw new RelayError(404, `unknown market ${marketId}`);
    return [m, s];
  }

  setHalt(marketId: bigint, halted: boolean): void {
    this.market(marketId)[1].halted = halted;
  }

  /** Current reference (price + status) without signing. */
  async current(marketId: bigint): Promise<{ price: bigint; status: StatusCode; observedAtMs?: number }> {
    const [m, s] = this.market(marketId);
    const nowMs = this.now();
    let quote: Quote | undefined;
    try {
      quote = await m.provider.latest();
      s.lastQuote = quote;
    } catch {
      quote = s.lastQuote;
    }
    const session = this.cfg.sessionOverride ?? (m.session === "always" ? Status.OPEN : usEquitySession(new Date(nowMs)));
    let status = effectiveStatus(session, quote, m.maxStaleMs, nowMs);
    if (s.halted) status = Status.HALTED;
    if ((status === Status.OPEN || status === Status.EXTENDED) && quote) s.published = quote.price;
    if (s.published === undefined) {
      if (!quote) throw new RelayError(503, `no price for market ${marketId}`);
      s.published = quote.price; // first boot while closed: seed from the provider
    }
    return { price: s.published, status, ...(quote ? { observedAtMs: quote.observedAtMs } : {}) };
  }

  /** Signs the reference for `batch` of `marketId`. */
  async sign(marketId: bigint, batch: bigint): Promise<{ report: SignedReport; payload: Hex }> {
    const head = await this.cfg.headBlock();
    if (batch > head) throw new RelayError(400, `batch ${batch} is in the future (head ${head})`);
    if (batch + this.cfg.maxBatchLag < head) throw new RelayError(400, `batch ${batch} is too old (head ${head})`);
    const [, s] = this.market(marketId);
    const { price, status } = await this.current(marketId);
    const publishMs = Math.max(this.now(), s.lastPublishMs);
    s.lastPublishMs = publishMs;
    const sig = await signReferenceEcdsa(this.cfg.signer, this.cfg.signerId, this.cfg.chainId, this.cfg.adapter, {
      venue: this.cfg.venue,
      marketId,
      batch,
      price,
      publishTimeMs: BigInt(publishMs),
      status,
    });
    const report: SignedReport = { price, publishTimeMs: BigInt(publishMs), status, sigs: [sig] };
    return { report, payload: encodeReport(report) };
  }

  async snapshot() {
    const out: Record<string, unknown> = {};
    for (const m of this.cfg.markets) {
      try {
        const c = await this.current(m.marketId);
        out[m.symbol] = { marketId: m.marketId.toString(), price: c.price.toString(), status: c.status, source: m.provider.name };
      } catch (e) {
        out[m.symbol] = { error: (e as Error).message };
      }
    }
    return out;
  }
}

export const reportJson = reportToJson;
