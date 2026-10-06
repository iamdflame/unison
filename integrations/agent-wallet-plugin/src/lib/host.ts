import { CommandError, type CommandIO, type PluginCommandContext } from "@metamask/agent-wallet/plugin";
import { type Address, createPublicClient, getAddress, type Hex, http, type PublicClient } from "viem";
import { selectedEvmAddress, type WalletState } from "./host-state.ts";
import { monad } from "@unison/sdk/deployments.ts";
import { explainRevert, type Reader, UnisonError, type Writer } from "./chain.ts";
import { CHAIN_ID, RPC_URL, txUrl } from "./venue.ts";

/**
 * The bridge to MetaMask Agent Wallet. Writes go through `ctx.walletExecutor`, so every transaction is signed by the
 * agent's own wallet under its policy (Guard mode asks a person; Beast mode signs within limits), carrying a one-line
 * intent of what it does. The plugin never sees a key.
 */

/** Monad's public RPC, for commands that read the chain without a wallet. */
export const publicReader = (): Reader => ({ client: createPublicClient({ chain: monad, transport: http(RPC_URL) }) as PublicClient });

/** The authenticated Monad client the host provides, or the public RPC if the host has none for chain 143. */
function hostClient(ctx: PluginCommandContext): PublicClient {
  try {
    return ctx.publicClient(CHAIN_ID) as unknown as PublicClient;
  } catch {
    return publicReader().client;
  }
}

/** For read commands: `--address`, else the selected wallet's address, else none. */
export function addressFor(ctx: PluginCommandContext, flag: string | undefined): Address | undefined {
  if (flag) return getAddress(flag);
  try {
    return selectedEvmAddress(ctx.walletStateManager.read() as unknown as WalletState);
  } catch {
    return undefined;
  }
}

const HEADROOM = 1_200n; // 12% over the estimate: Monad charges the gas limit, so no more than the SDK's own margin

export async function agentWriter(ctx: PluginCommandContext, io: CommandIO, source: string): Promise<Writer> {
  const account = selectedEvmAddress(ctx.walletStateManager.read() as unknown as WalletState);
  if (!account) throw new UnisonError("UNISON_NO_WALLET", "no EVM wallet is selected in the agent wallet", "Run `mm wallet list`, then `mm wallet select`.");
  const client = hostClient(ctx);
  const exec = await ctx.walletExecutor(io, source);
  return {
    client,
    account,
    async send(call) {
      let gas: bigint;
      try {
        gas = await client.estimateGas({ account, to: call.to, data: call.data, value: call.value });
      } catch (e) {
        const r = explainRevert(e);
        throw new UnisonError(r.name === "Unknown" ? "UNISON_WOULD_REVERT" : `UNISON_${r.name.toUpperCase()}`, `${call.summary} would fail: ${r.text}`, r.hint || "Nothing was sent.");
      }
      io.progress(call.summary);
      const r = await exec(
        {
          kind: "transaction",
          chainId: CHAIN_ID,
          transaction: { to: call.to, data: call.data, value: call.value ?? 0n, gas: (gas * (10_000n + HEADROOM)) / 10_000n },
          intent: { summary: call.summary, action: "call", details: call.details },
        },
        { waitForReceipt: true },
      );
      io.progress(undefined);
      if (r.kind !== "transaction" || !r.hash) {
        throw new UnisonError("UNISON_TX_NOT_SENT", `${call.summary}: the wallet sent nothing (${r.status}${r.failureDescription ? `: ${r.failureDescription}` : ""})`, "If it is waiting for your approval, approve it in MetaMask, then run the command again.");
      }
      const receipt = await client.waitForTransactionReceipt({ hash: r.hash as Hex });
      if (receipt.status !== "success") throw new UnisonError("UNISON_TX_REVERTED", `${call.summary} reverted on chain: ${txUrl(r.hash)}`, "Nothing changed except the gas it spent.");
      io.emit(`  ✓ ${call.summary}  ${txUrl(r.hash)}`);
      return { hash: r.hash as Hex, receipt };
    },
  };
}

/** Runs a command body, turning the library's errors into the host's, with a hint a person can act on. */
export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    if (e instanceof UnisonError) throw new CommandError(e.code, e.message, e.hint || "See `mm unison --help`.");
    const msg = e instanceof Error ? e.message : String(e);
    throw new CommandError("UNISON_FAILED", msg.split("\n")[0] ?? msg, "Run again with --verbose for details.", e instanceof Error ? e : undefined);
  }
}
