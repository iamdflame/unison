/**
 * Gasless relayer for the OrderGateway (docs/API.md): users, agents and passkeys sign; the relayer pays gas.
 *   POST /v1/orders | /v1/cancels | /v1/withdrawals | /v1/sessions | /v1/claims | /v1/faucet  → 202 { id }
 *   POST /v1/passkeys → 200 { account, registered, tx }
 *   GET  /v1/jobs/:id (alias /v1/orders/:id), GET /health
 * Actions are simulated before they're accepted, persisted, and flushed once per block with gas estimated per
 * transaction × 1.2 (Monad charges the gas limit).
 *
 * Env: RPC_URL, DEPLOYMENT, RELAYER_PRIVATE_KEY, PORT (8788), MAX_BATCH (40), JOBS_DB (./data/relayer.db),
 *      CORS_ORIGINS (http://localhost:3000), FAUCET (0; 1 on devnets/testnets), FAUCET_QUOTE_AMOUNT (10000),
 *      FAUCET_BASE_AMOUNT (10), FAUCET_DAILY_BUDGET (1000), RATE_IP_BURST (60), RATE_IP_PER_SEC (10),
 *      RATE_ACCOUNT_BURST (10), RATE_ACCOUNT_PER_SEC (1), TRUST_PROXY (1 on Fly)
 */
import { serve, type ServerType } from "@hono/node-server";
import { createPublicClient, createWalletClient, http, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, type Deployment } from "@unison/sdk";
import { loadDeploymentFile } from "@unison/sdk/node";
import { createRelayerApp } from "./app.ts";
import { viemChain } from "./chain.ts";
import { Flusher, type FaucetToken } from "./flusher.ts";
import { JobStore } from "./jobs.ts";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

/** AUSD (or each market's quote) plus every market's base token. */
export function faucetTokens(d: Deployment, quoteWhole: bigint, baseWhole: bigint): FaucetToken[] {
  const markets = Object.values(d.markets);
  const ausd = d.tokens?.AUSD?.address ?? (typeof d.AUSD === "string" ? (d.AUSD as Address) : undefined);
  const quotes = ausd ? [ausd] : markets.map((m) => m.quote);
  const out = new Map<string, FaucetToken>();
  for (const q of quotes) out.set(q.toLowerCase(), { token: q, whole: quoteWhole });
  for (const m of markets) if (!out.has(m.base.toLowerCase())) out.set(m.base.toLowerCase(), { token: m.base, whole: baseWhole });
  return [...out.values()];
}

export async function startRelayer() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/31337.json"));
  if (!deployment.gateway) throw new Error("deployment has no gateway");
  const chain = chainById(deployment.chainId);
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]));
  const account = privateKeyToAccount(env("RELAYER_PRIVATE_KEY") as Hex, { nonceManager });
  const publicClient = createPublicClient({ chain, transport, pollingInterval: 250 });
  const walletClient = createWalletClient({ chain, transport, account });
  const relayerChain = viemChain(publicClient, walletClient);
  const addresses = { gateway: deployment.gateway, exchange: deployment.exchange };
  const faucetEnabled = env("FAUCET", "0") === "1";
  const store = new JobStore(env("JOBS_DB", "./data/relayer.db"));
  const flusher = new Flusher({
    chain: relayerChain,
    store,
    addresses,
    maxBatch: Number(env("MAX_BATCH", "40")),
    faucetTokens: faucetEnabled
      ? faucetTokens(deployment, BigInt(env("FAUCET_QUOTE_AMOUNT", "10000")), BigInt(env("FAUCET_BASE_AMOUNT", "10")))
      : [],
  });
  await flusher.recover();
  const unwatch = relayerChain.watchBlocks(() => flusher.onBlock());
  const app = createRelayerApp({
    chain: relayerChain,
    store,
    flusher,
    addresses,
    corsOrigins: env("CORS_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    faucet: { enabled: faucetEnabled, perAccount: 1, perIp: 3, dailyBudget: Number(env("FAUCET_DAILY_BUDGET", "1000")) },
    ipBurst: Number(env("RATE_IP_BURST", "60")),
    ipPerSec: Number(env("RATE_IP_PER_SEC", "10")),
    accountBurst: Number(env("RATE_ACCOUNT_BURST", "10")),
    accountPerSec: Number(env("RATE_ACCOUNT_PER_SEC", "1")),
    trustProxy: env("TRUST_PROXY", process.env.FLY_APP_NAME ? "1" : "0") === "1",
  });
  const port = Number(env("PORT", "8788"));
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve(s));
  });
  console.log(
    JSON.stringify({ msg: "relayer up", port, relayer: account.address, gateway: deployment.gateway, faucet: faucetEnabled }),
  );
  return {
    server,
    app,
    flusher,
    store,
    stop: async () => {
      unwatch();
      server.close();
      await flusher.stop();
      store.close();
    },
  };
}

if (process.argv[1]?.endsWith("main.ts")) {
  startRelayer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
