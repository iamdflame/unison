/**
 * Golden path on the local devnet (anvil + contracts/script/DevNet.s.sol):
 *   relay (sim prices, forced OPEN) → keeper (clears every block, processes vaults, auto-claims)
 *   → two traders cross around the live reference → uniform-price print → fills settle → vault funded
 *   → an agent trades through a capped session key and the gasless relayer
 *   → a passkey account (software P-256 key, WebAuthn assertions) registers, is funded with depositFor and
 *     trades through the relayer → the faucet drips a fresh account → the tape indexes it all.
 * Exits non-zero on any failure. Usage: pnpm --filter @unison/keeper e2e (RPC_URL overrides the anvil URL, CLEAR_GAS
 * the keeper's gas policy: a limit or "auto")
 */
import { p256 } from "@noble/curves/p256";
import { concat, createPublicClient, createWalletClient, http, sha256, toBytes, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildOrder,
  devnet,
  encodePasskeyAssertion,
  formatUnitsExact,
  gatewayDigest,
  orderGatewayAbi,
  orderToJson,
  signAsSession,
  loadDeploymentFile,
  Side,
  tickOfPrice,
  UnisonClient,
  unisonExchangeAbi,
  type BatchClearedEvent,
} from "@unison/sdk";
import { RelayerClient, RelayerError } from "@unison/sdk/relayer";
import { TapeClient, type HeadEvent } from "@unison/sdk/tape";
import { Keeper } from "./keeper.ts";
import { parseClearGas } from "./main.ts";

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
const rpcUrl = process.env.RPC_URL ?? devnet.rpcUrls.default.http[0];
process.env.DEPLOYMENT = deploymentPath;
process.env.RPC_URL = rpcUrl; // the in-process relay, relayer and tape read it too
process.env.RELAY_PRIVATE_KEY = KEYS.relay;
process.env.SESSION_OVERRIDE = process.env.SESSION_OVERRIDE ?? "OPEN";
process.env.PROVIDER = "sim";
process.env.PORT = process.env.PORT ?? "8787";
process.env.RELAYER_PRIVATE_KEY = KEYS.relayer;
process.env.FAUCET = "1";
process.env.JOBS_DB = process.env.JOBS_DB ?? ":memory:";
process.env.DB_PATH = process.env.DB_PATH ?? ":memory:";

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

/**
 * A WebAuthn "get" assertion over `digest`, exactly as a platform authenticator builds it (see
 * contracts/test/unit/OrderGateway.t.sol): challenge = base64url(digest), flags UP|UV, low-s signature over
 * sha256(authenticatorData ‖ sha256(clientDataJSON)).
 */
function passkeySign(key: Uint8Array, digest: Hex): Hex {
  const authenticatorData = concat([sha256(toBytes("unison.trade")), "0x05", "0x00000001"]); // rpIdHash ‖ flags ‖ counter
  const challenge = Buffer.from(toBytes(digest)).toString("base64url");
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://unison.trade","crossOrigin":false}`;
  const message = sha256(concat([authenticatorData, sha256(toBytes(clientDataJSON))]));
  const { r, s } = p256.sign(toBytes(message), key, { lowS: true });
  return encodePasskeyAssertion({ authenticatorData, clientDataJSON, r, s });
}

async function main() {
  const { startRelay } = await import("@unison/relay");
  const { server } = await startRelay();
  const deployment = await loadDeploymentFile(deploymentPath);
  const transport = http(rpcUrl);
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
  const relayPrice = async () =>
    BigInt(
      ((await (await fetch(`http://127.0.0.1:8787/prices`)).json()) as Record<string, { price: string }>)["aNVDA/AUSD"]!
        .price,
    );

  const keeper = new Keeper({
    client: keeperClient,
    relayUrl: `http://127.0.0.1:${process.env.PORT}`,
    marketIds: [marketId],
    clearGas: parseClearGas(process.env.CLEAR_GAS ?? "8000000"),
    repriceEvery: 3n,
    maxPendingAge: 5n,
    autoClaim: true,
    log: (m) => console.log("  keeper", JSON.stringify(m)),
  });
  const unwatchPlaced = publicClient.watchContractEvent({
    address: deployment.exchange,
    abi: unisonExchangeAbi,
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
  const ref = await relayPrice();
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
  const relayerApi = new RelayerClient("http://127.0.0.1:8788");
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
  const agentOrder = buildOrder({
    account: trader3,
    marketId,
    side: Side.ASK, // the vault's bid curve buys it
    tick: tickOfPrice(await relayPrice(), m.tickSize) - 40n,
    qty: 10n ** 18n,
  });
  const sig = await signAsSession(agent, devnet.id, gateway, agentOrder);
  const post = await fetch("http://127.0.0.1:8788/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(orderToJson(agentOrder, sig)),
  });
  const { id, error } = (await post.json()) as { id?: string; error?: { code: string; message: string } };
  if (!id) fail(`relayer rejected the agent order: ${JSON.stringify(error)}`);
  const placed = await waitFor("relayer placed the agent order", 30_000, async () => {
    const j = (await (await fetch(`http://127.0.0.1:8788/v1/orders/${id}`)).json()) as {
      status: string;
      tx?: string;
      result?: { slot?: number };
    };
    if (j.status === "failed") fail(`relay failed: ${JSON.stringify(j)}`);
    return j.status === "done" ? j : undefined;
  });
  console.log(`agent order relayed gaslessly for trader3 into slot ${placed.result?.slot} (tx ${placed.tx})`);
  const q3 = await t3.balanceOf(trader3, nvda.quote);
  const got3 = await waitFor("trader3's agent order filled by the vault", 30_000, async () => {
    const b = await t3.balanceOf(trader3, nvda.quote);
    return b > q3 ? b - q3 : undefined;
  });
  console.log(`trader3 received ${formatUnitsExact(got3, 6)} AUSD (agent session key, relayer paid gas, vault bought)`);

  // 6. passkey account: a software P-256 key stands in for a platform authenticator
  const passkey = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(passkey, false); // 0x04 ‖ x ‖ y
  const qx = toHex(pub.slice(1, 33));
  const qy = toHex(pub.slice(33, 65));
  const registration = await relayerApi.registerPasskey(qx, qy);
  if (!registration.tx) fail("the first passkey registration sent no transaction");
  if ((await relayerApi.registerPasskey(qx, qy)).tx !== null) fail("passkey registration is not idempotent");
  const pkAccount = registration.account;
  // a passkey account has no private key: fund it only through depositFor
  await publicClient.waitForTransactionReceipt({
    hash: await t1.walletClient!.writeContract({
      address: deployment.exchange,
      abi: unisonExchangeAbi,
      functionName: "depositFor",
      args: [pkAccount, nvda.base, 2n * 10n ** 18n],
      chain: devnet,
    }),
  });
  const pkOrder = buildOrder({
    account: pkAccount,
    marketId,
    side: Side.ASK,
    tick: tickOfPrice(await relayPrice(), m.tickSize) - 40n,
    qty: 10n ** 18n,
  });
  const digest = gatewayDigest(devnet.id, gateway, "Order", { ...pkOrder });
  const { id: pkJobId } = await relayerApi.postOrder(pkOrder, passkeySign(passkey, digest));
  const pkJob = await relayerApi.waitForJob(pkJobId, { timeoutMs: 30_000 });
  console.log(`passkey account ${pkAccount} placed slot ${pkJob.result?.slot} with a WebAuthn assertion (tx ${pkJob.tx})`);
  const gotPk = await waitFor("the passkey account's ask filled", 30_000, async () => {
    const b = await t1.balanceOf(pkAccount, nvda.quote);
    return b > 0n ? b : undefined;
  });
  console.log(`passkey account received ${formatUnitsExact(gotPk, 6)} AUSD`);

  // 7. faucet: mock AUSD + every base token deposited for a fresh account, once per 24 h
  const fresh = privateKeyToAccount(generatePrivateKey()).address;
  await relayerApi.waitForJob((await relayerApi.faucet(fresh)).id, { timeoutMs: 60_000 });
  const dripped = await t1.balanceOf(fresh, nvda.quote);
  if (dripped === 0n || (await t1.balanceOf(fresh, nvda.base)) === 0n) fail("the faucet deposited nothing");
  const again = await relayerApi.faucet(fresh).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(again instanceof RelayerError) || again.code !== "RATE_LIMITED") fail(`second drip not refused: ${String(again)}`);
  console.log(`faucet dripped ${formatUnitsExact(dripped, 6)} AUSD to ${fresh}`);

  // 8. the tape indexes everything from genesis and serves it
  const { startTape } = await import("@unison/tape");
  process.env.PORT = "8790";
  const tapeService = await startTape();
  const tape = new TapeClient("http://127.0.0.1:8790");
  const head = Number(await publicClient.getBlockNumber());
  const health = await waitFor("the tape to catch up", 60_000, async () => {
    const h = await tape.health();
    return h.indexed >= head ? h : undefined;
  });
  const info = (await tape.passkey(pkAccount)) ?? fail("the tape doesn't know the passkey");
  if (info.qx !== qx.toLowerCase() || info.qy !== qy.toLowerCase()) fail(`tape passkey: ${JSON.stringify(info)}`);
  const traded = await tape.prints(Number(marketId), { traded: true });
  const all = await tape.prints(Number(marketId), { limit: 1_000 });
  if (traded.length === 0) fail("the tape has no traded prints");
  if (!all.every((p) => p.chainOk)) fail(`receipt chain broken at ${all.find((p) => !p.chainOk)?.upTo}`);
  const summary = await tape.market(Number(marketId));
  if (!summary.lastPrint || summary.auctions < all.length) fail(`market summary: ${JSON.stringify(summary)}`);
  const pkOrders = await tape.orders(pkAccount, { status: "all" });
  if (pkOrders.length !== 1 || BigInt(pkOrders[0]!.quote) === 0n) fail(`tape passkey orders: ${JSON.stringify(pkOrders)}`);
  const fairness = await tape.fairness(Number(marketId), { window: "1h" });
  if (!fairness.chainOk) fail("fairness window reports a broken receipt chain");
  const heads: HeadEvent[] = [];
  const stream = tape.stream(["heads", `prints:${marketId}`], { head: (h) => heads.push(h) });
  await waitFor("a live head over SSE", 15_000, async () => (heads.length > 0 ? heads[0] : undefined));
  stream.close();
  console.log(
    `tape: indexed ${health.indexed}, ${all.length} prints (${traded.length} traded, chain verified), ` +
      `passkey ${info.account}, regime ${summary.regime}, mean |dev| ${fairness.meanAbsDevBps} bp, SSE head ${heads[0]!.block}`,
  );

  tapeService.stop();
  await relayer.stop();
  unwatchBlocks();
  unwatchPlaced();
  unwatchPrints();
  server.close();
  console.log("E2E OK", JSON.stringify(keeper.stats));
  process.exit(0);
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
