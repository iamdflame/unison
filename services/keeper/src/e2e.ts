/**
 * Golden path on the local devnet (anvil + contracts/script/DevNet.s.sol):
 *   relay (sim prices, forced OPEN) → keeper (clears every block, processes vaults, auto-claims)
 *   → two traders cross around the live reference → uniform-price print → fills settle → vault funded.
 * Exits non-zero on any failure. Usage: pnpm --filter @unison/keeper e2e
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildOrder,
  devnet,
  formatUnitsExact,
  orderGatewayAbi,
  orderToJson,
  signAsSession,
  loadDeploymentFile,
  Side,
  tickOfPrice,
  UnisonClient,
  type BatchClearedEvent,
} from "@unison/sdk";
import { Keeper } from "./keeper.ts";

const KEYS = {
  relay: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  keeper: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  trader1: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  trader2: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  trader3: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  relayer: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  agent: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
} as const;

const deploymentPath = process.env.DEPLOYMENT ?? "../../deployments/31337.json";
process.env.DEPLOYMENT = deploymentPath;
process.env.RELAY_PRIVATE_KEY = KEYS.relay;
process.env.SESSION_OVERRIDE = process.env.SESSION_OVERRIDE ?? "OPEN";
process.env.PROVIDER = "sim";
process.env.PORT = process.env.PORT ?? "8787";
process.env.RELAYER_PRIVATE_KEY = KEYS.relayer;

const fail = (msg: string): never => {
  console.error(`E2E FAILED: ${msg}`);
  process.exit(1);
};

async function waitFor<T>(what: string, ms: number, f: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await f();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return fail(`timeout waiting for ${what}`);
}

async function main() {
  const { startRelay } = await import("@unison/relay");
  const { server } = await startRelay();
  const deployment = await loadDeploymentFile(deploymentPath);
  const transport = http(devnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: devnet, transport, pollingInterval: 200 });
  const mk = (pk: Hex) =>
    new UnisonClient({
      publicClient,
      walletClient: createWalletClient({ chain: devnet, transport, account: privateKeyToAccount(pk) }),
      deployment,
    });
  const keeperClient = mk(KEYS.keeper);
  const t1 = mk(KEYS.trader1);
  const t2 = mk(KEYS.trader2);
  const nvda = deployment.markets["aNVDA/AUSD"] ?? fail("aNVDA market missing");
  const marketId = BigInt(nvda.id);

  const keeper = new Keeper({
    client: keeperClient,
    relayUrl: `http://127.0.0.1:${process.env.PORT}`,
    marketIds: [marketId],
    clearGas: 8_000_000n,
    repriceEvery: 3n,
    maxPendingAge: 5n,
    autoClaim: true,
    log: (m) => console.log("  keeper", JSON.stringify(m)),
  });
  const unwatchPlaced = publicClient.watchContractEvent({
    address: deployment.exchange,
    abi: (await import("@unison/sdk")).unisonExchangeAbi,
    eventName: "OrderPlaced",
    onLogs: (logs) => keeper.trackLogs(logs as never),
  });
  const unwatchBlocks = publicClient.watchBlockNumber({ emitOnBegin: true, onBlockNumber: (n) => void keeper.tick(n) });
  const prints: BatchClearedEvent[] = [];
  const unwatchPrints = t1.watchBatches(marketId, (e) => prints.push(e));

  // 1. first job: references flow, the vault's queued LP deposit executes
  const vault = nvda.vault ?? fail("vault missing");
  const funded = await waitFor("vault funded", 60_000, async () => {
    const v = await t1.vault(vault);
    return v.totalSupply > 0n ? v : undefined;
  });
  console.log(`vault funded: ${formatUnitsExact(funded.quoteBalance, 6)} AUSD, ${funded.totalSupply} shares`);

  // 2. two traders cross around the live reference
  const prices = (await (await fetch(`http://127.0.0.1:${process.env.PORT}/prices`)).json()) as Record<
    string,
    { price: string }
  >;
  const ref = BigInt(prices["aNVDA/AUSD"]!.price);
  const m = await t1.market(marketId);
  const refTick = tickOfPrice(ref, m.tickSize);
  console.log(`reference $${formatUnitsExact(ref, 6)} → tick ${refTick}`);
  const b0 = await t1.balanceOf(t1.walletClient!.account.address, nvda.base);
  const before = prints.length;
  await publicClient.waitForTransactionReceipt({
    hash: await t1.placeOrder({ marketId, side: Side.BID, tick: refTick + 30n, qty: 3n * 10n ** 18n }),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await t2.placeOrder({ marketId, side: Side.ASK, tick: refTick - 30n, qty: 2n * 10n ** 18n }),
  });

  // 3. the keeper clears; the print is uniform for everyone
  const print = await waitFor("a print with volume", 30_000, async () => prints.slice(before).find((p) => p.volume > 0n));
  console.log(
    `print: ${formatUnitsExact(print.volume, 18)} aNVDA @ $${formatUnitsExact(print.price, 6)} ` +
      `(ref $${formatUnitsExact(print.refPrice, 6)}, band [${print.bandLo}, ${print.bandHi}]) tx ${print.txHash}`,
  );
  if (print.tick < refTick - 30n || print.tick > refTick + 30n) fail("print outside both limits");

  // 4. auto-claim settles trader1's fill (the vault's curve sells into his bid at the same price)
  const got = await waitFor("trader1 receives aNVDA", 30_000, async () => {
    const b = await t1.balanceOf(t1.walletClient!.account.address, nvda.base);
    return b > b0 ? b - b0 : undefined;
  });
  console.log(`trader1 received ${formatUnitsExact(got, 18)} aNVDA`);

  // 5. gasless + agent: trader3 grants a capped session key; the AGENT signs, the RELAYER pays gas
  const { startRelayer } = await import("@unison/relayer");
  process.env.PORT = "8788";
  const relayer = await startRelayer();
  const gateway = deployment.gateway ?? fail("gateway missing");
  const t3 = mk(KEYS.trader3);
  const trader3 = t3.walletClient!.account.address;
  const agent = privateKeyToAccount(KEYS.agent);
  await publicClient.waitForTransactionReceipt({
    hash: await t3.walletClient!.writeContract({
      address: gateway,
      abi: orderGatewayAbi,
      functionName: "grantSession",
      args: [agent.address, BigInt(Math.floor(Date.now() / 1000) + 3600), 5n * 10n ** 18n, 2_000_000_000n, 1n << marketId],
      chain: devnet,
    }),
  });
  const ref2 = BigInt(
    ((await (await fetch(`http://127.0.0.1:8787/prices`)).json()) as Record<string, { price: string }>)["aNVDA/AUSD"]!
      .price,
  );
  const agentOrder = buildOrder({
    account: trader3,
    marketId,
    side: Side.ASK, // the vault's bid curve buys it
    tick: tickOfPrice(ref2, m.tickSize) - 40n,
    qty: 10n ** 18n,
  });
  const sig = await signAsSession(agent, devnet.id, gateway, agentOrder);
  const post = await fetch("http://127.0.0.1:8788/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(orderToJson(agentOrder, sig)),
  });
  const { id, error } = (await post.json()) as { id?: string; error?: string };
  if (!id) fail(`relayer rejected the agent order: ${error}`);
  const placed = await waitFor("relayer placed the agent order", 30_000, async () => {
    const j = (await (await fetch(`http://127.0.0.1:8788/v1/orders/${id}`)).json()) as { status: string; tx?: string };
    if (j.status === "failed") fail(`relay failed: ${JSON.stringify(j)}`);
    return j.status === "placed" ? j : undefined;
  });
  console.log(`agent order relayed gaslessly for trader3 (tx ${placed.tx})`);
  const q3 = await t3.balanceOf(trader3, nvda.quote);
  const got3 = await waitFor("trader3's agent order filled by the vault", 30_000, async () => {
    const b = await t3.balanceOf(trader3, nvda.quote);
    return b > q3 ? b - q3 : undefined;
  });
  console.log(`trader3 received ${formatUnitsExact(got3, 6)} AUSD (agent session key, relayer paid gas, vault bought)`);
  relayer.stop();

  unwatchBlocks();
  unwatchPlaced();
  unwatchPrints();
  server.close();
  console.log("E2E OK", JSON.stringify(keeper.stats));
  process.exit(0);
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
