/**
 * The keeper: drives every market's clear job, processes vault queues and auto-claims filled orders.
 *
 * Per new block, per market:
 *   1. a job is running            → continue it (no payload needed; the reference was bound at open)
 *   2. pending batches exist, or   → open a job for batch = head - 1 with its reference: the relay's signed
 *      `repriceEvery` blocks passed   report for operator markets, "0x" for push/pull feeds (Chainlink, Pyth,
 *                                     manual). Re-pricing lets resting orders cross the moving band and the curve.
 *   3. after a completed job       → process the market's vault queue if requests wait
 *   4. optionally                  → claim orders whose level closed (frees slots, credits balances)
 * Causal markets (SPEC §7.4) replace step 2: an auction is cleared as soon as the first Chainlink observation after
 * its oldest waiting order lands, naming that observation (the contract checks it is the first, and derives the
 * batch from it). With no such observation yet, the keeper waits, unless the market is closed (session over or feed
 * silent), when a DISCOVERY call auction runs on its cadence. Orders there are sealed, so every auction with waiting
 * orders is cleared, traded or not: its owners are owed an answer.
 * Monad charges the gas LIMIT: clear calls use a fixed, explicit limit (the job pauses itself well before it), or
 * with `clearGas: "auto"` the call's estimate × 1.2, clamped to [minClearGas, maxClearGas]. A job pauses itself
 * once gas runs low, so an estimator can always "succeed" by pausing again at once, settling on a limit that makes
 * no progress. Auto mode therefore never estimates a continuation: a paused job (and the attempt after a failed
 * clear) gets the full maxClearGas, which must cover the auction's one non-yielding step.
 */
import { BaseError, ContractFunctionRevertedError, decodeEventLog, parseAbi, type Address, type Hex } from "viem";
import {
  causalFeed,
  causalPayload,
  closedAt,
  isStreamsAdapter,
  JobPhase,
  latestObservation,
  latestStreamsReport,
  liquidityVaultAbi,
  Status,
  streamsPayload,
  unisonExchangeAbi,
  type CausalFeed,
  type MarketState,
  type Observation,
  type StreamsApi,
  type UnisonClient,
} from "@unison/sdk";

/** IReferenceAdapter.read: a view on ChainlinkReference / ManualReference; eth_call works for every adapter. */
const adapterReadAbi = parseAbi([
  "function read(uint256 marketId, uint256 batch, bytes payload) view returns (uint256 price, uint256 publishTimeMs, uint8 status)",
]);

/**
 * An error, briefly: its first line, the revert itself (its name when the ABI knows it, else its selector, which viem
 * puts on a later line of the message), and viem's `details` (the RPC's own reply) when there is one.
 */
function why(e: unknown): { error: string; revert?: string; details?: string } {
  const err = e as Error & { details?: string; shortMessage?: string };
  const error = (err.shortMessage ?? err.message ?? String(e)).split("\n")[0]!;
  const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  const revert = rev instanceof ContractFunctionRevertedError ? (rev.data?.errorName ?? rev.signature ?? rev.reason) : undefined;
  return { error, ...(revert ? { revert } : {}), ...(err.details ? { details: err.details.slice(0, 300) } : {}) };
}

/** OperatorSignedReference's FutureReport(): a report stamped more than 2 s after the block that reads it. */
const isFutureReport = (e: unknown) => {
  const r = why(e).revert;
  return r === "FutureReport" || r === "0xc6072fe9";
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Chainlink history the causal path reads (injectable, so the policy can be tested without a chain). */
export interface CausalHistory {
  payload(adapter: Address, marketId: bigint, afterSec: bigint): Promise<{ payload: Hex; base: Observation } | null>;
  feed(adapter: Address, marketId: bigint): Promise<CausalFeed>;
  latest(feed: Address): Promise<Observation>;
}

/**
 * Chainlink Data Streams, for markets priced by StreamsCausalReference (docs/evidence/streams.md): the report that
 * prices an auction, and the newest report for a vault's queue. Each comes with whether it is already on chain; the
 * keeper submits it first when it is not. Injectable, so the policy can be tested without the API.
 */
export interface StreamsSource {
  isStreams(adapter: Address): Promise<boolean>;
  /** the auction sealed by `afterSec`: null until the first report after it is out (or with no API credentials) */
  payload(
    adapter: Address,
    marketId: bigint,
    afterSec: bigint,
  ): Promise<{ payload: Hex; fullReport: Hex; stored: boolean; observedAt: bigint } | null>;
  latest(adapter: Address, marketId: bigint): Promise<{ fullReport: Hex; stored: boolean; observedAt: bigint } | null>;
}

export interface KeeperConfig {
  client: UnisonClient;
  /** Data Streams API credentials (server only), for markets on StreamsCausalReference */
  streamsApi?: StreamsApi;
  /** Data Streams access (default: built from `streamsApi` and the client's public client) */
  streams?: StreamsSource;
  relayUrl: string;
  marketIds: bigint[];
  /** explicit gas limit for clear calls, or "auto" = estimateGas × 1.2 within [minClearGas, maxClearGas] */
  clearGas: bigint | "auto";
  /** auto: floor for an opening clear (default 2,000,000) */
  minClearGas?: bigint;
  /** auto: continuations and retries after a failed clear (default 25,000,000) */
  maxClearGas?: bigint;
  repriceEvery: bigint;
  /** pending batches older than this many blocks are merged even if the auction would not trade */
  maxPendingAge: bigint;
  autoClaim: boolean;
  log?: (msg: Record<string, unknown>) => void;
  /** causal markets: chain history (default: the client's public client) */
  history?: CausalHistory;
  /** unix seconds now (default: the system clock) */
  now?: () => bigint;
  /** operator markets: an opening whose report is stamped ahead of the chain is tried this many times (default 11) … */
  futureReportTries?: number;
  /** … this far apart (default 700 ms): about 7 s in all, well inside a report's freshness (maxAgeMs, 15 s on testnet) */
  futureReportWaitMs?: number;
}

interface Tracked {
  account: Address;
  slot: bigint;
  marketId: bigint;
}

export class Keeper {
  readonly cfg: KeeperConfig;
  private busy = false;
  private lastBlock = 0n;
  private readonly open = new Map<string, Tracked>();
  /** the block of each market's last vault process() attempt */
  private readonly processTriedAt = new Map<bigint, bigint>();
  readonly stats = { clears: 0, jobsDone: 0, vaultProcesses: 0, claims: 0, errors: 0 };
  private readonly history: CausalHistory;
  private readonly streams: StreamsSource;
  /** causal mode per market, re-read every minute */
  private readonly modes = new Map<bigint, { on: boolean; skewSec: number; at: number }>();
  private readonly feeds = new Map<bigint, CausalFeed>();
  /** whether each causal adapter reads Data Streams (an adapter never changes kind) */
  private readonly streamsAdapters = new Map<Address, boolean>();

  constructor(cfg: KeeperConfig) {
    this.cfg = cfg;
    const pc = cfg.client.publicClient;
    this.history = cfg.history ?? {
      payload: (adapter, marketId, afterSec) => causalPayload(pc, adapter, marketId, afterSec),
      feed: (adapter, marketId) => causalFeed(pc, adapter, marketId),
      latest: (feed) => latestObservation(pc, feed),
    };
    const api = cfg.streamsApi;
    this.streams = cfg.streams ?? {
      isStreams: (adapter) => isStreamsAdapter(pc, adapter),
      payload: async (adapter, marketId, afterSec) => {
        if (!api) return null;
        const p = await streamsPayload(pc, api, adapter, marketId, afterSec);
        return p && { payload: p.payload, fullReport: p.report.fullReport, stored: p.stored, observedAt: p.observedAt };
      },
      latest: async (adapter, marketId) => {
        if (!api) return null;
        const r = await latestStreamsReport(pc, api, adapter, marketId);
        return r && { fullReport: r.report.fullReport, stored: r.stored, observedAt: r.observedAt };
      },
    };
  }

  private async isStreams(adapter: Address): Promise<boolean> {
    const hit = this.streamsAdapters.get(adapter);
    if (hit !== undefined) return hit;
    const yes = await this.streams.isStreams(adapter);
    this.streamsAdapters.set(adapter, yes);
    if (yes && !this.cfg.streamsApi && !this.cfg.streams) {
      this.log({ level: "warn", action: "streams", adapter, error: "no Data Streams credentials (STREAMS_API_KEY, STREAMS_API_SECRET)" });
    }
    return yes;
  }

  private nowSec(): bigint {
    return this.cfg.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  }

  /** Whether a market prices at Chainlink observations (an exchange from before SPEC §7.4 has no causalOf: no). */
  async causalMode(marketId: bigint): Promise<{ on: boolean; skewSec: number }> {
    const hit = this.modes.get(marketId);
    if (hit && Date.now() - hit.at < 60_000) return hit;
    let mode = { on: false, skewSec: 0 };
    try {
      const r = await this.cfg.client.causal(marketId);
      mode = { on: r.on, skewSec: Number(r.skewSec) };
    } catch {
      /* not causal */
    }
    this.modes.set(marketId, { ...mode, at: Date.now() });
    return mode;
  }

  private log(msg: Record<string, unknown>) {
    // bigints (market ids, rounds, times) print as decimal strings: a log line must never be what throws
    const line = (m: Record<string, unknown>) =>
      console.log(JSON.stringify(m, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
    (this.cfg.log ?? line)({ t: new Date().toISOString(), ...msg });
  }

  /** Records orders placed so auto-claim can settle them later. */
  trackLogs(logs: readonly { data: Hex; topics: readonly Hex[] }[]) {
    for (const l of logs) {
      try {
        const ev = decodeEventLog({ abi: unisonExchangeAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "OrderPlaced") {
          const a = ev.args as { marketId: bigint; account: Address; slot: bigint };
          this.open.set(`${a.account}:${a.slot}`, { account: a.account, slot: a.slot, marketId: a.marketId });
        }
      } catch {
        /* not an exchange event */
      }
    }
  }

  /** Operator-signed markets need the relay's report; every other adapter reads its own feed (payload "0x"). */
  isOperatorMarket(marketId: bigint): boolean {
    const dep = Object.values(this.cfg.client.deployment.markets).find((x) => BigInt(x.id) === marketId);
    return (dep?.reference ?? "operator") === "operator";
  }

  /** Payload and reference status for opening a job covering `upTo`. */
  async reference(marketId: bigint, m: MarketState, upTo: bigint): Promise<{ payload: Hex; status: number }> {
    if (this.isOperatorMarket(marketId)) return this.fetchPayload(marketId, upTo);
    return { payload: "0x", status: await this.adapterStatus(marketId, m, upTo) };
  }

  /** The adapter's current status (for the DISCOVERY cadence), else the status of the market's last clear. */
  async adapterStatus(marketId: bigint, m: MarketState, upTo: bigint): Promise<number> {
    try {
      const [, , status] = await this.cfg.client.publicClient.readContract({
        address: m.refAdapter,
        abi: adapterReadAbi,
        functionName: "read",
        args: [marketId, upTo, "0x"],
      });
      return Number(status);
    } catch {
      return Number(m.lastStatus);
    }
  }

  /** markets whose last clear attempt reverted: the next one gets the full budget */
  private failed = new Set<bigint>();

  /**
   * Gas limit for a clear call: the configured one; or, in auto mode, the estimate × 1.2 for an opening clear
   * (clamped), and the full budget for a continuation or a retry, where an estimate would settle on pausing.
   */
  async clearGasFor(
    functionName: "clear" | "clearUpTo",
    args: readonly unknown[],
    marketId?: bigint,
    opening = functionName === "clearUpTo",
  ): Promise<bigint> {
    if (this.cfg.clearGas !== "auto") return this.cfg.clearGas;
    const min = this.cfg.minClearGas ?? 2_000_000n;
    const max = this.cfg.maxClearGas ?? 25_000_000n;
    if (!opening || (marketId !== undefined && this.failed.has(marketId))) return max;
    const c = this.cfg.client;
    const est = await c.publicClient
      .estimateContractGas({ address: c.exchange, abi: unisonExchangeAbi, functionName, args: args as never, account: c.walletClient!.account })
      .catch(() => max);
    const g = (est * 12n + 9n) / 10n;
    return g < min ? min : g > max ? max : g;
  }

  /**
   * The relay stamps a report with its own clock as it signs, and OperatorSignedReference refuses one stamped more
   * than 2 s after the block that reads it (FutureReport). The latest block an RPC has executed can trail the clock by
   * about that much: block times are whole seconds, Monad executes a few blocks behind consensus, and a public RPC
   * lags a little more, and a container's clock can run fast. So an opening simulated at once can fail where the same
   * report passes a moment later. Wait for the chain to catch up, briefly, rather than leave the auction until the
   * next order arrives.
   */
  private async simulateOpening(marketId: bigint, upTo: bigint, payload: Hex) {
    const tries = this.cfg.futureReportTries ?? 11;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.cfg.client.simulateClearUpTo(marketId, upTo, payload);
      } catch (e) {
        if (attempt >= tries || !isFutureReport(e)) throw e;
        await sleep(this.cfg.futureReportWaitMs ?? 700);
      }
    }
  }

  async fetchPayload(marketId: bigint, batch: bigint): Promise<{ payload: Hex; status: number }> {
    const r = await fetch(`${this.cfg.relayUrl}/reference/${marketId}?batch=${batch}`, {
      signal: AbortSignal.timeout(3_000),
    });
    const j = (await r.json()) as { payload?: Hex; report?: { status: number }; error?: string };
    if (!r.ok || !j.payload || !j.report) throw new Error(`relay: ${j.error ?? r.status}`);
    return { payload: j.payload, status: j.report.status };
  }

  /** One keeper tick for the given chain head. Returns the number of transactions sent. */
  async tick(head: bigint): Promise<number> {
    if (this.busy || head <= this.lastBlock) return 0;
    this.busy = true;
    this.lastBlock = head;
    let sent = 0;
    try {
      for (const marketId of this.cfg.marketIds) sent += await this.serveMarket(marketId, head);
      if (this.cfg.autoClaim) {
        try {
          sent += await this.autoClaim();
        } catch (e) {
          // claiming is a courtesy; clearing is the job. Never let the first stop the second.
          this.log({ level: "warn", action: "claim", ...why(e) });
        }
      }
    } finally {
      this.busy = false;
    }
    return sent;
  }

  private async serveMarket(marketId: bigint, head: bigint): Promise<number> {
    const c = this.cfg.client;
    let sent = 0;
    try {
      const phase = await c.jobPhase(marketId);
      const returned = phase === JobPhase.IDLE && (await this.stopped(marketId)) ? await this.returnOrders(marketId, head) : null;
      if (phase !== JobPhase.IDLE) {
        const gas = await this.clearGasFor("clear", [marketId, "0x"], marketId);
        await this.sendClear(marketId, c.clear(marketId, "0x", gas), { marketId, action: "clear.continue" });
        sent++;
      } else if (returned !== null) {
        sent += returned;
      } else if ((await this.causalMode(marketId)).on) {
        sent += await this.serveCausal(marketId, head);
      } else {
        const m = await c.market(marketId);
        const upTo = head - 1n;
        if (upTo <= m.lastCleared) return 0;
        const pending = m.pendingTail > m.pendingHead;
        const age = upTo - m.lastCleared;
        const queue = await this.vaultQueue(marketId, m.lastRefTimeMs);
        // a vault request that already has a reference published after it needs process(), never another clear:
        // clearing again for it is how a rate-limited process() turned into a clear every few blocks
        if (queue.processable) return await this.processVault(marketId, queue.pending);
        const vaultWaiting = queue.pending > 0n;
        if (!pending && !vaultWaiting && age < this.cfg.repriceEvery) return 0;
        const { payload, status } = await this.reference(marketId, m, upTo);
        if (status === Status.CLOSED) {
          const g = await c.regime(marketId);
          if (g.discCadence > 1 && g.lastDiscoveryBatch !== 0n && upTo < g.lastDiscoveryBatch + BigInt(g.discCadence)) {
            return 0; // DISCOVERY call auctions run every `discCadence` blocks
          }
        }
        // Monad charges the gas limit: only pay for a clear that trades, merges stale pending orders,
        // or gives a waiting vault queue its post-request reference.
        const sim = await this.simulateOpening(marketId, upTo, payload);
        const mustMerge = pending && age >= this.cfg.maxPendingAge;
        if (sim.volume === 0n && !mustMerge && !vaultWaiting) return 0;
        const gas = await this.clearGasFor("clearUpTo", [marketId, upTo, payload], marketId);
        await this.sendClear(marketId, c.clearUpTo(marketId, upTo, payload, gas), {
          marketId,
          action: "clear.open",
          upTo,
        });
        sent++;
      }
      if ((await c.jobPhase(marketId)) === JobPhase.IDLE) {
        this.stats.jobsDone++;
        const after = await this.vaultQueue(marketId, (await c.market(marketId)).lastRefTimeMs);
        if (after.processable) sent += await this.processVault(marketId, after.pending);
      }
    } catch (e) {
      this.stats.errors++;
      this.log({ level: "warn", marketId: marketId.toString(), ...why(e) });
    }
    return sent;
  }

  /** The exchange is paused, or the market halted or made inactive. */
  private async stopped(marketId: bigint): Promise<boolean> {
    const c = this.cfg.client;
    const [paused, m, g] = await Promise.all([c.paused(), c.market(marketId), c.regime(marketId)]);
    return paused || !m.active || g.halted;
  }

  /**
   * A stopped market clears in return-only mode (exchange v3): no reference is read, nothing trades, and every waiting
   * order goes back. Its owners shouldn't wait for an observation that no longer prices anything, so the keeper clears
   * at once. Null when the exchange can't (an implementation before v3): the market is then served as before.
   */
  private async returnOrders(marketId: bigint, head: bigint): Promise<number | null> {
    const c = this.cfg.client;
    const m = await c.market(marketId);
    const upTo = head - 1n;
    if (m.pendingTail <= m.pendingHead || upTo <= m.lastCleared) return 0;
    try {
      await c.simulateClearUpTo(marketId, upTo, "0x");
    } catch {
      return null;
    }
    const gas = await this.clearGasFor("clearUpTo", [marketId, upTo, "0x"], marketId);
    await this.sendClear(marketId, c.clearUpTo(marketId, upTo, "0x", gas), { marketId, action: "clear.return", upTo });
    return 1;
  }

  /**
   * A causal market (SPEC §7.4). The auction for the oldest waiting order is cleared as soon as the first Chainlink
   * observation after it lands; the payload names that observation. Without one, the keeper waits, unless the market
   * is closed (DISCOVERY on its cadence). With nothing waiting, it clears only to give a vault request a reference
   * observed after it.
   */
  private async serveCausal(marketId: bigint, head: bigint): Promise<number> {
    const c = this.cfg.client;
    const { skewSec } = await this.causalMode(marketId);
    const m = await c.market(marketId);
    if (await this.isStreams(m.refAdapter)) return this.serveStreams(marketId, m, skewSec);
    let payload: Hex = "0x";
    const ctx: Record<string, unknown> = { marketId, action: "clear.open", causal: true };
    if (m.pendingTail > m.pendingHead) {
      const [oldest] = await c.pendingTimes(marketId, 1n);
      if (!oldest) return 0;
      const afterSec = oldest.time + BigInt(skewSec);
      const found = await this.history.payload(m.refAdapter, marketId, afterSec);
      if (found) {
        payload = found.payload;
        Object.assign(ctx, { round: found.base.round, observedAt: found.base.observedAt, sealedBefore: afterSec });
      } else {
        // no observation after the oldest order yet: wait for Chainlink, unless the market is closed
        const f = await this.feedOf(marketId, m.refAdapter);
        if (!closedAt(f, await this.history.latest(f.base), this.nowSec())) return 0;
        const g = await c.regime(marketId);
        const upTo = head - 1n;
        if (g.discCadence > 1 && g.lastDiscoveryBatch !== 0n && upTo < g.lastDiscoveryBatch + BigInt(g.discCadence)) {
          return 0;
        }
        ctx.discovery = true;
      }
    } else {
      const queue = await this.vaultQueue(marketId, m.lastRefTimeMs);
      if (queue.processable) return this.processVault(marketId, queue.pending);
      if (queue.pending === 0n) return 0;
      const f = await this.feedOf(marketId, m.refAdapter);
      const latest = await this.history.latest(f.base);
      // an empty clear prices at the latest observation: worth it only if that observation is newer than the
      // last one used and was made after the oldest request
      if (latest.observedAt * 1000n <= m.lastRefTimeMs || latest.observedAt <= queue.oldestTime) return 0;
      ctx.action = "clear.vault";
    }
    // Monad charges the gas limit even for a revert: never send what a simulation refuses
    try {
      await c.simulateClear(marketId, payload);
    } catch (e) {
      this.log({ level: "warn", ...ctx, ...why(e) });
      return 0;
    }
    const gas = await this.clearGasFor("clear", [marketId, payload], marketId, true);
    await this.sendClear(marketId, c.clear(marketId, payload, gas), ctx);
    return 1;
  }

  /**
   * A causal market on Chainlink Data Streams. The auction for the oldest waiting order is cleared with the report
   * whose window holds the second after it (plus the skew), brought on chain first if nobody has yet. Reports come
   * every second, closed sessions included, so there is no DISCOVERY-without-a-report path: until the report is out,
   * the keeper waits. With nothing waiting, a vault request gets the newest report once it is newer than the last
   * reference and later than the request.
   */
  private async serveStreams(marketId: bigint, m: MarketState, skewSec: number): Promise<number> {
    const c = this.cfg.client;
    let payload: Hex = "0x";
    const ctx: Record<string, unknown> = { marketId, action: "clear.open", causal: true, streams: true };
    let report: { fullReport: Hex; stored: boolean; observedAt: bigint } | null;
    if (m.pendingTail > m.pendingHead) {
      const [oldest] = await c.pendingTimes(marketId, 1n);
      if (!oldest) return 0;
      const afterSec = oldest.time + BigInt(skewSec);
      const p = await this.streams.payload(m.refAdapter, marketId, afterSec);
      if (!p) return 0;
      payload = p.payload;
      report = p;
      Object.assign(ctx, { observedAt: p.observedAt, sealedBefore: afterSec });
    } else {
      const queue = await this.vaultQueue(marketId, m.lastRefTimeMs);
      if (queue.processable) return this.processVault(marketId, queue.pending);
      if (queue.pending === 0n) return 0;
      report = await this.streams.latest(m.refAdapter, marketId);
      if (!report || report.observedAt * 1000n <= m.lastRefTimeMs || report.observedAt <= queue.oldestTime) return 0;
      ctx.action = "clear.vault";
    }
    if (!report.stored) {
      await this.send(c.submitStreamsReport(m.refAdapter, report.fullReport), {
        marketId,
        action: "streams.submit",
        observedAt: report.observedAt,
      });
    }
    try {
      await c.simulateClear(marketId, payload);
    } catch (e) {
      this.log({ level: "warn", ...ctx, ...why(e) });
      return 0;
    }
    const gas = await this.clearGasFor("clear", [marketId, payload], marketId, true);
    await this.sendClear(marketId, c.clear(marketId, payload, gas), ctx);
    return 1;
  }

  private async feedOf(marketId: bigint, adapter: Address): Promise<CausalFeed> {
    const hit = this.feeds.get(marketId);
    if (hit) return hit;
    const f = await this.history.feed(adapter, marketId);
    this.feeds.set(marketId, f);
    return f;
  }

  /**
   * The vault's queue in two or three reads (not the nine of a full vault view, every block, for every market): how
   * many requests wait, and whether the oldest already has a reference published after it, so process() can run it.
   */
  private async vaultQueue(
    marketId: bigint,
    lastRefTimeMs: bigint,
  ): Promise<{ pending: bigint; processable: boolean; oldestTime: bigint }> {
    const dep = Object.values(this.cfg.client.deployment.markets).find((x) => BigInt(x.id) === marketId);
    if (!dep?.vault) return { pending: 0n, processable: false, oldestTime: 0n };
    const pc = this.cfg.client.publicClient;
    const v = { address: dep.vault, abi: liquidityVaultAbi } as const;
    const [head, length] = await Promise.all([pc.readContract({ ...v, functionName: "head" }), pc.readContract({ ...v, functionName: "queueLength" })]);
    if (length <= head) return { pending: 0n, processable: false, oldestTime: 0n };
    const oldest = await pc.readContract({ ...v, functionName: "request", args: [head] });
    const oldestTime = BigInt(oldest.time);
    return { pending: length - head, processable: lastRefTimeMs > 0n && oldestTime * 1000n < lastRefTimeMs, oldestTime };
  }

  private async processVault(marketId: bigint, pending: bigint): Promise<number> {
    const c = this.cfg.client;
    const dep = Object.values(c.deployment.markets).find((x) => BigInt(x.id) === marketId);
    if (!dep?.vault || pending === 0n) return 0;
    // Monad charges the gas limit even for a revert: one attempt per market every 20 blocks, never one per block
    const tried = this.processTriedAt.get(marketId);
    if (tried !== undefined && this.lastBlock - tried < 20n) return 0;
    this.processTriedAt.set(marketId, this.lastBlock);
    await this.send(c.processVault(dep.vault), { marketId, action: "vault.process", pending });
    this.stats.vaultProcesses++;
    return 1;
  }

  private async autoClaim(): Promise<number> {
    const c = this.cfg.client;
    const byAccount = new Map<Address, bigint[]>();
    for (const [k, o] of this.open) {
      try {
        const [p, rec] = await Promise.all([c.previewOrder(o.account, o.slot), c.order(o.account, o.slot)]);
        if (!p.merged) continue;
        // unclaimed proceeds: bids are owed base, asks are owed (gross) quote
        const owed = rec.side === 0n ? p.filled - rec.credited : p.quote - rec.credited;
        if (p.closed || owed > 0n) byAccount.set(o.account, [...(byAccount.get(o.account) ?? []), o.slot]);
        if (p.closed) this.open.delete(k); // final: settling it frees the slot
      } catch {
        this.open.delete(k); // slot freed by its owner
      }
    }
    let sent = 0;
    for (const [account, slots] of byAccount) {
      // One claim failing (its owner claimed first, a slot changed under us) must not stop the others, nor the
      // keeper: an unclaimed slot stays tracked and is looked at again next tick.
      try {
        await this.send(c.claim(account, slots), { action: "claim", account, slots: slots.length });
        this.stats.claims += slots.length;
        sent++;
      } catch (e) {
        this.log({ level: "warn", action: "claim", account, slots: slots.length, ...why(e) });
      }
    }
    return sent;
  }

  /** A clear, remembering whether it went through so a failed one is retried with the full budget. */
  private async sendClear(marketId: bigint, p: Promise<Hex>, ctx: Record<string, unknown>) {
    try {
      await this.send(p, ctx);
      this.failed.delete(marketId);
    } catch (e) {
      this.failed.add(marketId);
      throw e;
    }
  }

  private async send(p: Promise<Hex>, ctx: Record<string, unknown>) {
    const hash = await p;
    const r = await this.cfg.client.publicClient.waitForTransactionReceipt({ hash });
    if (ctx.action === "clear.open" || ctx.action === "clear.continue" || ctx.action === "clear.vault") this.stats.clears++;
    this.log({
      ...Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
      tx: hash,
      status: r.status,
      gasUsed: r.gasUsed.toString(),
    });
    if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  }
}
