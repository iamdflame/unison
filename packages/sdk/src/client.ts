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
import { unisonExchangeAbi } from "./abis/UnisonExchange.ts";
import { liquidityVaultAbi } from "./abis/LiquidityVault.ts";
import type {
  Deployment,
  MarketState,
  OrderPreview,
  OrderRecord,
  RegimeState,
  SideCode,
  StatusCode,
} from "./types.ts";

/** Gas headroom on top of estimates — Monad charges the gas LIMIT, so keep it tight but safe. */
const GAS_HEADROOM_BPS = 1_200n;

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

  async vault(address: Address) {
    const c = { address, abi: liquidityVaultAbi } as const;
    const [balances, spreadPnl, inventoryPnl, totalSupply, head, queueLength, params] = await Promise.all([
      this.publicClient.readContract({ ...c, functionName: "balances" }),
      this.publicClient.readContract({ ...c, functionName: "spreadPnl" }),
      this.publicClient.readContract({ ...c, functionName: "inventoryPnl" }),
      this.publicClient.readContract({ ...c, functionName: "totalSupply" }),
      this.publicClient.readContract({ ...c, functionName: "head" }),
      this.publicClient.readContract({ ...c, functionName: "queueLength" }),
      this.publicClient.readContract({ ...c, functionName: "params" }),
    ]);
    return {
      baseBalance: balances[0],
      quoteBalance: balances[1],
      spreadPnl,
      inventoryPnl,
      totalSupply,
      pendingRequests: queueLength - head,
      params,
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

  async approveAndDeposit(token: Address, amount: bigint): Promise<Hex> {
    const w = this.wallet();
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [w.account.address, this.exchange],
    });
    if (allowance < amount) {
      const h = await this.write(token, erc20Abi, "approve", [this.exchange, amount]);
      await this.publicClient.waitForTransactionReceipt({ hash: h });
    }
    return this.write(this.exchange, unisonExchangeAbi, "deposit", [token, amount]);
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

  processVault(vault: Address): Promise<Hex> {
    return this.write(vault, liquidityVaultAbi, "process", []);
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
