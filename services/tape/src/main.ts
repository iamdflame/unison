/**
 * Tape process: indexes the chain into SQLite and serves REST + SSE (docs/API.md).
 *
 * Env: RPC_URL, RPC_WS_URL (optional), DEPLOYMENT (path to deployments/<chainId>.json),
 *      DB_PATH (./data/tape.db), PORT (8790), RELAY_URL (optional: live reference prices),
 *      CORS_ORIGINS (http://localhost:3000), RATE_BURST (120), RATE_PER_SEC (30), TRUST_PROXY (1 on Fly)
 */
import { serve, type ServerType } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import { chainById } from "@unison/sdk";
import { loadDeploymentFile } from "@unison/sdk/node";
import { createTapeApp } from "./api.ts";
import { SqliteTapeStore } from "./db.ts";
import { Indexer } from "./ingest.ts";
import { StreamHub } from "./stream.ts";
import { teamAccounts } from "./team.ts";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

export const corsOrigins = (raw: string | undefined) =>
  (raw ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function startTape() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/31337.json"));
  const chain = chainById(deployment.chainId);
  const client = createPublicClient({ chain, transport: http(env("RPC_URL", chain.rpcUrls.default.http[0])) });
  const store = new SqliteTapeStore(env("DB_PATH", "./data/tape.db"));
  const hub = new StreamHub();
  const indexer = new Indexer({
    client,
    deployment,
    store,
    hub,
    ...(process.env.RPC_WS_URL ? { wsUrl: process.env.RPC_WS_URL } : {}),
    ...(process.env.RELAY_URL ? { relayUrl: process.env.RELAY_URL.replace(/\/+$/, "") } : {}),
  });
  const app = createTapeApp({
    store,
    state: indexer,
    hub,
    corsOrigins: corsOrigins(process.env.CORS_ORIGINS),
    rateBurst: Number(env("RATE_BURST", "120")),
    ratePerSec: Number(env("RATE_PER_SEC", "30")),
    trustProxy: env("TRUST_PROXY", process.env.FLY_APP_NAME ? "1" : "0") === "1",
    // the deployment's own accounts, its house adversary, and TEAM_ACCOUNTS (comma-separated): the team's trading accounts
    team: teamAccounts(deployment, process.env.TEAM_ACCOUNTS),
  });
  const port = Number(env("PORT", "8790"));
  // serve first: /health answers while the indexer is still reading market metadata or backfilling
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve(s));
  });
  void indexer.start().catch((e) => console.error(JSON.stringify({ svc: "tape", level: "error", error: (e as Error).message })));
  console.log(
    JSON.stringify({ msg: "tape up", port, chainId: deployment.chainId, startBlock: indexer.startBlock, ws: Boolean(process.env.RPC_WS_URL) }),
  );
  return {
    server,
    app,
    indexer,
    store,
    stop: () => {
      indexer.stop();
      server.close();
      store.close();
    },
  };
}

if (process.argv[1]?.endsWith("main.ts")) {
  startTape().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
