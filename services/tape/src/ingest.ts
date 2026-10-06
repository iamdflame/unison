/**
 * The indexer. Logs of the exchange, the gateway, every vault and the operator reference adapter flow in from:
 *
 *   backfill   eth_getLogs from `deployment.startBlock ?? 0` in windows of ≤ 100 blocks (Monad's public RPC
 *              cap), up to 4 windows in flight, committed strictly in order; 429s and errors back off
 *   live       a WebSocket (RPC_WS_URL): `logs` plus `monadNewHeads` (falling back to `newHeads`; Monad sends
 *              one message per commit state, so heads are deduplicated by number), and a reconciliation
 *              getLogs poll every ~1 s from the last indexed block. Logs that come back `removed` are retracted.
 *
 * Every commit is one SQLite transaction; its SSE events are published after it commits. Vaults are snapshotted
 * every 60 s, and the relay's reference prices are polled every second when RELAY_URL is set.
 */
import { encodeEventTopics, erc20Abi, type Address, type Hex, type Log, type PublicClient } from "viem";
import { liquidityVaultAbi, Status, unisonExchangeAbi, type Deployment, type MarketState, type RegimeState } from "@unison/sdk";
import type { ReferenceQuote } from "@unison/sdk/tape";
import type { PrintRow, TapeRecord, TapeStore } from "./db.ts";
import { LogDecoder, type RawLog } from "./decode.ts";
import { derivePrint, toPrint, ZERO_HASH } from "./derive.ts";
import type { StreamHub } from "./stream.ts";
import { fillOf, latestSessions, slotOrder, transferOf, viewOf, type MarketMeta, type TapeState } from "./views.ts";

export interface IndexerConfig {
  client: PublicClient;
  deployment: Deployment;
  store: TapeStore;
  hub: StreamHub;
  wsUrl?: string;
  relayUrl?: string;
  windowBlocks?: number;
  maxInFlight?: number;
  pollMs?: number;
  snapshotMs?: number;
  refPollMs?: number;
  /** skip the chain reads in `init` (tests) */
  markets?: MarketMeta[];
  log?: (m: Record<string, unknown>) => void;
}

interface Window {
  from: number;
  to: number;
  logs: RawLog[];
  ts: Map<number, number>;
}

class Stopped extends Error {}

const BATCH_CLEARED = encodeEventTopics({ abi: unisonExchangeAbi, eventName: "BatchCleared" })[0];
const REF_STALE_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRateLimit = (e: unknown) => {
  const s = `${(e as { status?: number }).status ?? ""} ${(e as Error).message ?? ""}`;
  return /\b429\b|rate.?limit|too many requests/i.test(s);
};

/** viem log → RawLog. */
export function rawOf(l: Log | Record<string, unknown>): RawLog {
  const x = l as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "string" ? Number(BigInt(v)) : Number(v as bigint | number));
  const ts = x.blockTimestamp;
  return {
    address: String(x.address),
    topics: x.topics as Hex[],
    data: x.data as Hex,
    blockNumber: num(x.blockNumber),
    logIndex: num(x.logIndex),
    transactionHash: String(x.transactionHash),
    removed: Boolean(x.removed),
    ...(ts === undefined || ts === null ? {} : { blockTimestamp: num(ts) }),
  };
}

export class Indexer implements TapeState {
  readonly cfg: IndexerConfig;
  readonly store: TapeStore;
  readonly hub: StreamHub;
  readonly decoder: LogDecoder;
  readonly chainId: number;
  readonly startBlock: number;
  readonly markets = new Map<number, MarketMeta>();
  head = 0;
  error: string | undefined;

  private readonly windowBlocks: number;
  private readonly maxInFlight: number;
  private stopped = false;
  private lastHead = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly cleared = new Map<number, number>();
  private readonly haltState = new Map<number, boolean>();
  private readonly refQuotes = new Map<number, ReferenceQuote & { seenAt: number }>();
  private readonly recentTs = new Map<number, number>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private ws: WebSocket | undefined;
  private wsBackoff = 500;
  private vaultDecimals = new Map<string, number>();

  constructor(cfg: IndexerConfig) {
    this.cfg = cfg;
    this.store = cfg.store;
    this.hub = cfg.hub;
    const d = cfg.deployment;
    this.chainId = d.chainId;
    this.startBlock = Number(d.startBlock ?? 0);
    this.windowBlocks = cfg.windowBlocks ?? 100;
    this.maxInFlight = cfg.maxInFlight ?? 4;
    this.decoder = new LogDecoder({
      exchange: d.exchange,
      ...(d.gateway ? { gateway: d.gateway } : {}),
      ...(d.operatorReference ? { operatorReference: d.operatorReference } : {}),
      vaults: Object.values(d.markets).flatMap((m) => (m.vault ? [m.vault] : [])),
    });
    for (const m of cfg.markets ?? []) this.markets.set(m.id, m);
  }

  private log(m: Record<string, unknown>) {
    (this.cfg.log ?? ((x) => console.log(JSON.stringify(x))))({ t: new Date().toISOString(), svc: "tape", ...m });
  }

  // ------------------------------------------------------------------------------------------ state

  get indexed(): number {
    const v = this.store.getMeta("indexed");
    return v === undefined ? this.startBlock - 1 : Number(v);
  }

  private setIndexed(n: number) {
    this.store.setMeta("indexed", String(n));
  }

  lastCleared(marketId: number): number {
    const c = this.cleared.get(marketId);
    if (c !== undefined) return c;
    const last = this.store.lastPrint(marketId);
    const v = Math.max(last?.upTo ?? 0, this.markets.get(marketId)?.lastClearedAtStart ?? 0);
    this.cleared.set(marketId, v);
    return v;
  }

  halted(marketId: number): boolean {
    const h = this.haltState.get(marketId);
    if (h !== undefined) return h;
    const halts = this.store.regimeEvents(marketId, "halt");
    const last = halts[halts.length - 1];
    const v = last ? Boolean((JSON.parse(last.data) as { halted: boolean }).halted) : (this.markets.get(marketId)?.haltedAtStart ?? false);
    this.haltState.set(marketId, v);
    return v;
  }

  relayReference(marketId: number): ReferenceQuote | null {
    const q = this.refQuotes.get(marketId);
    if (!q || Date.now() - q.seenAt > REF_STALE_MS) return null;
    return { price: q.price, publishTimeMs: q.publishTimeMs, status: q.status };
  }

  // ------------------------------------------------------------------------------------------ lifecycle

  /**
   * Reads market metadata (decimals, pricing, state at start) for every deployed market it does not know yet, so a
   * restart that restored some markets from the database still loads the rest. Retries until it succeeds.
   */
  async init(): Promise<void> {
    const { client, deployment } = this.cfg;
    for (const m of Object.values(deployment.markets)) {
      if (this.markets.has(m.id)) continue;
      const meta = await this.retry(async () => {
        const id = BigInt(m.id);
        const [st, rg, bd, qd] = await Promise.all([
          client.readContract({ address: deployment.exchange, abi: unisonExchangeAbi, functionName: "market", args: [id] }),
          client.readContract({ address: deployment.exchange, abi: unisonExchangeAbi, functionName: "regimeOf", args: [id] }),
          client.readContract({ address: m.base, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address: m.quote, abi: erc20Abi, functionName: "decimals" }),
        ]);
        const s = st as unknown as MarketState;
        return {
          id: m.id,
          symbol: m.symbol,
          base: m.base.toLowerCase(),
          quote: m.quote.toLowerCase(),
          vault: m.vault ? m.vault.toLowerCase() : null,
          reference: m.reference,
          tickSize: BigInt(s.tickSize),
          baseUnit: BigInt(s.baseUnit),
          maxFeeBps: BigInt(s.maxFeeBps),
          baseDecimals: Number(bd),
          quoteDecimals: Number(qd),
          lastClearedAtStart: Number(s.lastCleared),
          statusAtStart: Number(s.lastStatus),
          haltedAtStart: (rg as unknown as RegimeState).halted,
        } satisfies MarketMeta;
      }, `market ${m.id}`);
      this.markets.set(m.id, meta);
    }
  }

  /** Initializes, then backfills and tails the chain in the background. */
  async start(): Promise<void> {
    await this.init();
    void this.run();
    if (this.cfg.wsUrl) this.connectWs();
    const snap = this.cfg.snapshotMs ?? 60_000;
    if (snap > 0) {
      void this.snapshotVaults();
      this.timers.push(setInterval(() => void this.snapshotVaults(), snap));
    }
    if (this.cfg.relayUrl) {
      this.timers.push(setInterval(() => void this.pollRefs(), this.cfg.refPollMs ?? 1_000));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.ws?.close();
  }

  private async run() {
    try {
      await this.backfill();
      this.log({ msg: "backfill done", indexed: this.indexed, head: this.head });
      await this.live();
    } catch (e) {
      if (e instanceof Stopped) return;
      this.error = (e as Error).message;
      this.log({ level: "error", msg: "indexer stopped", error: this.error });
    }
  }

  /** Retries `fn` with exponential backoff (longer after 429s) until it succeeds or the tape stops. */
  private async retry<T>(fn: () => Promise<T>, what: string): Promise<T> {
    let delay = 250;
    for (let attempt = 1; ; attempt++) {
      if (this.stopped) throw new Stopped();
      try {
        return await fn();
      } catch (e) {
        if (this.stopped) throw new Stopped();
        const limited = isRateLimit(e);
        if (attempt === 1 || attempt % 10 === 0) {
          this.log({ level: "warn", msg: `${what} failed`, attempt, rateLimited: limited, error: (e as Error).message.split("\n")[0] });
        }
        await sleep(delay * (limited ? 4 : 1) + Math.random() * 100);
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }

  /** Serializes commits (backfill, poll and WebSocket all write through here). */
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  // ------------------------------------------------------------------------------------------ backfill

  private async backfill() {
    for (;;) {
      if (this.stopped) throw new Stopped();
      this.head = Number(await this.retry(() => this.cfg.client.getBlockNumber({ cacheTime: 0 }), "head"));
      let next = this.indexed + 1;
      const target = this.head;
      if (target - next < this.windowBlocks) return; // close to the head: the live tail takes over
      this.log({ msg: "backfill", from: next, to: target });
      const inflight: Promise<Window>[] = [];
      while (next <= target || inflight.length > 0) {
        while (inflight.length < this.maxInFlight && next <= target) {
          const to = Math.min(next + this.windowBlocks - 1, target);
          inflight.push(this.fetchWindow(next, to));
          next = to + 1;
        }
        const w = await inflight.shift()!;
        await this.serial(() => this.commitWindow(w));
      }
    }
  }

  private async fetchWindow(from: number, to: number): Promise<Window> {
    const logs = await this.retry(
      () =>
        this.cfg.client.getLogs({ address: this.decoder.addresses as Address[], fromBlock: BigInt(from), toBlock: BigInt(to) }),
      `getLogs ${from}-${to}`,
    );
    const raw = logs.map(rawOf).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    return { from, to, logs: raw, ts: await this.timestamps(raw) };
  }

  private commitWindow(w: Window) {
    if (w.from > this.indexed + 1) return; // a retraction rewound past this window; it will be refetched
    this.commit(w.logs, w.ts);
    if (w.to > this.indexed) this.setIndexed(w.to);
  }

  // ------------------------------------------------------------------------------------------ live tail

  private async live() {
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        const b = await this.cfg.client.getBlock({ blockTag: "latest" });
        this.head = Number(b.number);
        this.publishHead(this.head, Number(b.timestamp));
        const from = this.indexed + 1;
        if (from <= this.head) {
          const w = await this.fetchWindow(from, Math.min(this.head, from + this.windowBlocks - 1));
          await this.serial(() => this.commitWindow(w));
        }
      } catch (e) {
        if (e instanceof Stopped || this.stopped) return;
        this.log({ level: "warn", msg: "poll failed", error: (e as Error).message.split("\n")[0] });
        await sleep(1_000);
      }
      if (this.head - this.indexed > this.windowBlocks) continue; // still catching up: no pause
      await sleep(Math.max(0, (this.cfg.pollMs ?? 1_000) - (Date.now() - t0)));
    }
  }

  /** One head per block number, whatever source (WebSocket commit states, poll) reported it first. */
  publishHead(block: number, tsSec: number) {
    this.rememberTs(block, tsSec);
    if (block > this.head) this.head = block;
    if (block <= this.lastHead) return;
    this.lastHead = block;
    this.hub.publish("head", block, -1, { block, ts: tsSec * 1000 }, ["heads"]);
  }

  private rememberTs(block: number, tsSec: number) {
    this.recentTs.set(block, tsSec);
    if (this.recentTs.size > 4_096) this.recentTs.delete(this.recentTs.keys().next().value!);
  }

  private connectWs() {
    if (this.stopped || !this.cfg.wsUrl) return;
    const ws = new WebSocket(this.cfg.wsUrl);
    this.ws = ws;
    const pending = new Map<number, "monadNewHeads" | "newHeads" | "logs">();
    const subs = new Map<string, "heads" | "logs">();
    let nextId = 1;
    const subscribe = (kind: "monadNewHeads" | "newHeads" | "logs") => {
      const id = nextId++;
      pending.set(id, kind);
      const params = kind === "logs" ? ["logs", { address: this.decoder.addresses }] : [kind];
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "eth_subscribe", params }));
    };
    ws.addEventListener("open", () => {
      this.wsBackoff = 500;
      this.log({ msg: "websocket connected" });
      subscribe("monadNewHeads");
      subscribe("logs");
    });
    ws.addEventListener("message", (ev) => {
      let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { subscription?: unknown; result?: unknown } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const kind = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          if (kind === "monadNewHeads") subscribe("newHeads");
          else this.log({ level: "warn", msg: `eth_subscribe ${kind} failed`, error: JSON.stringify(msg.error) });
          return;
        }
        subs.set(String(msg.result), kind === "logs" ? "logs" : "heads");
        return;
      }
      if (msg.method !== "eth_subscription" || !msg.params) return;
      const kind = subs.get(String(msg.params.subscription));
      const r = msg.params.result as Record<string, string> | undefined;
      if (!r) return;
      if (kind === "heads" && r.number) this.publishHead(Number(BigInt(r.number)), Number(BigInt(r.timestamp ?? "0x0")));
      if (kind === "logs") this.onWsLog(rawOf(r));
    });
    ws.addEventListener("close", () => {
      if (this.stopped) return;
      this.log({ level: "warn", msg: "websocket closed; reconnecting", inMs: this.wsBackoff });
      setTimeout(() => this.connectWs(), this.wsBackoff);
      this.wsBackoff = Math.min(this.wsBackoff * 2, 30_000);
    });
    ws.addEventListener("error", () => {
      /* "close" follows and reconnects */
    });
  }

  private onWsLog(log: RawLog) {
    void this.serial(async () => {
      if (log.removed) return this.retractLog(log);
      if (log.blockNumber < this.startBlock) return;
      this.commit([log], await this.timestamps([log]));
    }).catch((e) => this.log({ level: "warn", msg: "websocket log", error: (e as Error).message }));
  }

  /** A log the chain dropped: delete it, re-derive the market's chain if it was a print, refetch from there. */
  retractLog(log: RawLog) {
    const rec = this.store.retract(log.blockNumber, log.logIndex, log.transactionHash);
    if (rec?.table === "prints") {
      this.cleared.delete(rec.row.marketId);
      this.rederive(rec.row.marketId, rec.row.block, rec.row.logIndex);
    }
    if (rec?.table === "regime_events") this.haltState.delete(rec.row.marketId);
    if (log.blockNumber <= this.indexed) this.setIndexed(log.blockNumber - 1);
    if (rec) this.log({ msg: "retracted", block: log.blockNumber, logIndex: log.logIndex, table: rec.table });
  }

  // ------------------------------------------------------------------------------------------ commit

  /** Block timestamps (s) for these logs and, for prints, the batch-close block `upTo`. */
  private async timestamps(logs: readonly RawLog[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const need = new Set<number>();
    const want = (b: number) => {
      const known = this.recentTs.get(b) ?? this.store.blockTs(b);
      if (known !== undefined) out.set(b, known);
      else need.add(b);
    };
    for (const l of logs) {
      if (l.blockTimestamp !== undefined) out.set(l.blockNumber, l.blockTimestamp);
      else if (!out.has(l.blockNumber)) want(l.blockNumber);
      if (l.topics[0] === BATCH_CLEARED && l.topics[2]) want(Number(BigInt(l.topics[2])));
    }
    const list = [...need].filter((b) => !out.has(b));
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(
        list.slice(i, i + 8).map(async (b) => {
          const blk = await this.retry(() => this.cfg.client.getBlock({ blockNumber: BigInt(b) }), `block ${b}`);
          out.set(b, Number(blk.timestamp));
        }),
      );
    }
    await this.anchors(logs);
    return out;
  }

  /** When indexing starts mid-history, the receipt chain of each market is anchored at the state before its
   *  first indexed print (needs an archive read; falls back to the zero hash). */
  private async anchors(logs: readonly RawLog[]) {
    if (this.startBlock === 0) return;
    for (const l of logs) {
      if (l.topics[0] !== BATCH_CLEARED || !l.topics[1]) continue;
      const marketId = Number(BigInt(l.topics[1]));
      if (this.store.getMeta(`anchor:${marketId}`) !== undefined || this.store.lastPrint(marketId)) continue;
      let anchor = { receiptHash: ZERO_HASH as string, status: Status.OPEN as number };
      try {
        const m = (await this.cfg.client.readContract({
          address: this.cfg.deployment.exchange,
          abi: unisonExchangeAbi,
          functionName: "market",
          args: [BigInt(marketId)],
          blockNumber: BigInt(l.blockNumber - 1),
        })) as unknown as MarketState;
        anchor = { receiptHash: m.receiptHash.toLowerCase(), status: Number(m.lastStatus) };
      } catch (e) {
        this.log({ level: "warn", msg: "no archive state for the receipt-chain anchor", marketId, error: (e as Error).message.split("\n")[0] });
      }
      this.store.setMeta(`anchor:${marketId}`, JSON.stringify(anchor));
    }
  }

  private anchorOf(marketId: number): { receiptHash: string; status: number } | undefined {
    const a = this.store.getMeta(`anchor:${marketId}`);
    return a === undefined ? undefined : (JSON.parse(a) as { receiptHash: string; status: number });
  }

  /**
   * Writes decoded logs in one transaction and publishes their SSE events once it commits. Idempotent: logs already
   * stored are skipped. `ts` maps block numbers to timestamps in seconds.
   */
  commit(logs: readonly RawLog[], ts: ReadonlyMap<number, number>): void {
    const out: { event: string; block: number; logIndex: number; data: unknown; topics: string[] }[] = [];
    this.store.transaction(() => {
      for (const log of logs) {
        if (log.removed) {
          this.retractLog(log);
          continue;
        }
        const sec = log.blockTimestamp ?? ts.get(log.blockNumber) ?? this.store.blockTs(log.blockNumber);
        if (sec === undefined) throw new Error(`no timestamp for block ${log.blockNumber}`);
        const rec = this.decoder.decode(log, sec * 1000);
        if (!rec) continue;
        if (rec.table === "prints") {
          const prev = this.store.printBefore(rec.row.marketId, rec.row.block, rec.row.logIndex);
          Object.assign(rec.row, derivePrint(rec.row, prev, this.anchorOf(rec.row.marketId)));
          rec.row.closeTs = ts.get(rec.row.upTo) ?? this.store.blockTs(rec.row.upTo) ?? null;
          rec.row.round = this.store.causalRef(rec.row.marketId, rec.row.upTo)?.round ?? null;
        }
        if (!this.store.insert(rec)) continue;
        if (rec.table === "prints") this.store.putBlockTs(rec.row.block, sec);
        out.push(...this.onInserted(rec));
      }
    });
    for (const e of out) this.hub.publish(e.event, e.block, e.logIndex, e.data, e.topics);
  }

  /** Recomputes the derived fields of every print after (block, logIndex) in a market. */
  private rederive(marketId: number, block: number, logIndex: number) {
    let prev: PrintRow | undefined = this.store.printBefore(marketId, block, logIndex);
    for (const p of this.store.printsAfter(marketId, prev?.block ?? -1, prev?.logIndex ?? -1)) {
      const d = derivePrint(p, prev, this.anchorOf(marketId));
      if (d.chainOk !== p.chainOk || d.prevReceiptHash !== p.prevReceiptHash || d.regime !== p.regime) {
        this.store.updatePrintDerived(p.block, p.logIndex, d);
      }
      prev = { ...p, ...d };
    }
  }

  private onInserted(rec: TapeRecord) {
    const out: { event: string; block: number; logIndex: number; data: unknown; topics: string[] }[] = [];
    const at = { block: rec.row.block, logIndex: rec.row.logIndex };
    switch (rec.table) {
      case "prints": {
        const p = rec.row;
        if (this.store.printsAfter(p.marketId, p.block, p.logIndex).length > 0) this.rederive(p.marketId, p.block, p.logIndex);
        this.cleared.set(p.marketId, Math.max(this.lastCleared(p.marketId), p.upTo));
        out.push({ event: "print", ...at, data: toPrint(p), topics: ["prints", `prints:${p.marketId}`] });
        break;
      }
      case "orders_placed":
      case "orders_cancelled":
      case "claims": {
        const r = rec.row;
        const topics = [`account:${r.account}`];
        const o = slotOrder(this.store, r.account, r.marketId, r.slot);
        if (o) out.push({ event: "order", ...at, data: viewOf(this.store, this, o), topics });
        if (rec.table === "claims") out.push({ event: "fill", ...at, data: fillOf(rec.row), topics });
        break;
      }
      case "transfers":
        out.push({ event: "transfer", ...at, data: transferOf(rec.row), topics: [`account:${rec.row.account}`] });
        break;
      case "sessions": {
        const s = latestSessions([rec.row])[0]!;
        out.push({ event: "session", ...at, data: s, topics: [`account:${rec.row.account}`] });
        break;
      }
      case "regime_events": {
        const r = rec.row;
        const data = JSON.parse(r.data) as Record<string, unknown>;
        if (r.kind === "halt") this.haltState.set(r.marketId, Boolean(data.halted));
        out.push({ event: "regime", ...at, data: { marketId: r.marketId, kind: r.kind, data }, topics: ["regime", `regime:${r.marketId}`] });
        break;
      }
      default:
        break;
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ side feeds

  private async snapshotVaults() {
    const { client } = this.cfg;
    for (const m of this.markets.values()) {
      if (!m.vault || this.stopped) continue;
      const address = m.vault as Address;
      try {
        const c = { address, abi: liquidityVaultAbi } as const;
        let decimals = this.vaultDecimals.get(address);
        if (decimals === undefined) {
          decimals = Number(await client.readContract({ ...c, functionName: "decimals" }));
          this.vaultDecimals.set(address, decimals);
        }
        const [nav, supply, balances, spreadPnl, inventoryPnl] = await Promise.all([
          client.readContract({ ...c, functionName: "nav" }),
          client.readContract({ ...c, functionName: "totalSupply" }),
          client.readContract({ ...c, functionName: "balances" }),
          client.readContract({ ...c, functionName: "spreadPnl" }),
          client.readContract({ ...c, functionName: "inventoryPnl" }),
        ]);
        this.store.putVaultSnapshot({
          vault: address.toLowerCase(),
          t: Date.now(),
          block: this.head,
          nav: nav.toString(),
          supply: supply.toString(),
          base: balances[0].toString(),
          quote: balances[1].toString(),
          spreadPnl: spreadPnl.toString(),
          inventoryPnl: inventoryPnl.toString(),
          decimals,
        });
      } catch (e) {
        this.log({ level: "warn", msg: "vault snapshot failed", vault: address, error: (e as Error).message.split("\n")[0] });
      }
    }
  }

  private async pollRefs() {
    try {
      const r = await fetch(`${this.cfg.relayUrl}/prices`, { signal: AbortSignal.timeout(2_000) });
      if (!r.ok) return;
      const j = (await r.json()) as Record<string, { marketId?: string; price?: string; status?: number }>;
      const now = Date.now();
      for (const v of Object.values(j)) {
        if (v.marketId === undefined || v.price === undefined) continue;
        this.refQuotes.set(Number(v.marketId), { price: v.price, publishTimeMs: now, status: v.status ?? Status.OPEN, seenAt: now });
      }
    } catch {
      /* relay unreachable: keep the last quotes until they go stale */
    }
  }
}
