/**
 * Keeper process. Env: RPC_URL, DEPLOYMENT, KEEPER_PRIVATE_KEY, RELAY_URL (http://127.0.0.1:8787),
 * CLEAR_GAS (8000000, or "auto" = estimateGas × 1.2), REPRICE_EVERY (5 blocks), AUTO_CLAIM (1), POLL_MS (250)
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, loadDeploymentFile, UnisonClient } from "@unison/sdk";
import { Keeper } from "./keeper.ts";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

export const parseClearGas = (v: string): bigint | "auto" => (v.trim().toLowerCase() === "auto" ? "auto" : BigInt(v));

export async function startKeeper() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/31337.json"));
  const chain = chainById(deployment.chainId);
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]));
  const account = privateKeyToAccount(env("KEEPER_PRIVATE_KEY") as Hex);
  const publicClient = createPublicClient({ chain, transport, pollingInterval: Number(env("POLL_MS", "250")) });
  const walletClient = createWalletClient({ chain, transport, account });
  const client = new UnisonClient({ publicClient, walletClient, deployment });
  const keeper = new Keeper({
    client,
    relayUrl: env("RELAY_URL", "http://127.0.0.1:8787"),
    marketIds: Object.values(deployment.markets).map((m) => BigInt(m.id)),
    clearGas: parseClearGas(env("CLEAR_GAS", "8000000")),
    repriceEvery: BigInt(env("REPRICE_EVERY", "5")),
    maxPendingAge: BigInt(env("MAX_PENDING_AGE", "10")),
    autoClaim: env("AUTO_CLAIM", "1") === "1",
  });
  const unwatchLogs = publicClient.watchContractEvent({
    address: deployment.exchange,
    abi: (await import("@unison/sdk")).unisonExchangeAbi,
    eventName: "OrderPlaced",
    onLogs: (logs) => keeper.trackLogs(logs as never),
  });
  const unwatchBlocks = publicClient.watchBlockNumber({
    emitOnBegin: true,
    onBlockNumber: (n) => void keeper.tick(n),
  });
  console.log(JSON.stringify({ msg: "keeper up", keeper: account.address, markets: deployment.markets }));
  return {
    keeper,
    stop: () => {
      unwatchBlocks();
      unwatchLogs();
    },
  };
}

if (process.argv[1]?.endsWith("main.ts")) {
  startKeeper().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
