/**
 * Keeper process. Env: RPC_URL, DEPLOYMENT, KEEPER_PRIVATE_KEY, RELAY_URL (http://127.0.0.1:8787),
 * CLEAR_GAS (8000000, or "auto" = estimateGas × 1.2 for an opening clear), MIN_CLEAR_GAS (2000000) and MAX_CLEAR_GAS
 * (25000000: auto mode's continuations and retries), REPRICE_EVERY (5 blocks), AUTO_CLAIM (1), POLL_MS (250),
 * RPC_TIMEOUT_MS (10000). Markets on Chainlink Data Streams also need STREAMS_API_KEY and STREAMS_API_SECRET (and
 * STREAMS_API_URL for the testnet API); without them the keeper leaves those markets alone and says so.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, loadDeploymentFile, streamsApi, UnisonClient } from "@unison/sdk";
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
  // RPC_TIMEOUT_MS: a local fork fetches remote state on first touch and can take far longer than the 10 s default
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]), { timeout: Number(env("RPC_TIMEOUT_MS", "10000")) });
  const account = privateKeyToAccount(env("KEEPER_PRIVATE_KEY") as Hex);
  const publicClient = createPublicClient({ chain, transport, pollingInterval: Number(env("POLL_MS", "250")) });
  const walletClient = createWalletClient({ chain, transport, account });
  const client = new UnisonClient({ publicClient, walletClient, deployment });
  const key = process.env.STREAMS_API_KEY;
  const secret = process.env.STREAMS_API_SECRET;
  const url = process.env.STREAMS_API_URL;
  const keeper = new Keeper({
    client,
    ...(key && secret ? { streamsApi: streamsApi({ key, secret, ...(url ? { url } : {}) }) } : {}),
    relayUrl: env("RELAY_URL", "http://127.0.0.1:8787"),
    marketIds: Object.values(deployment.markets).map((m) => BigInt(m.id)),
    clearGas: parseClearGas(env("CLEAR_GAS", "8000000")),
    minClearGas: BigInt(env("MIN_CLEAR_GAS", "2000000")),
    maxClearGas: BigInt(env("MAX_CLEAR_GAS", "25000000")),
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
    // a tick that throws is logged and the next block tries again; an unhandled rejection would end the process
    onBlockNumber: (n) =>
      void keeper.tick(n).catch((e: unknown) => console.log(JSON.stringify({ t: new Date().toISOString(), level: "error", action: "tick", block: n.toString(), error: (e as Error).message.split("\n")[0] }))),
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
