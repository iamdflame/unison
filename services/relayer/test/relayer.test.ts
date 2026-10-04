import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeErrorResult, HttpRequestError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildOrder,
  orderGatewayAbi,
  orderToJson,
  signAsAccount,
  signAsSession,
  unisonExchangeAbi,
  type GatewayWithdraw,
} from "@unison/sdk";
import { createRelayerApp, type FaucetLimits } from "../src/app.ts";
import { Flusher } from "../src/flusher.ts";
import { JobStore } from "../src/jobs.ts";
import { EXCHANGE, FakeChain, GATEWAY, RELAYER, relayedLog, relayFailedLog, revert, sentNames } from "./fake-chain.ts";

const alice = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const agent = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");
const AUSD = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const NVDA = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";

function relayer(
  opts: { faucet?: Partial<FaucetLimits>; accountBurst?: number; ipBurst?: number; dbPath?: string; corsOrigins?: string[] } = {},
) {
  const chain = new FakeChain();
  const store = new JobStore(opts.dbPath ?? ":memory:");
  const flusher = new Flusher({
    chain,
    store,
    addresses: { gateway: GATEWAY, exchange: EXCHANGE },
    faucetTokens: [
      { token: AUSD, whole: 10_000n },
      { token: NVDA, whole: 10n },
    ],
    log: () => {},
  });
  const app = createRelayerApp({
    chain,
    store,
    flusher,
    addresses: { gateway: GATEWAY, exchange: EXCHANGE },
    faucet: { enabled: false, perAccount: 1, perIp: 3, dailyBudget: 1_000, ...opts.faucet },
    ...(opts.accountBurst ? { accountBurst: opts.accountBurst } : {}),
    ...(opts.ipBurst ? { ipBurst: opts.ipBurst } : {}),
    ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
  });
  /** One block: flush every queue and wait for the transactions to settle. */
  const block = async () => {
    flusher.onBlock();
    await flusher.idle();
  };
  return { chain, store, flusher, app, block };
}

const post = (app: ReturnType<typeof relayer>["app"], path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });

const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function signedOrder(over: { qty?: bigint; nonce?: bigint; ttlSeconds?: number } = {}) {
  const o = buildOrder({ account: alice.address, marketId: 0n, side: 0, tick: 18_000, qty: over.qty ?? 10n ** 18n, ...over });
  return orderToJson(o, await signAsAccount(alice, 31_337, GATEWAY, o));
}

describe("relayer: orders", () => {
  it("simulates, queues, flushes one placeBatch per block and reports the slot", async () => {
    const { app, chain, block } = relayer();
    chain.estimate = (c) => (c.functionName === "place" ? 230_000n : 200_000n); // the batch estimate lands too low
    const r = await post(app, "/v1/orders", await signedOrder());
    expect(r.status).toBe(202);
    const { id } = await json(r);
    expect(chain.simulated.map((c) => c.functionName)).toEqual(["place"]);
    expect(await json(await app.request(`/v1/jobs/${id}`))).toEqual({ id, kind: "order", status: "queued" });

    chain.receipt = () => ({ status: "success", logs: [relayedLog(7n)] });
    await block();
    expect(sentNames(chain)).toEqual(["placeBatch"]);
    // the floor (the order's own estimate under 63/64) beats the low batch estimate; then × 1.2
    const floor = 21_000n + ((230_000n - 21_000n) * 64n) / 63n + 5_000n;
    expect(chain.sent[0]!.gas).toBe((floor * 12n + 9n) / 10n);
    const job = await json(await app.request(`/v1/jobs/${id}`));
    expect(job).toEqual({ id, kind: "order", status: "done", tx: chain.sent[0]!.hash, result: { slot: 7 } });
    expect(await json(await app.request(`/v1/orders/${id}`))).toEqual(job); // legacy alias
  });

  it("maps per-order RelayFailed reasons onto the right jobs", async () => {
    const { app, chain, block } = relayer();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await json(await post(app, "/v1/orders", await signedOrder({ nonce: BigInt(i + 1) })))).id);
    const reason = encodeErrorResult({ abi: unisonExchangeAbi, errorName: "InsufficientBalance" });
    chain.receipt = () => ({ status: "success", logs: [relayedLog(3n), relayFailedLog(1n, reason), relayedLog(4n)] });
    await block();
    expect(chain.sent).toHaveLength(1);
    const jobs = await Promise.all(ids.map(async (id) => json(await app.request(`/v1/jobs/${id}`))));
    expect(jobs.map((j) => [j.status, j.result?.slot ?? j.error?.code])).toEqual([
      ["done", 3],
      ["failed", "InsufficientBalance"],
      ["done", 4],
    ]);
    expect(jobs[1]!.error.message).toBe("Not enough free balance. Deposit first; funds in open orders are locked.");
  });

  it("rejects before spending gas: simulation reverts, expiry, replays and bad bodies", async () => {
    const { app, chain } = relayer();
    chain.simulateError = () => revert("SessionCap");
    const capped = await post(app, "/v1/orders", await signedOrder());
    expect(capped.status).toBe(400);
    expect(await json(capped)).toEqual({ error: { code: "SessionCap", message: "Over this session's limits." } });
    chain.simulateError = undefined;

    const expired = await post(app, "/v1/orders", await signedOrder({ ttlSeconds: -5 }));
    expect((await json(expired)).error.code).toBe("Expired");

    const body = await signedOrder({ nonce: 99n });
    expect((await post(app, "/v1/orders", body)).status).toBe(202);
    expect(await json(await post(app, "/v1/orders", body))).toEqual({ error: { code: "NonceUsed", message: "Already submitted." } });

    const bad = await post(app, "/v1/orders", { order: { ...body.order, qty: "-1" }, sig: body.sig });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.code).toBe("INVALID");
    expect((await json(await post(app, "/v1/orders", "{nope"))).error.code).toBe("INVALID");
    expect(chain.sent).toHaveLength(0);
  });

  it("answers 503 when the node is unreachable", async () => {
    const { app, chain } = relayer();
    chain.simulateError = () => new HttpRequestError({ url: "http://rpc", details: "fetch failed" });
    const r = await post(app, "/v1/orders", await signedOrder());
    expect(r.status).toBe(503);
    expect((await json(r)).error.code).toBe("UNAVAILABLE");
  });

  it("retries a batch after transport errors, then fails it as UNAVAILABLE", async () => {
    const { app, chain, block } = relayer();
    const { id } = await json(await post(app, "/v1/orders", await signedOrder()));
    chain.estimateError = (c) => (c.functionName === "placeBatch" ? new HttpRequestError({ url: "http://rpc" }) : undefined);
    await block();
    expect((await json(await app.request(`/v1/jobs/${id}`))).status).toBe("queued");
    await block();
    await block();
    expect(await json(await app.request(`/v1/jobs/${id}`))).toMatchObject({ status: "failed", error: { code: "UNAVAILABLE" } });
  });
});

describe("relayer: other actions", () => {
  it("relays cancels, sessions and claims as one transaction each, gas estimated × 1.2", async () => {
    const { app, chain, block } = relayer();
    const cancel = { account: alice.address, slot: 3n, nonce: 11n, deadline: BigInt(Math.floor(Date.now() / 1000) + 60) };
    const cancelSig = await signAsSession(agent, 31_337, GATEWAY, cancel, "Cancel");
    expect((await post(app, "/v1/cancels", { cancel, sig: cancelSig })).status).toBe(202);
    const session = { account: alice.address, key: agent.address, expiry: 0n, maxQty: 0n, maxNotional: 0n, marketMask: 0n, nonce: 12n };
    expect((await post(app, "/v1/sessions", { session, sig: await signAsAccount(alice, 31_337, GATEWAY, session, "Session") })).status).toBe(202);
    const claim = await post(app, "/v1/claims", { account: alice.address, slots: [1, 2] });
    expect(claim.status).toBe(202);
    chain.estimate = () => 80_000n;
    await block();
    expect(sentNames(chain).sort()).toEqual(["cancel", "claim", "grantSessionSigned"]);
    expect(chain.sent.every((s) => s.gas === 96_000n)).toBe(true);
    expect(chain.sent.find((s) => s.call.functionName === "claim")!.call.args).toEqual([alice.address.toLowerCase(), [1n, 2n]]);
    expect((await json(await app.request(`/v1/jobs/${(await json(claim)).id}`))).status).toBe("done");
  });

  it("only takes withdrawals signed by the account itself", async () => {
    const { app, chain } = relayer();
    const w: GatewayWithdraw = { account: alice.address, token: AUSD, amount: 5n, to: alice.address, nonce: 21n, deadline: BigInt(Math.floor(Date.now() / 1000) + 60) };
    // a session envelope (kind 1) is refused before simulation
    const sessionSig = encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, "0x1234"]);
    expect(await json(await post(app, "/v1/withdrawals", { withdraw: w, sig: sessionSig }))).toEqual({
      error: { code: "SessionNotAllowed", message: "Session keys can't do that; sign with the account." },
    });
    expect(chain.simulated).toHaveLength(0);
    expect((await post(app, "/v1/withdrawals", { withdraw: w, sig: await signAsAccount(alice, 31_337, GATEWAY, w, "Withdraw") })).status).toBe(202);
  });

  it("registers passkeys idempotently and shares concurrent registrations", async () => {
    const { app, chain } = relayer();
    const account = "0x36ad6850ce84bddefb1a1f7232fd7d86adfe54e0";
    let registered = false;
    chain.read = (async (c: { functionName: string }) => {
      if (c.functionName === "passkeyAccount") return account;
      if (c.functionName === "passkeys") return [registered ? `0x${"11".repeat(32)}` : `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`];
      throw new Error(c.functionName);
    }) as never;
    chain.receipt = () => {
      registered = true;
      return { status: "success", logs: [] };
    };
    const key = { qx: `0x${"11".repeat(32)}`, qy: `0x${"22".repeat(32)}` };
    const [a, b] = await Promise.all([post(app, "/v1/passkeys", key), post(app, "/v1/passkeys", key)]);
    const tx = chain.sent[0]!.hash;
    expect([await json(a), await json(b)]).toEqual([
      { account, registered: true, tx },
      { account, registered: true, tx },
    ]);
    expect(sentNames(chain)).toEqual(["registerPasskey"]);
    expect(await json(await post(app, "/v1/passkeys", key))).toEqual({ account, registered: true, tx: null });
    expect(chain.sent).toHaveLength(1);

    chain.read = (async (c: { functionName: string }) =>
      c.functionName === "passkeyAccount" ? account : [`0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`]) as never;
    chain.simulateError = () => revert("BadSignature", orderGatewayAbi);
    expect(await json(await post(app, "/v1/passkeys", { qx: `0x${"01".repeat(32)}`, qy: key.qy }))).toEqual({
      error: { code: "BadSignature", message: "The signature didn't verify." },
    });
    expect((await json(await post(app, "/v1/passkeys", { qx: "0x12", qy: key.qy }))).error.code).toBe("INVALID");
  });
});

describe("relayer: faucet and limits", () => {
  it("is off unless enabled", async () => {
    const { app } = relayer();
    expect(await json(await post(app, "/v1/faucet", { account: alice.address }))).toMatchObject({ error: { code: "FAUCET_DISABLED" } });
  });

  it("mints, approves once and deposits for the account; 1 per account and 3 per IP a day", async () => {
    const { app, chain, block } = relayer({ faucet: { enabled: true } });
    chain.read = (async (c: { functionName: string; address: string }) => {
      if (c.functionName === "decimals") return c.address === AUSD ? 6 : 18;
      if (c.functionName === "allowance") return 0n;
      throw new Error(c.functionName);
    }) as never;
    const r = await post(app, "/v1/faucet", { account: alice.address });
    expect(r.status).toBe(202);
    await block();
    expect(sentNames(chain)).toEqual(["mint", "mint", "approve", "approve", "depositFor", "depositFor"]);
    expect(chain.sent[0]!.call.args).toEqual([RELAYER, 10_000_000_000n]);
    expect(chain.sent[5]!.call.args).toEqual([alice.address.toLowerCase(), NVDA, 10n * 10n ** 18n]);
    expect(await json(await app.request(`/v1/jobs/${(await json(r)).id}`))).toMatchObject({ status: "done", tx: chain.sent[5]!.hash });

    expect(await json(await post(app, "/v1/faucet", { account: alice.address }))).toMatchObject({ error: { code: "RATE_LIMITED" } });
    for (const a of ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"]) {
      expect((await post(app, "/v1/faucet", { account: a })).status).toBe(202);
    }
    const fourth = await post(app, "/v1/faucet", { account: "0x0000000000000000000000000000000000000003" });
    expect(fourth.status).toBe(429);
    expect((await json(fourth)).error.message).toContain("3 times");
  });

  it("enforces per-account and per-IP token buckets", async () => {
    const { app } = relayer({ accountBurst: 2 });
    for (let i = 0; i < 2; i++) expect((await post(app, "/v1/orders", await signedOrder({ nonce: BigInt(100 + i) }))).status).toBe(202);
    const limited = await post(app, "/v1/orders", await signedOrder({ nonce: 102n }));
    expect(limited.status).toBe(429);
    expect((await json(limited)).error.code).toBe("RATE_LIMITED");
    expect(limited.headers.get("retry-after")).toBeTruthy();

    const { app: app2 } = relayer({ ipBurst: 1 });
    expect((await app2.request("/v1/jobs/x")).status).toBe(404);
    expect((await app2.request("/v1/jobs/x")).status).toBe(429);
  });

  it("serves health, CORS for allowed origins only, and NOT_FOUND", async () => {
    const { app } = relayer({ corsOrigins: ["https://unison.trade"] });
    expect(await json(await app.request("/health"))).toEqual({ ok: true, relayer: RELAYER, chainId: 31_337, queued: 0, faucet: false });
    const pre = await app.request("/v1/orders", { method: "OPTIONS", headers: { origin: "https://unison.trade", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://unison.trade");
    const other = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(await json(await app.request("/v1/jobs/nope"))).toEqual({ error: { code: "NOT_FOUND", message: "Unknown job." } });
  });
});

describe("relayer: persistence", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("picks queued work back up and resolves sent batches from their receipts after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relayer-"));
    dirs.push(dir);
    const dbPath = join(dir, "jobs.db");
    const first = relayer({ dbPath });
    const queued = (await json(await post(first.app, "/v1/orders", await signedOrder({ nonce: 1n })))).id as string;
    const sent = (await json(await post(first.app, "/v1/orders", await signedOrder({ nonce: 2n })))).id as string;
    first.store.update(sent, { status: "sent", tx: `0x${"00".repeat(31)}01` as Hex, batchIndex: 0 });
    first.store.close();

    const second = relayer({ dbPath });
    await second.chain.send({ address: GATEWAY, abi: orderGatewayAbi, functionName: "placeBatch", args: [] }, 1n); // the tx that was in flight
    second.chain.receipt = () => ({ status: "success", logs: [relayedLog(9n)] });
    await second.flusher.recover();
    expect(await json(await second.app.request(`/v1/jobs/${sent}`))).toMatchObject({ status: "done", result: { slot: 9 } });
    expect(second.flusher.queued).toBe(1);
    // the recovered job's nonce is in flight again: a resubmission is refused before simulation
    expect((await json(await post(second.app, "/v1/orders", await signedOrder({ nonce: 1n })))).error.code).toBe("NonceUsed");
    second.chain.receipt = () => ({ status: "success", logs: [relayedLog(10n)] });
    await second.block();
    expect(await json(await second.app.request(`/v1/jobs/${queued}`))).toMatchObject({ status: "done", result: { slot: 10 } });
    second.store.close();
  });
});
