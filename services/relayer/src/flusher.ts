/**
 * Per-block flushing. Each queue flushes at most once per block:
 *   orders     one `placeBatch`; per-order outcomes come back as Relayed / RelayFailed events
 *   cancels, withdrawals, sessions, claims
 *              one transaction each (the gateway has no batch entry point for them), sent back to back
 *   faucet     mint to the relayer → approve (once) → depositFor, per token
 * Gas is estimated per transaction × 1.2 (Monad charges the limit). `placeBatch` catches per-order failures, so
 * a node's binary-search estimate can land where an order runs out of gas and is caught; the batch limit is
 * therefore never below the sum of the orders' own estimates taken at submission.
 */
import { decodeEventLog, maxUint256, stringToHex, type Abi, type Address, type Hex } from "viem";
import { orderGatewayAbi, unisonExchangeAbi } from "@unison/sdk";
import { decodeUnisonError, type UnisonErrorInfo } from "@unison/sdk/errors";
import type { RelayerJobKind, RelayerJobStatus } from "@unison/sdk/relayer";
import {
  callOf,
  erc20,
  mockErc20Abi,
  nonceKey,
  parseAction,
  placeBatchCall,
  type Action,
  type Addresses,
  type ContractCall,
} from "./actions.ts";
import { isTransportError, withHeadroom, type RelayerChain } from "./chain.ts";
import type { JobRow, JobStore } from "./jobs.ts";

export interface FaucetToken {
  token: Address;
  /** whole tokens per drip */
  whole: bigint;
}

export interface FlusherConfig {
  chain: RelayerChain;
  store: JobStore;
  addresses: Addresses;
  maxBatch?: number;
  faucetTokens?: FaucetToken[];
  log?: (m: Record<string, unknown>) => void;
}

const KINDS: readonly RelayerJobKind[] = ["order", "cancel", "withdraw", "session", "claim", "faucet"];
const PLACE = stringToHex("place", { size: 32 });
const MAX_ATTEMPTS = 3;

export const UNAVAILABLE: UnisonErrorInfo = { code: "UNAVAILABLE", message: "The chain RPC is unavailable. Try again." };

export class Flusher {
  readonly cfg: FlusherConfig;
  private readonly queues = new Map<RelayerJobKind, JobRow[]>(KINDS.map((k) => [k, []]));
  private readonly busy = new Set<RelayerJobKind>();
  private readonly running = new Set<Promise<void>>();
  private readonly nonces = new Set<string>();
  private readonly decimals = new Map<Address, number>();
  private readonly approved = new Set<Address>();
  private stopped = false;

  constructor(cfg: FlusherConfig) {
    this.cfg = cfg;
  }

  private log(m: Record<string, unknown>) {
    (this.cfg.log ?? ((x) => console.log(JSON.stringify(x))))({ t: new Date().toISOString(), svc: "relayer", ...m });
  }

  get queued(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  /** A signed action with this (account, nonce) is already queued or in flight. */
  hasNonce(key: string): boolean {
    return this.nonces.has(key);
  }

  enqueue(job: JobRow, action?: Action) {
    const key = nonceKey(action ?? parseAction(job.kind, JSON.parse(job.payload)));
    if (key) this.nonces.add(key);
    this.queues.get(job.kind)!.push(job);
  }

  /** Called once per block: starts a flush of every idle, non-empty queue. */
  onBlock(): void {
    if (this.stopped) return;
    for (const kind of KINDS) {
      if (this.busy.has(kind) || this.queues.get(kind)!.length === 0) continue;
      this.busy.add(kind);
      const p = this.flush(kind)
        .catch((e) => this.log({ level: "error", msg: `flush ${kind}`, error: (e as Error).message }))
        .finally(() => {
          this.busy.delete(kind);
          this.running.delete(p);
        });
      this.running.add(p);
    }
  }

  /** Stops flushing and waits for in-flight flushes (bounded). */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopped = true;
    await Promise.race([Promise.allSettled([...this.running]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Waits for the flushes started so far (tests). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private flush(kind: RelayerJobKind): Promise<void> {
    if (kind === "order") return this.flushOrders();
    if (kind === "faucet") return this.flushFaucet();
    return this.flushSingles(kind);
  }

  private finish(j: JobRow, status: Extract<RelayerJobStatus, "done" | "failed">, p: Partial<Pick<JobRow, "result" | "error">> = {}) {
    this.cfg.store.update(j.id, { status, ...p });
    const key = nonceKey(parseAction(j.kind, JSON.parse(j.payload)));
    if (key) this.nonces.delete(key);
    this.log({ msg: `job ${status}`, id: j.id, kind: j.kind, ...(p.error ? { error: p.error.code } : {}) });
  }

  /** Transport trouble: requeue (front) for the next block a few times; a revert: fail with its reason. */
  private retryOrFail(jobs: JobRow[], kind: RelayerJobKind, e: unknown) {
    const transport = isTransportError(e);
    const err = transport ? UNAVAILABLE : decodeUnisonError(e);
    const retry: JobRow[] = [];
    for (const j of jobs) {
      if (transport && j.attempts + 1 < MAX_ATTEMPTS) {
        j.attempts += 1;
        this.cfg.store.update(j.id, { attempts: j.attempts });
        retry.push(j);
      } else this.finish(j, "failed", { error: err });
    }
    this.queues.get(kind)!.unshift(...retry);
    this.log({ level: "warn", msg: `flush ${kind} failed`, jobs: jobs.length, retried: retry.length, error: (e as Error).message?.split("\n")[0] });
  }

  // ------------------------------------------------------------------------------------------ orders

  private async flushOrders() {
    const { chain, addresses } = this.cfg;
    const batch = this.queues.get("order")!.splice(0, this.cfg.maxBatch ?? 40);
    const actions = batch.map((j) => parseAction("order", JSON.parse(j.payload)) as Extract<Action, { kind: "order" }>);
    const call = placeBatchCall(actions, addresses);
    let hash: Hex;
    try {
      const estimate = await chain.estimateGas(call);
      // floor: every order's own estimate (minus its intrinsic 21k), forwarded under the 63/64 rule
      const own = batch.reduce((s, j) => s + (j.gas ? BigInt(j.gas) - 21_000n : 0n), 0n);
      const floor = 21_000n + (own * 64n) / 63n + 5_000n * BigInt(batch.length);
      hash = await chain.send(call, withHeadroom(estimate > floor ? estimate : floor));
    } catch (e) {
      return this.retryOrFail(batch, "order", e);
    }
    batch.forEach((j, i) => this.cfg.store.update(j.id, { status: "sent", tx: hash, batchIndex: i }));
    this.log({ msg: "placeBatch sent", tx: hash, orders: batch.length });
    await this.settleOrders(batch, hash);
  }

  /** Resolves a sent batch from its receipt: the k-th `Relayed(place)` belongs to the k-th order that didn't fail. */
  private async settleOrders(batch: JobRow[], hash: Hex) {
    let r;
    try {
      r = await this.cfg.chain.waitForReceipt(hash);
    } catch (e) {
      for (const j of batch) this.finish(j, "failed", { error: { code: "UNKNOWN", message: `Not confirmed: ${(e as Error).message.split("\n")[0]}` } });
      return;
    }
    if (r.status !== "success") {
      for (const j of batch) this.finish(j, "failed", { error: decodeUnisonError(undefined) });
      return;
    }
    const failed = new Map<number, Hex>();
    const slots: bigint[] = [];
    for (const log of r.logs) {
      if (log.address.toLowerCase() !== this.cfg.addresses.gateway.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: orderGatewayAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "RelayFailed") failed.set(Number(ev.args.index), ev.args.reason);
        if (ev.eventName === "Relayed" && ev.args.action === PLACE) slots.push(ev.args.ref);
      } catch {
        /* other gateway events */
      }
    }
    let k = 0;
    batch.forEach((j, i) => {
      if (failed.has(i)) this.finish(j, "failed", { error: decodeUnisonError(failed.get(i)) });
      else this.finish(j, "done", { result: { slot: Number(slots[k++]) } });
    });
  }

  // ------------------------------------------------------------------------------------------ single actions

  private async flushSingles(kind: RelayerJobKind) {
    const jobs = this.queues.get(kind)!.splice(0, this.cfg.maxBatch ?? 40);
    const sent: Promise<void>[] = [];
    for (const j of jobs) {
      try {
        const call = callOf(parseAction(kind, JSON.parse(j.payload)), this.cfg.addresses);
        const hash = await this.cfg.chain.send(call, withHeadroom(await this.cfg.chain.estimateGas(call)));
        this.cfg.store.update(j.id, { status: "sent", tx: hash });
        sent.push(this.settleSingle(j, hash));
      } catch (e) {
        this.retryOrFail([j], kind, e);
      }
    }
    await Promise.all(sent);
  }

  private async settleSingle(j: JobRow, hash: Hex) {
    try {
      const r = await this.cfg.chain.waitForReceipt(hash);
      if (r.status === "success") this.finish(j, "done", { result: {} });
      else this.finish(j, "failed", { error: decodeUnisonError(undefined) });
    } catch (e) {
      this.finish(j, "failed", { error: { code: "UNKNOWN", message: `Not confirmed: ${(e as Error).message.split("\n")[0]}` } });
    }
  }

  // ------------------------------------------------------------------------------------------ faucet

  private async flushFaucet() {
    for (const j of this.queues.get("faucet")!.splice(0, 4)) {
      try {
        const { account } = parseAction("faucet", JSON.parse(j.payload)) as Extract<Action, { kind: "faucet" }>;
        await this.drip(j, account);
        this.finish(j, "done", { result: {} });
      } catch (e) {
        this.finish(j, "failed", { error: isTransportError(e) ? UNAVAILABLE : decodeUnisonError(e) });
      }
    }
  }

  private async sendAndWait(calls: ContractCall[]): Promise<Hex[]> {
    const { chain } = this.cfg;
    const hashes: Hex[] = [];
    for (const c of calls) hashes.push(await chain.send(c, withHeadroom(await chain.estimateGas(c))));
    for (const h of hashes) {
      const r = await chain.waitForReceipt(h);
      if (r.status !== "success") throw new Error(`faucet transaction reverted: ${h}`);
    }
    return hashes;
  }

  /** Mints mock tokens to the relayer and deposits them for `account` with `depositFor`. */
  private async drip(j: JobRow, account: Address) {
    const { chain, addresses } = this.cfg;
    this.cfg.store.update(j.id, { status: "sent" });
    const tokens: { token: Address; amount: bigint }[] = [];
    for (const t of this.cfg.faucetTokens ?? []) {
      let d = this.decimals.get(t.token);
      if (d === undefined) {
        d = Number(await chain.read(erc20(t.token, "decimals", [])));
        this.decimals.set(t.token, d);
      }
      tokens.push({ token: t.token, amount: t.whole * 10n ** BigInt(d) });
    }
    await this.sendAndWait(
      tokens.map((t) => ({ address: t.token, abi: mockErc20Abi, functionName: "mint", args: [chain.relayer, t.amount] })),
    );
    const approvals: ContractCall[] = [];
    for (const t of tokens) {
      if (this.approved.has(t.token)) continue;
      const allowance = (await chain.read(erc20(t.token, "allowance", [chain.relayer, addresses.exchange]))) as bigint;
      if (allowance < t.amount) approvals.push(erc20(t.token, "approve", [addresses.exchange, maxUint256]));
      this.approved.add(t.token);
    }
    await this.sendAndWait(approvals);
    const deposits = tokens.map((t) => ({
      address: addresses.exchange,
      abi: unisonExchangeAbi as Abi,
      functionName: "depositFor",
      args: [account, t.token, t.amount],
    }));
    const hashes = await this.sendAndWait(deposits);
    if (hashes.length) this.cfg.store.update(j.id, { tx: hashes[hashes.length - 1]! });
  }

  // ------------------------------------------------------------------------------------------ restart

  /** After a restart: queued jobs go back on their queues; sent jobs are resolved from their receipts. */
  async recover(): Promise<void> {
    const { store } = this.cfg;
    for (const j of store.withStatus("queued")) this.enqueue(j);
    const byTx = new Map<string, JobRow[]>();
    for (const j of store.withStatus("sent")) {
      if (!j.tx) {
        this.finish(j, "failed", { error: { code: "UNKNOWN", message: "Interrupted by a relayer restart. Sign again." } });
        continue;
      }
      byTx.set(j.tx, [...(byTx.get(j.tx) ?? []), j]);
    }
    for (const [tx, jobs] of byTx) {
      for (const j of jobs) {
        const key = nonceKey(parseAction(j.kind, JSON.parse(j.payload)));
        if (key) this.nonces.add(key);
      }
      if (jobs[0]!.kind === "order") {
        await this.settleOrders(jobs.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0)), tx as Hex);
      } else await Promise.all(jobs.map((j) => this.settleSingle(j, tx as Hex)));
    }
    if (this.queued || byTx.size) this.log({ msg: "recovered", queued: this.queued, sent: byTx.size });
  }
}
