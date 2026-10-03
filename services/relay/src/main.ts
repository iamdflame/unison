/**
 * Reference relay HTTP service.
 *   GET  /health
 *   GET  /prices                       current reference per market (unsigned)
 *   GET  /reference/:marketId?batch=N  signed, batch-bound report + ready-to-use clear() payload
 *   POST /halt/:marketId?on=1|0        manual halt (Authorization: Bearer $RELAY_ADMIN_TOKEN)
 *
 * Env: RPC_URL, DEPLOYMENT (path to deployments/<chainId>.json), RELAY_PRIVATE_KEY, RELAY_SIGNER_ID (0),
 *      PORT (8787), PROVIDER (sim|alpaca|yahoo), SESSION (us-equity|always), ALPACA_KEY_ID, ALPACA_SECRET_KEY,
 *      RELAY_ADMIN_TOKEN, SESSION_OVERRIDE (OPEN|EXTENDED|CLOSED — dev only)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, loadDeploymentFile, Status, type StatusCode } from "@unison/sdk";
import { AlpacaProvider, SimProvider, YahooProvider, type PriceProvider } from "./providers.ts";
import { Relay, RelayError, reportJson, type RelayMarket } from "./relay.ts";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

function provider(kind: string, symbol: string, seed: number, idx: number): PriceProvider {
  const ticker = symbol.split("/")[0]!.replace(/^a/, ""); // aNVDA/AUSD → NVDA
  if (kind === "alpaca") return new AlpacaProvider(ticker, env("ALPACA_KEY_ID"), env("ALPACA_SECRET_KEY"));
  if (kind === "yahoo") return new YahooProvider(ticker);
  return new SimProvider(seed / 1e6, 0.3, 7 + idx);
}

export async function startRelay() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/31337.json"));
  const chain = chainById(deployment.chainId);
  const client = createPublicClient({ chain, transport: http(env("RPC_URL", chain.rpcUrls.default.http[0])) });
  const signer = privateKeyToAccount(env("RELAY_PRIVATE_KEY") as Hex);
  const kind = env("PROVIDER", "sim");
  const session = env("SESSION", "us-equity") as RelayMarket["session"];
  const markets: RelayMarket[] = Object.values(deployment.markets)
    .filter((m) => m.reference === "operator")
    .map((m, i) => ({
      marketId: BigInt(m.id),
      symbol: m.symbol,
      provider: provider(kind, m.symbol, m.seedPrice ?? 100e6, i),
      session,
      maxStaleMs: 60_000,
    }));
  const override = process.env.SESSION_OVERRIDE as keyof typeof Status | undefined;
  const relay = new Relay({
    chainId: deployment.chainId,
    venue: deployment.exchange,
    adapter: deployment.operatorReference!,
    signer,
    signerId: Number(env("RELAY_SIGNER_ID", "0")),
    markets,
    maxBatchLag: 64n,
    headBlock: () => client.getBlockNumber({ cacheTime: 0 }),
    ...(override ? { sessionOverride: Status[override] as StatusCode } : {}),
  });

  const adminToken = process.env.RELAY_ADMIN_TOKEN;
  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://relay");
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, signer: signer.address });
      if (req.method === "GET" && url.pathname === "/prices") return send(res, 200, await relay.snapshot());
      if (req.method === "GET" && parts[0] === "reference" && parts[1]) {
        const batch = url.searchParams.get("batch");
        if (!batch || !/^\d+$/.test(batch)) throw new RelayError(400, "batch query parameter required");
        const { report, payload } = await relay.sign(BigInt(parts[1]), BigInt(batch));
        return send(res, 200, { report: reportJson(report), payload });
      }
      if (req.method === "POST" && parts[0] === "halt" && parts[1]) {
        if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) throw new RelayError(401, "unauthorized");
        relay.setHalt(BigInt(parts[1]), url.searchParams.get("on") === "1");
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      const code = e instanceof RelayError ? e.status : 500;
      send(res, code, { error: (e as Error).message });
    }
  });
  const port = Number(env("PORT", "8787"));
  await new Promise<void>((r) => server.listen(port, r));
  console.log(JSON.stringify({ msg: "relay up", port, signer: signer.address, markets: markets.length, provider: kind }));
  return { server, relay };
}

if (process.argv[1]?.endsWith("main.ts")) {
  startRelay().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
