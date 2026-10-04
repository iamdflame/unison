/**
 * Typed client for the tape (services/tape, docs/API.md): history over REST, live data over SSE.
 *
 *   const tape = new TapeClient("https://tape.unison.trade");
 *   const [nvda] = await tape.markets();
 *   const stop = tape.stream(["heads", "prints:0"], { print: (p) => draw(p), head: (h) => tick(h.block) });
 *
 * Amounts and prices are decimal strings of integer units; times are milliseconds since the epoch.
 */

export type RegimeName = "LIVE" | "EXTENDED" | "DISCOVERY" | "REOPENING" | "HALTED";

export interface Print {
  marketId: number;
  upTo: number;
  block: number;
  tx: string;
  logIndex: number;
  ts: number;
  tick: number;
  price: string;
  volume: string;
  refPrice: string;
  refTimeMs: number;
  status: number;
  regime: RegimeName;
  /** ticks; 0 when halted */
  bandLo: number;
  bandHi: number;
  receiptHash: string;
  prevReceiptHash: string;
  /** the receipt hash chain links and recomputes at this print */
  chainOk: boolean;
  /** (price − ref) / ref in bp; null when nothing traded */
  deviationBps: number | null;
}

export interface ReferenceQuote {
  price: string;
  publishTimeMs: number;
  status: number;
}

export interface MarketSummary {
  id: number;
  symbol: string;
  base: string;
  quote: string;
  vault: string | null;
  reference: "operator" | "chainlink" | "pyth" | "manual";
  tickSize: string;
  baseUnit: string;
  baseDecimals: number;
  quoteDecimals: number;
  status: 0 | 1 | 2 | 3;
  regime: RegimeName;
  halted: boolean;
  lastPrint: Print | null;
  auctions: number;
  ref: ReferenceQuote | null;
  volume24h: string;
  prints24h: number;
  open24h: string | null;
}

export type CandleResolution = "1m" | "5m" | "15m" | "1h" | "1d";

export interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

export type FairnessWindow = "1h" | "24h" | "7d";

export interface Fairness {
  batches: number;
  traded: number;
  volume: string;
  meanAbsDevBps: number;
  p95AbsDevBps: number;
  maxAbsDevBps: number;
  meanRefLagMs: number;
  p95RefLagMs: number;
  chainOk: boolean;
  histogram: { bps: number; count: number }[];
}

export interface PendingOrder {
  account: string;
  slot: number;
  side: 0 | 1;
  tick: number;
  qty: string;
  flags: number;
  batch: number;
}

export interface PendingOrders {
  lastCleared: number;
  orders: PendingOrder[];
}

export type OrderStatus = "pending" | "open" | "closed" | "cancelled";

export interface OrderClaim {
  tx: string;
  ts: number;
  baseAmount: string;
  quoteAmount: string;
  fee: string;
  done: boolean;
}

export interface AccountOrder {
  marketId: number;
  slot: number;
  side: 0 | 1;
  tick: number;
  qty: string;
  flags: number;
  batch: number;
  placedTx: string;
  placedTs: number;
  /** closed = fully filled or IOC remainder released */
  status: OrderStatus;
  filled: string;
  quote: string;
  fee: string;
  avgPrice: string | null;
  claims: OrderClaim[];
}

export interface Fill {
  marketId: number;
  slot: number;
  side: 0 | 1;
  baseAmount: string;
  quoteAmount: string;
  fee: string;
  done: boolean;
  tx: string;
  block: number;
  ts: number;
}

export interface Transfer {
  kind: "deposit" | "withdraw";
  token: string;
  amount: string;
  counterparty: string;
  tx: string;
  ts: number;
}

export interface TapeSession {
  key: string;
  /** unix seconds; 0 = revoked */
  expiry: number;
  maxQty: string;
  maxNotional: string;
  marketMask: string;
  tx: string;
  ts: number;
}

export interface PasskeyInfo {
  account: string;
  qx: string;
  qy: string;
}

export type VaultResolution = "1h" | "1d";

export interface VaultPoint {
  t: number;
  nav: string;
  supply: string;
  /** quote units per 10^decimals shares */
  sharePrice: string;
  spreadPnl: string;
  inventoryPnl: string;
  base: string;
  quote: string;
}

export interface VaultFlow {
  id: number;
  owner: string;
  kind: "deposit" | "redeem";
  /** deposit: quote units; redeem: shares */
  amount: string;
  requestedTx: string;
  requestedTs: number;
  executed: null | {
    tx: string;
    ts: number;
    shares?: string;
    baseOut?: string;
    quoteOut?: string;
    /** deposit: fee in quote units; redeem: the rate in bps (`Redeemed.swingFee` is a rate) */
    swingFee: string;
  };
}

export interface Receipt {
  order: AccountOrder;
  /** the auctions that filled it */
  prints: Print[];
  verification: { chainOk: boolean; recomputed: boolean | null };
}

export interface TapeHealth {
  ok: boolean;
  chainId: number;
  head: number;
  indexed: number;
  lagBlocks: number;
  startBlock: number;
}

export interface HeadEvent {
  block: number;
  ts: number;
}

export type RegimeEventKind = "halt" | "regime" | "cap" | "tier" | "notice";

export interface RegimeEvent {
  marketId: number;
  kind: RegimeEventKind;
  data: Record<string, unknown>;
}

/** Topics: "heads", "prints", "prints:<id>", "regime", "regime:<id>", "account:<address>". */
export type TapeTopic = string;

export interface TapeStreamHandlers {
  head?: (e: HeadEvent, id: string) => void;
  print?: (e: Print, id: string) => void;
  regime?: (e: RegimeEvent, id: string) => void;
  order?: (e: AccountOrder, id: string) => void;
  fill?: (e: Fill, id: string) => void;
  transfer?: (e: Transfer, id: string) => void;
  session?: (e: TapeSession, id: string) => void;
  open?: () => void;
  /** transport errors; the stream keeps reconnecting until closed */
  error?: (err: unknown) => void;
}

export interface TapeStreamOptions {
  /** resume after this event id ("<block>:<logIndex>"); the tape replays up to 10 minutes */
  lastEventId?: string;
  signal?: AbortSignal;
  /** reconnect delay for the fetch-based reader (EventSource uses the server's retry) */
  reconnectMs?: number;
}

export interface TapeStream {
  close(): void;
  readonly lastEventId: string | undefined;
}

export class TapeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TapeError";
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

const STREAM_EVENTS = ["head", "print", "regime", "order", "fill", "transfer", "session"] as const;

/** Minimal structural view of the browser EventSource (absent in Node unless flagged). */
interface EventSourceLike {
  addEventListener(type: string, listener: (e: { data: string; lastEventId: string }) => void): void;
  close(): void;
  onopen: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}
type EventSourceCtor = new (url: string) => EventSourceLike;

export class TapeClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly customFetch: boolean;

  constructor(baseUrl: string, opts: { fetch?: typeof fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.customFetch = opts.fetch !== undefined;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private url(path: string, q: Query = {}): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) qs.set(k, String(typeof v === "boolean" ? Number(v) : v));
    const s = qs.toString();
    return `${this.baseUrl}${path}${s ? `?${s}` : ""}`;
  }

  private async request(path: string, q?: Query): Promise<Response> {
    const r = await this.fetchImpl(this.url(path, q));
    if (r.ok) return r;
    let code = r.status === 404 ? "NOT_FOUND" : "UNAVAILABLE";
    let message = `HTTP ${r.status}`;
    try {
      const j = (await r.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new TapeError(r.status, code, message);
  }

  private async get<T>(path: string, q?: Query): Promise<T> {
    return (await (await this.request(path, q)).json()) as T;
  }

  health(): Promise<TapeHealth> {
    return this.get("/health");
  }

  async markets(): Promise<MarketSummary[]> {
    return (await this.get<{ markets: MarketSummary[] }>("/v1/markets")).markets;
  }

  market(id: number): Promise<MarketSummary> {
    return this.get(`/v1/markets/${id}`);
  }

  async prints(id: number, q: { limit?: number; before?: number; traded?: boolean } = {}): Promise<Print[]> {
    return (await this.get<{ prints: Print[] }>(`/v1/markets/${id}/prints`, q)).prints;
  }

  /** The same rows as CSV (`from` / `to` in ms). */
  async printsCsv(id: number, q: { from?: number; to?: number } = {}): Promise<string> {
    return (await this.request(`/v1/markets/${id}/prints.csv`, q)).text();
  }

  async candles(id: number, q: { res?: CandleResolution; from?: number; to?: number } = {}): Promise<Candle[]> {
    return (await this.get<{ candles: Candle[] }>(`/v1/markets/${id}/candles`, q)).candles;
  }

  fairness(id: number, q: { window?: FairnessWindow } = {}): Promise<Fairness> {
    return this.get(`/v1/markets/${id}/fairness`, q);
  }

  pending(id: number): Promise<PendingOrders> {
    return this.get(`/v1/markets/${id}/pending`);
  }

  async orders(account: string, q: { status?: "open" | "all" } = {}): Promise<AccountOrder[]> {
    return (await this.get<{ orders: AccountOrder[] }>(`/v1/accounts/${account}/orders`, q)).orders;
  }

  async fills(account: string, q: { limit?: number } = {}): Promise<Fill[]> {
    return (await this.get<{ fills: Fill[] }>(`/v1/accounts/${account}/fills`, q)).fills;
  }

  async transfers(account: string): Promise<Transfer[]> {
    return (await this.get<{ transfers: Transfer[] }>(`/v1/accounts/${account}/transfers`)).transfers;
  }

  async sessions(account: string): Promise<TapeSession[]> {
    return (await this.get<{ sessions: TapeSession[] }>(`/v1/accounts/${account}/sessions`)).sessions;
  }

  /** The registered passkey of an account, or null if it isn't a (registered) passkey account. */
  async passkey(account: string): Promise<PasskeyInfo | null> {
    try {
      return await this.get<PasskeyInfo>(`/v1/passkeys/${account}`);
    } catch (e) {
      if (e instanceof TapeError && e.status === 404) return null;
      throw e;
    }
  }

  async vaultHistory(vault: string, q: { res?: VaultResolution } = {}): Promise<VaultPoint[]> {
    return (await this.get<{ points: VaultPoint[] }>(`/v1/vaults/${vault}/history`, q)).points;
  }

  async vaultFlows(vault: string, q: { owner?: string } = {}): Promise<VaultFlow[]> {
    return (await this.get<{ flows: VaultFlow[] }>(`/v1/vaults/${vault}/flows`, q)).flows;
  }

  receipt(marketId: number, account: string, slot: number): Promise<Receipt> {
    return this.get(`/v1/receipts/${marketId}/${account}/${slot}`);
  }

  /**
   * Subscribes to the live stream. Uses EventSource in browsers and a fetch-based reader elsewhere; both
   * reconnect with Last-Event-ID, so nothing within the tape's 10-minute replay window is missed.
   */
  stream(topics: TapeTopic[], handlers: TapeStreamHandlers, opts: TapeStreamOptions = {}): TapeStream {
    const ES = (globalThis as { EventSource?: EventSourceCtor }).EventSource;
    if (ES && !this.customFetch) return this.streamWithEventSource(ES, topics, handlers, opts);
    return this.streamWithFetch(topics, handlers, opts);
  }

  private streamWithEventSource(ES: EventSourceCtor, topics: TapeTopic[], h: TapeStreamHandlers, opts: TapeStreamOptions) {
    // EventSource can't set the first Last-Event-ID header; the tape also accepts it as a query parameter
    const es = new ES(this.url("/v1/stream", { topics: topics.join(","), lastEventId: opts.lastEventId }));
    let last = opts.lastEventId;
    es.onopen = () => h.open?.();
    es.onerror = (e) => h.error?.(e);
    for (const name of STREAM_EVENTS) {
      es.addEventListener(name, (ev) => {
        last = ev.lastEventId || last;
        dispatch(h, name, ev.data, ev.lastEventId);
      });
    }
    const close = () => es.close();
    opts.signal?.addEventListener("abort", close, { once: true });
    return {
      close,
      get lastEventId() {
        return last;
      },
    };
  }

  private streamWithFetch(topics: TapeTopic[], h: TapeStreamHandlers, opts: TapeStreamOptions): TapeStream {
    const ctl = new AbortController();
    let last = opts.lastEventId;
    let closed = false;
    const close = () => {
      closed = true;
      ctl.abort();
    };
    opts.signal?.addEventListener("abort", close, { once: true });
    const run = async () => {
      while (!closed) {
        try {
          const r = await this.fetchImpl(this.url("/v1/stream", { topics: topics.join(",") }), {
            headers: { accept: "text/event-stream", ...(last ? { "last-event-id": last } : {}) },
            signal: ctl.signal,
          });
          if (!r.ok || !r.body) throw new TapeError(r.status, "UNAVAILABLE", `stream: HTTP ${r.status}`);
          h.open?.();
          for await (const ev of readSse(r.body)) {
            if (ev.id) last = ev.id;
            if (ev.event) dispatch(h, ev.event, ev.data, ev.id ?? "");
          }
        } catch (e) {
          if (closed) return;
          h.error?.(e);
        }
        if (!closed) await new Promise((res) => setTimeout(res, opts.reconnectMs ?? 1_000));
      }
    };
    void run();
    return {
      close,
      get lastEventId() {
        return last;
      },
    };
  }
}

function dispatch(h: TapeStreamHandlers, event: string, data: string, id: string) {
  const fn = (h as Record<string, ((e: unknown, id: string) => void) | undefined>)[event];
  if (!fn || !(STREAM_EVENTS as readonly string[]).includes(event)) return;
  try {
    fn(JSON.parse(data), id);
  } catch (e) {
    h.error?.(e);
  }
}

export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

/** Parses a text/event-stream body (comments and retry fields are skipped). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";
  let msg: SseMessage = { data: "" };
  let hasData = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1));
        if (line === "") {
          if (hasData || msg.event) yield msg;
          msg = { data: "" };
          hasData = false;
          continue;
        }
        if (line.startsWith(":")) continue;
        const i = line.indexOf(":");
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "data") {
          msg.data = hasData ? `${msg.data}\n${value}` : value;
          hasData = true;
        } else if (field === "event") msg.event = value;
        else if (field === "id") msg.id = value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
