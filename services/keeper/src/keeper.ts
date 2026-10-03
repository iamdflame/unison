/**
 * The keeper: drives every market's clear job, processes vault queues and auto-claims filled orders.
 *
 * Per new block, per market:
 *   1. a job is running            → continue it (no payload needed; the reference was bound at open)
 *   2. pending batches exist, or   → fetch the relay's signed report for batch = head - 1 and open a job
 *      `repriceEvery` blocks passed   (re-pricing lets resting orders cross the moving band and the vault curve)
 *   3. after a completed job       → process the market's vault queue if requests wait
 *   4. optionally                  → claim orders whose level closed (frees slots, credits balances)
 * Monad charges the gas LIMIT: clear calls use a fixed, explicit limit; the job pauses itself well before it.
 */
import { decodeEventLog, type Address, type Hex } from "viem";
import { JobPhase, Status, unisonExchangeAbi, type UnisonClient } from "@unison/sdk";

export interface KeeperConfig {
  client: UnisonClient;
  relayUrl: string;
  marketIds: bigint[];
  clearGas: bigint;
  repriceEvery: bigint;
  /** pending batches older than this many blocks are merged even if the auction would not trade */
  maxPendingAge: bigint;
  autoClaim: boolean;
  log?: (msg: Record<string, unknown>) => void;
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
  readonly stats = { clears: 0, jobsDone: 0, vaultProcesses: 0, claims: 0, errors: 0 };

  constructor(cfg: KeeperConfig) {
    this.cfg = cfg;
  }

  private log(msg: Record<string, unknown>) {
    (this.cfg.log ?? ((m) => console.log(JSON.stringify(m))))({ t: new Date().toISOString(), ...msg });
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
      if (this.cfg.autoClaim) sent += await this.autoClaim();
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
      if (phase !== JobPhase.IDLE) {
        await this.send(c.clear(marketId, "0x", this.cfg.clearGas), { marketId, action: "clear.continue" });
        sent++;
      } else {
        const m = await c.market(marketId);
        const upTo = head - 1n;
        if (upTo <= m.lastCleared) return 0;
        const pending = m.pendingTail > m.pendingHead;
        const age = upTo - m.lastCleared;
        const vaultWaiting = await this.vaultWaiting(marketId);
        if (!pending && !vaultWaiting && age < this.cfg.repriceEvery) return 0;
        const { payload, status } = await this.fetchPayload(marketId, upTo);
        if (status === Status.CLOSED) {
          const g = await c.regime(marketId);
          if (g.discCadence > 1 && g.lastDiscoveryBatch !== 0n && upTo < g.lastDiscoveryBatch + BigInt(g.discCadence)) {
            return 0; // DISCOVERY call auctions run every `discCadence` blocks
          }
        }
        // Monad charges the gas limit: only pay for a clear that trades, merges stale pending orders,
        // or gives a waiting vault queue its post-request reference.
        const sim = await c.simulateClearUpTo(marketId, upTo, payload);
        const mustMerge = pending && age >= this.cfg.maxPendingAge;
        if (sim.volume === 0n && !mustMerge && !vaultWaiting) return 0;
        await this.send(c.clearUpTo(marketId, upTo, payload, this.cfg.clearGas), {
          marketId,
          action: "clear.open",
          upTo,
        });
        sent++;
      }
      if ((await c.jobPhase(marketId)) === JobPhase.IDLE) {
        this.stats.jobsDone++;
        sent += await this.processVault(marketId);
      }
    } catch (e) {
      this.stats.errors++;
      this.log({ level: "warn", marketId: marketId.toString(), error: (e as Error).message.split("\n")[0] });
    }
    return sent;
  }

  private async vaultWaiting(marketId: bigint): Promise<boolean> {
    const dep = Object.values(this.cfg.client.deployment.markets).find((x) => BigInt(x.id) === marketId);
    if (!dep?.vault) return false;
    return (await this.cfg.client.vault(dep.vault)).pendingRequests > 0n;
  }

  private async processVault(marketId: bigint): Promise<number> {
    const c = this.cfg.client;
    const dep = Object.values(c.deployment.markets).find((x) => BigInt(x.id) === marketId);
    if (!dep?.vault) return 0;
    const v = await c.vault(dep.vault);
    if (v.pendingRequests === 0n) return 0;
    await this.send(c.processVault(dep.vault), { marketId, action: "vault.process", pending: v.pendingRequests });
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
      await this.send(c.claim(account, slots), { action: "claim", account, slots: slots.length });
      this.stats.claims += slots.length;
      sent++;
    }
    return sent;
  }

  private async send(p: Promise<Hex>, ctx: Record<string, unknown>) {
    const hash = await p;
    const r = await this.cfg.client.publicClient.waitForTransactionReceipt({ hash });
    if (ctx.action === "clear.open" || ctx.action === "clear.continue") this.stats.clears++;
    this.log({
      ...Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
      tx: hash,
      status: r.status,
      gasUsed: r.gasUsed.toString(),
    });
    if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  }
}
