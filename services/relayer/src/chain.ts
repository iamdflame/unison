/**
 * The relayer's view of the chain: simulate, estimate, send (one relayer account, viem's nonceManager) and wait.
 * Handlers and the flusher only see this interface, so tests run against an in-memory double.
 */
import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import type { ContractCall } from "./actions.ts";

export interface TxReceipt {
  status: "success" | "reverted";
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[];
}

export interface RelayerChain {
  readonly relayer: Address;
  readonly chainId: number;
  /** eth_call; throws the contract error on revert */
  simulate(call: ContractCall): Promise<unknown>;
  estimateGas(call: ContractCall): Promise<bigint>;
  send(call: ContractCall, gas: bigint): Promise<Hex>;
  waitForReceipt(hash: Hex, timeoutMs?: number): Promise<TxReceipt>;
  read<T = unknown>(call: ContractCall): Promise<T>;
  /** calls `fn` once per new block; returns an unsubscribe function */
  watchBlocks(fn: (block: bigint) => void): () => void;
}

/** Monad charges the gas LIMIT: estimates get exactly 20% headroom. */
export const withHeadroom = (gas: bigint): bigint => (gas * 12n + 9n) / 10n;

export function viemChain(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  pollingInterval = 250,
): RelayerChain {
  const account = walletClient.account;
  return {
    relayer: account.address,
    chainId: walletClient.chain.id,
    async simulate(call) {
      const { result } = await publicClient.simulateContract({ ...call, account } as never);
      return result;
    },
    estimateGas: (call) => publicClient.estimateContractGas({ ...call, account } as never),
    async send(call, gas) {
      try {
        return await walletClient.writeContract({ ...call, gas, account, chain: walletClient.chain } as never);
      } catch (e) {
        // the nonce was consumed locally but nothing reached the chain: resync from the node
        account.nonceManager?.reset({ address: account.address, chainId: walletClient.chain.id });
        throw e;
      }
    },
    async waitForReceipt(hash, timeoutMs = 60_000) {
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval });
      return { status: r.status, logs: r.logs };
    },
    read: (call) => publicClient.readContract(call as never) as never,
    watchBlocks: (fn) => publicClient.watchBlockNumber({ onBlockNumber: fn, pollingInterval }),
  };
}

const TRANSPORT_ERRORS = new Set([
  "HttpRequestError",
  "TimeoutError",
  "WebSocketRequestError",
  "SocketClosedError",
  "WaitForTransactionReceiptTimeoutError",
]);

/** True when an error is about reaching the node rather than about the transaction. */
export function isTransportError(e: unknown): boolean {
  for (let x = e as { name?: string; message?: string; code?: string; cause?: unknown } | undefined, i = 0; x && i < 10; i++) {
    if (x.name && TRANSPORT_ERRORS.has(x.name)) return true;
    if (x.code === "ECONNREFUSED" || x.code === "ECONNRESET" || x.code === "ETIMEDOUT") return true;
    if (typeof x.message === "string" && /fetch failed|ECONNREFUSED|socket hang up|network error/i.test(x.message)) return true;
    x = x.cause as typeof x;
  }
  return false;
}
