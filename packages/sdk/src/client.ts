import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  erc20Abi,
} from "viem";
import type { Curve } from "@unison/engine";
import { unisonExchangeAbi } from "./abis/UnisonExchange.ts";
import { liquidityVaultAbi } from "./abis/LiquidityVault.ts";
import { orderGatewayAbi } from "./abis/OrderGateway.ts";
import { streamsCausalReferenceAbi } from "./streams.ts";
import type {
  Deployment,
  MarketState,
  OrderPreview,
  OrderRecord,
  CausalState,
  RegimeState,
  SideCode,
  StatusCode,
} from "./types.ts";

/** Gas headroom on top of estimates — Monad charges the gas LIMIT, so keep it tight but safe. */
const GAS_HEADROOM_BPS = 1_200n;

/** Ticks per `depth` call in `depthRange` (the contract accepts at most hi - lo = 4,096). */
export const DEPTH_CHUNK_TICKS = 4_096n;

/** TSV volume-cap state of a market (`capsOf`). */
export interface CapsState {
  /** LULD tier 1 or 2 (0 = untiered) */
  tier: number;
  /** UTC day `traded` refers to */
  day: bigint;
  /** base units executed on `day` */
  traded: bigint;
  /** base units per UTC day (0 = no cap) */
  dailyCap: bigint;
  /** what the market may still trade today (2^256 - 1 = uncapped) */
  remainingToday: bigint;
}

/** Raw words of one book level (`levelOf`). */
export interface LevelState {
  remaining: bigint;
  epoch: bigint;
  scale: bigint;
  closed: boolean;
  survival: bigint;
  pot: bigint;
  acc: bigint;
}

/** A session-key grant (`OrderGateway.sessions`); expiry 0 = never granted or revoked. */
export interface SessionGrant {
  expiry: bigint;
  maxQty: bigint;
  maxNotional: bigint;
  marketMask: bigint;
}

/** A queued LiquidityVault request (`request(id)`); deleted (zeroed) once executed. */
export interface VaultRequest {
  owner: Address;
  redeem: boolean;
  /** unix seconds of the request */
  time: bigint;
  /** deposit: quote units; redeem: shares */
  amount: bigint;
}

export interface UnisonClientConfig {
  publicClient: PublicClient<Transport, Chain | undefined>;
  walletClient?: WalletClient<Transport, Chain | undefined, Account>;
  deployment: Deployment;
}

export interface PlaceOrderArgs {
  marketId: bigint;
  side: SideCode;
  tick: bigint;
  qty: bigint;
  ioc?: boolean;
}

export interface BatchClearedEvent {
  marketId: bigint;
  upToBlock: bigint;
  tick: bigint;
  price: bigint;
  volume: bigint;
  refPrice: bigint;
  refTimeMs: bigint;
  status: number;
  bandLo: bigint;
  bandHi: bigint;
  receiptHash: Hex;
  blockNumber: bigint;
  txHash: Hex;
}

/** Typed access to one Unison deployment: reads, writes (with explicit gas) and event streams. */
export class UnisonClient {
  readonly publicClient: UnisonClientConfig["publicClient"];
  readonly walletClient: UnisonClientConfig["walletClient"];
  readonly deployment: Deployment;
  readonly exchange: Address;

  constructor(cfg: UnisonClientConfig) {
    this.publicClient = cfg.publicClient;
    this.walletClient = cfg.walletClient;
    this.deployment = cfg.deployment;
    this.exchange = cfg.deployment.exchange;
  }

  // ------------------------------------------------------------------ reads

  private read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.publicClient.readContract({
      address: this.exchange,
      abi: unisonExchangeAbi,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;
  }

  marketCount(): Promise<bigint> {
    return this.read("marketCount");
  }

  market(marketId: bigint): Promise<MarketState> {
    return this.read("market", [marketId]);
  }

  regime(marketId: bigint): Promise<RegimeState> {
    return this.read("regimeOf", [marketId]);
  }

  /** Whether the market prices at the first oracle observation after its orders, and its clock margin. */
  causal(marketId: bigint): Promise<CausalState> {
    return this.read("causalOf", [marketId]);
  }

  /** Batches waiting to be cleared, oldest first: block number and registration time (unix seconds). */
  async pendingTimes(marketId: bigint, max = 64n): Promise<{ batch: bigint; time: bigint }[]> {
    const [batches, times] = await this.read<readonly [readonly bigint[], readonly bigint[]]>("pendingTimes", [
      marketId,
      max,
    ]);
    return batches.map((batch, i) => ({ batch, time: times[i]! }));
  }

  /** Whether the guardian has paused the exchange: order entry stops, and (v3) clears return every waiting order. */
  paused(): Promise<boolean> {
    return this.read("paused");
  }

  jobPhase(marketId: bigint): Promise<number> {
    return this.read("jobPhase", [marketId]);
  }

  balanceOf(account: Address, token: Address): Promise<bigint> {
    return this.read("balanceOf", [account, token]);
  }

  order(account: Address, slot: bigint): Promise<OrderRecord> {
    return this.read("orderOf", [account, slot]);
  }

  async openSlots(account: Address): Promise<bigint[]> {
    const bm: bigint = await this.read("openOrderBitmap", [account]);
    const out: bigint[] = [];
    for (let i = 0n; i < 55n; i++) if ((bm >> i) & 1n) out.push(i);
    return out;
  }

  async previewOrder(account: Address, slot: bigint): Promise<OrderPreview> {
    const [merged, filled, remainder, quote, closed] = await this.read<readonly [boolean, bigint, bigint, bigint, boolean]>(
      "previewOrder",
      [account, slot],
    );
    return { merged, filled, remainder, quote, closed };
  }

  /** Resting quantity per tick in [lo, hi] (aggregated over every book). */
  depth(marketId: bigint, side: SideCode, lo: bigint, hi: bigint): Promise<readonly bigint[]> {
    return this.read("depth", [marketId, BigInt(side), lo, hi]);
  }

  async previewBand(marketId: bigint, refPrice: bigint, status: StatusCode) {
    const [refTick, lo, hi, bandBps] = await this.read<readonly [bigint, bigint, bigint, bigint]>("previewBand", [
      marketId,
      refPrice,
      status,
    ]);
    return { refTick, lo, hi, bandBps };
  }

  sources(marketId: bigint): Promise<readonly Address[]> {
    return this.read("sourcesOf", [marketId]);
  }

  /** Listed tokens, by ledger index. */
  tokens(): Promise<readonly Address[]> {
    return this.read("tokens");
  }

  /** Price scale: price = tick · tickSize quote units per `baseUnit` base units. */
  async marketPricing(marketId: bigint): Promise<{ tickSize: bigint; baseUnit: bigint }> {
    const [tickSize, baseUnit] = await this.read<readonly [bigint, bigint]>("marketPricing", [marketId]);
    return { tickSize, baseUnit };
  }

  /** TSV cap state and what the market may still trade today. */
  async capsOf(marketId: bigint): Promise<CapsState> {
    const [caps, remainingToday] = await this.read<
      readonly [{ tier: number; day: bigint; traded: bigint; dailyCap: bigint }, bigint]
    >("capsOf", [marketId]);
    return { tier: caps.tier, day: caps.day, traded: caps.traded, dailyCap: caps.dailyCap, remainingToday };
  }

  /** Total resting quantity of one side across every book (main + IOC). */
  bookTotal(marketId: bigint, side: SideCode): Promise<bigint> {
    return this.read("bookTotal", [marketId, BigInt(side)]);
  }

  /** One level's raw words. `shard` is the book: 0..7 main books, 8..15 IOC books. */
  levelOf(marketId: bigint, side: SideCode, shard: number | bigint, tick: bigint): Promise<LevelState> {
    return this.read("levelOf", [marketId, BigInt(side), BigInt(shard), tick]);
  }

  /** `depth` over any range: requests of at most 4,096 ticks, in parallel, concatenated (index i = tick lo + i). */
  async depthRange(marketId: bigint, side: SideCode, lo: bigint, hi: bigint): Promise<bigint[]> {
    if (hi < lo) return [];
    const parts: Promise<readonly bigint[]>[] = [];
    for (let a = lo; a <= hi; a += DEPTH_CHUNK_TICKS) {
      const b = a + DEPTH_CHUNK_TICKS - 1n < hi ? a + DEPTH_CHUNK_TICKS - 1n : hi;
      parts.push(this.depth(marketId, side, a, b));
    }
    return (await Promise.all(parts)).flat();
  }

  /**
   * A vault's curve for an auction (`LiquidityVault.curve`), as the engine's `Curve` — clip it with `clipCurve` /
   * draw it with `slotLevels` from `@unison/engine` exactly as the exchange will use it.
   */
  async vaultCurve(
    vault: Address,
    marketId: bigint,
    refPrice: bigint,
    status: StatusCode | number,
    refTick: bigint,
    lo: bigint,
    hi: bigint,
  ): Promise<Curve> {
    const c = await this.publicClient.readContract({
      address: vault,
      abi: liquidityVaultAbi,
      functionName: "curve",
      args: [marketId, refPrice, status, refTick, lo, hi],
    });
    return {
      bidTop: BigInt(c.bidTop),
      bidTicks: BigInt(c.bidTicks),
      bidPerTick: c.bidPerTick,
      askBottom: BigInt(c.askBottom),
      askTicks: BigInt(c.askTicks),
      askPerTick: c.askPerTick,
    };
  }

  /** LP shares of `owner` in a vault. */
  vaultShares(vault: Address, owner: Address): Promise<bigint> {
    return this.publicClient.readContract({ address: vault, abi: liquidityVaultAbi, functionName: "balanceOf", args: [owner] });
  }

  /** A queued deposit / redeem request of a vault. */
  async vaultRequest(vault: Address, id: bigint): Promise<VaultRequest> {
    const r = await this.publicClient.readContract({
      address: vault,
      abi: liquidityVaultAbi,
      functionName: "request",
      args: [id],
    });
    return { owner: r.owner, redeem: r.redeem, time: r.time, amount: r.amount };
  }

  private gatewayAddress(): Address {
    if (!this.deployment.gateway) throw new Error("UnisonClient: the deployment has no gateway");
    return this.deployment.gateway;
  }

  /** The session key grant `account` gave `key` on the gateway. */
  async sessions(account: Address, key: Address): Promise<SessionGrant> {
    const [expiry, maxQty, maxNotional, marketMask] = await this.publicClient.readContract({
      address: this.gatewayAddress(),
      abi: orderGatewayAbi,
      functionName: "sessions",
      args: [account, key],
    });
    return { expiry, maxQty, maxNotional, marketMask };
  }

  /** The passkey registered for a passkey account (qx = 0x0…0: none). */
  async passkeys(account: Address): Promise<{ qx: Hex; qy: Hex }> {
    const [qx, qy] = await this.publicClient.readContract({
      address: this.gatewayAddress(),
      abi: orderGatewayAbi,
      functionName: "passkeys",
      args: [account],
    });
    return { qx, qy };
  }

  async vault(address: Address) {
    const c = { address, abi: liquidityVaultAbi } as const;
    const [balances, spreadPnl, inventoryPnl, totalSupply, head, queueLength, params, auctionsTraded, tradedBase] = await Promise.all([
      this.publicClient.readContract({ ...c, functionName: "balances" }),
      this.publicClient.readContract({ ...c, functionName: "spreadPnl" }),
      this.publicClient.readContract({ ...c, functionName: "inventoryPnl" }),
      this.publicClient.readContract({ ...c, functionName: "totalSupply" }),
      this.publicClient.readContract({ ...c, functionName: "head" }),
      this.publicClient.readContract({ ...c, functionName: "queueLength" }),
      this.publicClient.readContract({ ...c, functionName: "params" }),
      this.publicClient.readContract({ ...c, functionName: "auctionsTraded" }),
      this.publicClient.readContract({ ...c, functionName: "tradedBase" }),
    ]);
    return {
      baseBalance: balances[0],
      quoteBalance: balances[1],
      spreadPnl,
      inventoryPnl,
      totalSupply,
      pendingRequests: queueLength - head,
      params,
      /** auctions the vault traded in, and base it bought plus sold, all time */
      auctionsTraded,
      tradedBase,
    };
  }

  // ------------------------------------------------------------------ writes

  private wallet() {
    if (!this.walletClient) throw new Error("UnisonClient: a walletClient is required for writes");
    return this.walletClient;
  }

  private async write(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
    const w = this.wallet();
    const req = {
      address,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
      account: w.account,
      chain: w.chain,
    };
    const gas = await this.publicClient.estimateContractGas(req as never);
    return w.writeContract({ ...(req as object), gas: (gas * (10_000n + GAS_HEADROOM_BPS)) / 10_000n } as never) as Promise<Hex>;
  }

  /** Approves `spender` for `amount` of `token` (waiting for the receipt) unless the allowance already covers it. */
  private async ensureAllowance(token: Address, spender: Address, amount: bigint): Promise<void> {
    const w = this.wallet();
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [w.account.address, spender],
    });
    if (allowance < amount) {
      const h = await this.write(token, erc20Abi, "approve", [spender, amount]);
      await this.publicClient.waitForTransactionReceipt({ hash: h });
    }
  }

  async approveAndDeposit(token: Address, amount: bigint): Promise<Hex> {
    await this.ensureAllowance(token, this.exchange, amount);
    return this.write(this.exchange, unisonExchangeAbi, "deposit", [token, amount]);
  }

  /**
   * Credits `account`'s venue balance from the wallet (approves first). The only safe way to fund a passkey
   * account, which has no key to move tokens sent to its address.
   */
  async depositFor(account: Address, token: Address, amount: bigint): Promise<Hex> {
    await this.ensureAllowance(token, this.exchange, amount);
    return this.write(this.exchange, unisonExchangeAbi, "depositFor", [account, token, amount]);
  }

  /**
   * Queues an LP deposit of `assets` quote units into a vault (approves the vault's quote token first). It executes
   * at the first reference published after the request, when anyone (the keeper) calls `process()`.
   */
  async requestDeposit(vault: Address, assets: bigint): Promise<Hex> {
    const quote = await this.publicClient.readContract({ address: vault, abi: liquidityVaultAbi, functionName: "quote" });
    await this.ensureAllowance(quote, vault, assets);
    return this.write(vault, liquidityVaultAbi, "requestDeposit", [assets]);
  }

  /** Queues a redemption of `shares` (escrowed by the vault; paid in kind at the next reference). */
  requestRedeem(vault: Address, shares: bigint): Promise<Hex> {
    return this.write(vault, liquidityVaultAbi, "requestRedeem", [shares]);
  }

  withdraw(token: Address, amount: bigint, to?: Address): Promise<Hex> {
    return this.write(this.exchange, unisonExchangeAbi, "withdraw", [token, amount, to ?? this.wallet().account.address]);
  }

  placeOrder(a: PlaceOrderArgs): Promise<Hex> {
    return this.write(this.exchange, unisonExchangeAbi, "placeOrder", [
      a.marketId,
      BigInt(a.side),
      a.tick,
      a.qty,
      a.ioc ? 1n : 0n,
    ]);
  }

  cancelOrder(slot: bigint): Promise<Hex> {
    return this.write(this.exchange, unisonExchangeAbi, "cancelOrder", [slot]);
  }

  claim(account: Address, slots: readonly bigint[]): Promise<Hex> {
    return this.write(this.exchange, unisonExchangeAbi, "claim", [account, slots]);
  }

  /** Runs/continues the clear job. `payload` = encoded signed report for operator-signed markets. */
  clear(marketId: bigint, payload: Hex = "0x", gas?: bigint): Promise<Hex> {
    if (gas === undefined) return this.write(this.exchange, unisonExchangeAbi, "clear", [marketId, payload]);
    const w = this.wallet();
    return w.writeContract({
      address: this.exchange,
      abi: unisonExchangeAbi,
      functionName: "clear",
      args: [marketId, payload],
      account: w.account,
      chain: w.chain,
      gas,
    });
  }

  /**
   * Opens/continues a clear job covering exactly the batches <= `upTo` — use with an operator-signed report
   * issued for `upTo`, so the transaction stays valid whichever later block it lands in.
   */
  clearUpTo(marketId: bigint, upTo: bigint, payload: Hex = "0x", gas?: bigint): Promise<Hex> {
    const args = [marketId, upTo, payload] as const;
    if (gas === undefined) return this.write(this.exchange, unisonExchangeAbi, "clearUpTo", args);
    const w = this.wallet();
    return w.writeContract({
      address: this.exchange,
      abi: unisonExchangeAbi,
      functionName: "clearUpTo",
      args,
      account: w.account,
      chain: w.chain,
      gas,
    });
  }

  /** Simulates `clearUpTo` (eth_call): the auction's outcome without sending a transaction. */
  async simulateClearUpTo(marketId: bigint, upTo: bigint, payload: Hex = "0x"): Promise<{ tick: bigint; volume: bigint }> {
    const { result } = await this.publicClient.simulateContract({
      address: this.exchange,
      abi: unisonExchangeAbi,
      functionName: "clearUpTo",
      args: [marketId, upTo, payload],
      account: this.wallet().account,
    });
    const [tick, volume] = result as readonly [bigint, bigint];
    return { tick, volume };
  }

  /** Simulates `clear` (eth_call): the auction's outcome without sending a transaction. */
  async simulateClear(marketId: bigint, payload: Hex = "0x"): Promise<{ tick: bigint; volume: bigint }> {
    const { result } = await this.publicClient.simulateContract({
      address: this.exchange,
      abi: unisonExchangeAbi,
      functionName: "clear",
      args: [marketId, payload],
      account: this.wallet().account,
    });
    const [tick, volume] = result as readonly [bigint, bigint];
    return { tick, volume };
  }

  processVault(vault: Address): Promise<Hex> {
    return this.write(vault, liquidityVaultAbi, "process", []);
  }

  /** Brings a Data Streams report on chain: Chainlink's verifier checks it, the adapter stores it (permissionless). */
  submitStreamsReport(adapter: Address, fullReport: Hex): Promise<Hex> {
    return this.write(adapter, streamsCausalReferenceAbi, "submit", [fullReport]);
  }

  // ------------------------------------------------------------------ events

  /** Streams auction prints (the tape) for a market. Returns an unsubscribe function. */
  watchBatches(marketId: bigint, onBatch: (e: BatchClearedEvent) => void): () => void {
    return this.publicClient.watchContractEvent({
      address: this.exchange,
      abi: unisonExchangeAbi,
      eventName: "BatchCleared",
      args: { marketId },
      onLogs: (logs) => {
        for (const l of logs) {
          const a = l.args as Record<string, unknown>;
          onBatch({
            marketId: a.marketId as bigint,
            upToBlock: a.upToBlock as bigint,
            tick: a.tick as bigint,
            price: a.price as bigint,
            volume: a.volume as bigint,
            refPrice: a.refPrice as bigint,
            refTimeMs: a.refTimeMs as bigint,
            status: Number(a.status),
            bandLo: a.bandLo as bigint,
            bandHi: a.bandHi as bigint,
            receiptHash: a.receiptHash as Hex,
            blockNumber: l.blockNumber ?? 0n,
            txHash: l.transactionHash ?? "0x",
          });
        }
      },
    });
  }
}
