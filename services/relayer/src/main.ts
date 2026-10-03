/**
 * Gasless relayer for the OrderGateway.
 *   POST /v1/orders      { order, sig }  → validated by eth_call, queued, returns { id }
 *   GET  /v1/orders/:id  → { status: queued | sent | placed | failed, tx?, slot?, error? }
 *   GET  /health
 * Every block the queue is flushed with one `placeBatch` (explicit gas: Monad charges the limit); per-order
 * results come back from the gateway's Relayed / RelayFailed events.
 *
 * Env: RPC_URL, DEPLOYMENT, RELAYER_PRIVATE_KEY, PORT (8788), MAX_BATCH (40), GAS_PER_ORDER (260000)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  chainById,
  loadDeploymentFile,
  orderFromJson,
  orderGatewayAbi,
  type GatewayOrder,
} from "@unison/sdk";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

interface Job {
  id: string;
  order: GatewayOrder;
  sig: Hex;
  status: "queued" | "sent" | "placed" | "failed";
  tx?: Hex;
  slot?: string;
  error?: string;
}

export async function startRelayer() {
  const deployment = await loadDeploymentFile(env("DEPLOYMENT", "../../deployments/31337.json"));
  if (!deployment.gateway) throw new Error("deployment has no gateway");
  const gateway = deployment.gateway;
  const chain = chainById(deployment.chainId);
  const transport = http(env("RPC_URL", chain.rpcUrls.default.http[0]));
  const account = privateKeyToAccount(env("RELAYER_PRIVATE_KEY") as Hex);
  const pub = createPublicClient({ chain, transport, pollingInterval: 250 });
  const wallet = createWalletClient({ chain, transport, account });
  const maxBatch = Number(env("MAX_BATCH", "40"));
  const gasPerOrder = BigInt(env("GAS_PER_ORDER", "260000"));
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let flushing = false;

  const toArgs = (o: GatewayOrder) => ({
    account: o.account,
    marketId: o.marketId,
    side: o.side,
    tick: o.tick,
    qty: o.qty,
    flags: o.flags,
    nonce: o.nonce,
    deadline: o.deadline,
  });

  async function flush() {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue.splice(0, maxBatch);
    try {
      const hash = await wallet.writeContract({
        address: gateway,
        abi: orderGatewayAbi,
        functionName: "placeBatch",
        args: [batch.map((j) => toArgs(j.order)), batch.map((j) => j.sig)],
        gas: 150_000n + gasPerOrder * BigInt(batch.length),
      });
      for (const j of batch) Object.assign(j, { status: "sent", tx: hash });
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      const failed = new Set<number>();
      const placed: string[] = [];
      for (const log of rcpt.logs) {
        if (log.address.toLowerCase() !== gateway.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: orderGatewayAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "RelayFailed") failed.add(Number((ev.args as { index: bigint }).index));
          if (ev.eventName === "Relayed") placed.push((ev.args as { ref: bigint }).ref.toString());
        } catch {
          /* other gateway events */
        }
      }
      let k = 0;
      batch.forEach((j, i) => {
        if (failed.has(i)) Object.assign(j, { status: "failed", error: "rejected on-chain" });
        else Object.assign(j, { status: "placed", slot: placed[k++] });
      });
    } catch (e) {
      for (const j of batch) Object.assign(j, { status: "failed", error: (e as Error).message.split("\n")[0] });
    } finally {
      flushing = false;
    }
  }

  const unwatch = pub.watchBlockNumber({ onBlockNumber: () => void flush() });

  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let s = "";
      req.on("data", (c) => {
        s += c;
        if (s.length > 64_000) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(s));
      req.on("error", reject);
    });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://relayer");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST",
        });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, relayer: account.address, queued: queue.length });
      }
      if (req.method === "POST" && url.pathname === "/v1/orders") {
        const { order, sig } = orderFromJson(JSON.parse(await readBody(req)));
        if (order.deadline * 1000n < BigInt(Date.now())) return send(res, 400, { error: "expired" });
        // reject bad signatures / caps / balances before spending gas on them
        try {
          await pub.simulateContract({
            address: gateway,
            abi: orderGatewayAbi,
            functionName: "place",
            args: [toArgs(order), sig],
            account,
          });
        } catch (e) {
          return send(res, 400, { error: (e as Error).message.split("\n")[0] });
        }
        const job: Job = { id: randomUUID(), order, sig, status: "queued" };
        jobs.set(job.id, job);
        queue.push(job);
        return send(res, 202, { id: job.id });
      }
      const m = url.pathname.match(/^\/v1\/orders\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && m) {
        const j = jobs.get(m[1]!);
        if (!j) return send(res, 404, { error: "unknown id" });
        return send(res, 200, { id: j.id, status: j.status, tx: j.tx, slot: j.slot, error: j.error });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });
  const port = Number(env("PORT", "8788"));
  await new Promise<void>((r) => server.listen(port, r));
  console.log(JSON.stringify({ msg: "relayer up", port, relayer: account.address, gateway }));
  return {
    server,
    stop: () => {
      unwatch();
      server.close();
    },
  };
}

if (process.argv[1]?.endsWith("main.ts")) {
  startRelayer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
