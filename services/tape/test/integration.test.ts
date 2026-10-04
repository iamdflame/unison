/**
 * Indexes a live devnet (anvil + DevNet.s.sol). Skipped when none is reachable.
 * TAPE_IT_RPC (http://127.0.0.1:8545), TAPE_IT_DEPLOYMENT (../../deployments/31337.json)
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, http, type Address } from "viem";
import { loadDeploymentFile } from "@unison/sdk/node";
import { createTapeApp } from "../src/api.ts";
import { SqliteTapeStore } from "../src/db.ts";
import { Indexer } from "../src/ingest.ts";
import { StreamHub } from "../src/stream.ts";

const rpc = process.env.TAPE_IT_RPC ?? "http://127.0.0.1:8545";
const deploymentPath = process.env.TAPE_IT_DEPLOYMENT ?? "../../deployments/31337.json";

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(1_000),
  });
  return ((await r.json()) as { result?: unknown }).result;
}

/** A devnet is "live" when it answers and the deployment's exchange has code there. */
async function liveDeployment() {
  try {
    const d = await loadDeploymentFile(deploymentPath);
    if ((await rpcCall("eth_chainId", [])) !== `0x${d.chainId.toString(16)}`) return undefined;
    const code = await rpcCall("eth_getCode", [d.exchange, "latest"]);
    return typeof code === "string" && code.length > 2 ? d : undefined;
  } catch {
    return undefined;
  }
}

const deployment = await liveDeployment();

async function until(f: () => boolean | Promise<boolean>, ms: number) {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!deployment)(`tape against a live devnet (${rpc})`, () => {
  it("backfills in ordered windows, verifies the receipt chain and serves it", async () => {
    const d = deployment!;
    const client = createPublicClient({ transport: http(rpc) });
    const store = new SqliteTapeStore(":memory:");
    const hub = new StreamHub();
    const indexer = new Indexer({ client, deployment: d, store, hub, windowBlocks: 25, pollMs: 200, log: () => {} });
    await indexer.start();
    try {
      const head = Number(await client.getBlockNumber());
      await until(() => indexer.indexed >= head, 30_000);
      const nvda = d.markets["aNVDA/AUSD"]!;
      expect(indexer.markets.get(nvda.id)).toMatchObject({ tickSize: 10_000n, baseDecimals: 18, quoteDecimals: 6 });
      const prints = store.prints(nvda.id, { asc: true });
      expect(prints.every((p) => p.chainOk)).toBe(true);
      expect(prints.every((p) => p.closeTs !== null)).toBe(true);
      // the deploy itself is on the tape: regime parameters and the traders' deposits
      expect(store.regimeEvents(nvda.id, "regime").length).toBeGreaterThan(0);
      expect(store.transfers(d.accounts!.trader1!.toLowerCase()).length).toBeGreaterThan(0);
      if (nvda.vault) await until(() => store.vaultSnapshots(nvda.vault!.toLowerCase() as Address).length > 0, 10_000);
      // heads keep flowing even without logs
      const seen = hub.size;
      await until(() => hub.size > seen, 10_000);

      const app = createTapeApp({ store, state: indexer, hub });
      const health = (await (await app.request("/health")).json()) as { indexed: number; head: number };
      expect(health.indexed).toBeGreaterThanOrEqual(head);
      const { markets } = (await (await app.request("/v1/markets")).json()) as { markets: { symbol: string }[] };
      expect(markets.map((m) => m.symbol).sort()).toEqual(Object.keys(d.markets).sort());
    } finally {
      indexer.stop();
      store.close();
    }
  }, 60_000);
});
