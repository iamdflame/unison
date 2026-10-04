/**
 * The relayer's HTTP API (docs/API.md). Every action is validated (zod), checked against its deadline, nonce
 * and limits, simulated with eth_call, and only then queued; the flusher sends it with the next block.
 */
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { Abi, Address, Hex } from "viem";
import { orderGatewayAbi } from "@unison/sdk";
import { decodeUnisonError } from "@unison/sdk/errors";
import type { RelayerJobKind } from "@unison/sdk/relayer";
import {
  accountOf,
  actionJson,
  callOf,
  deadlineOf,
  InvalidBody,
  isSessionSig,
  nonceKey,
  parseAction,
  passkeySchema,
  type Action,
  type Addresses,
} from "./actions.ts";
import { isTransportError, withHeadroom, type RelayerChain } from "./chain.ts";
import type { Flusher } from "./flusher.ts";
import { jobJson, type JobStore } from "./jobs.ts";
import { clientIp, TokenBuckets } from "./limits.ts";

export interface FaucetLimits {
  enabled: boolean;
  perAccount: number;
  perIp: number;
  dailyBudget: number;
}

export interface RelayerAppOptions {
  chain: RelayerChain;
  store: JobStore;
  flusher: Flusher;
  addresses: Addresses;
  corsOrigins?: string[];
  faucet?: FaucetLimits;
  ipBurst?: number;
  ipPerSec?: number;
  accountBurst?: number;
  accountPerSec?: number;
  trustProxy?: boolean;
  now?: () => number;
}

type Status = 400 | 404 | 429 | 503;
type Env = { Variables: { ip: string } };

const fail = (c: Context, status: Status, code: string, message: string) => c.json({ error: { code, message } }, status);

const DAY_MS = 86_400_000;

export function createRelayerApp(opts: RelayerAppOptions): Hono<Env> {
  const { chain, store, flusher, addresses } = opts;
  const now = opts.now ?? Date.now;
  const faucet = opts.faucet ?? { enabled: false, perAccount: 1, perIp: 3, dailyBudget: 1_000 };
  const ipBuckets = new TokenBuckets(opts.ipBurst ?? 60, opts.ipPerSec ?? 10, now);
  const accountBuckets = new TokenBuckets(opts.accountBurst ?? 10, opts.accountPerSec ?? 1, now);
  const registering = new Map<string, Promise<Hex | null>>();
  const app = new Hono<Env>();

  /** Simulation / estimation failures: decoded custom errors are 400s, an unreachable node is a 503. */
  const chainError = (c: Context, e: unknown) => {
    if (isTransportError(e)) return fail(c, 503, "UNAVAILABLE", "The chain RPC is unavailable. Retry shortly.");
    const { code, message } = decodeUnisonError(e);
    return fail(c, 400, code, message);
  };

  const rejected = (c: Context, code: string) => fail(c, 400, code, decodeUnisonError(code).message);

  const limited = (c: Context, message = "Too many requests. Slow down.", retryAfter?: number) => {
    if (retryAfter) c.header("Retry-After", String(retryAfter));
    return fail(c, 429, "RATE_LIMITED", message);
  };

  app.use(
    "*",
    cors({
      origin: opts.corsOrigins ?? ["http://localhost:3000"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
  app.use("/v1/*", async (c, next) => {
    const ip = clientIp(c, opts.trustProxy ?? false);
    c.set("ip", ip);
    const wait = ipBuckets.take(ip);
    if (wait > 0) return limited(c, undefined, wait);
    await next();
  });
  app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => fail(c, 400, "INVALID", "Body too large.") }));
  app.onError((err, c) => {
    if (err instanceof InvalidBody) return fail(c, 400, "INVALID", err.message);
    console.error(JSON.stringify({ svc: "relayer", level: "error", path: c.req.path, error: err.message }));
    return fail(c, 503, "UNAVAILABLE", "The relayer couldn't answer. Retry shortly.");
  });
  app.notFound((c) => fail(c, 404, "NOT_FOUND", "Not found."));

  const body = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new InvalidBody("body: expected JSON");
    }
  };

  app.get("/health", (c) =>
    c.json({ ok: true, relayer: chain.relayer.toLowerCase(), chainId: chain.chainId, queued: flusher.queued, faucet: faucet.enabled }),
  );

  /** Validate → limits → simulate → persist → queue. */
  async function accept(c: Context<Env>, kind: RelayerJobKind, action: Action) {
    const account = accountOf(action);
    const wait = accountBuckets.take(account);
    if (wait > 0) return limited(c, "Too many actions for this account. Slow down.", wait);
    const deadline = deadlineOf(action);
    if (deadline !== undefined && deadline * 1000n < BigInt(now())) return rejected(c, "Expired");
    if (action.kind === "withdraw" && isSessionSig(action.sig)) return rejected(c, "SessionNotAllowed");
    const key = nonceKey(action);
    if (key && flusher.hasNonce(key)) return rejected(c, "NonceUsed");
    let gas: bigint | undefined;
    if (kind !== "faucet") {
      const call = callOf(action, addresses);
      try {
        await chain.simulate(call);
        // orders: their own estimate floors the batch limit (see flusher)
        if (kind === "order") gas = await chain.estimateGas(call);
      } catch (e) {
        return chainError(c, e);
      }
    }
    const job = store.create({
      id: randomUUID(),
      kind,
      payload: actionJson(action),
      account,
      ip: c.get("ip"),
      ...(gas === undefined ? {} : { gas: gas.toString() }),
    });
    flusher.enqueue(job, action);
    return c.json({ id: job.id }, 202);
  }

  const route = (path: string, kind: RelayerJobKind) =>
    app.post(path, async (c) => accept(c, kind, parseAction(kind, await body(c))));

  route("/v1/orders", "order");
  route("/v1/cancels", "cancel");
  route("/v1/withdrawals", "withdraw");
  route("/v1/sessions", "session");
  route("/v1/claims", "claim");

  app.post("/v1/faucet", async (c) => {
    const action = parseAction("faucet", await body(c)) as Extract<Action, { kind: "faucet" }>;
    if (!faucet.enabled) return fail(c, 400, "FAUCET_DISABLED", "The faucet only runs on devnets and testnets.");
    const since = now() - DAY_MS;
    if (store.faucetGrants(since, { account: action.account }) >= faucet.perAccount) {
      return limited(c, "This account already got test funds in the last 24 hours.");
    }
    if (store.faucetGrants(since, { ip: c.get("ip") }) >= faucet.perIp) {
      return limited(c, "This network already got test funds 3 times today.");
    }
    if (store.faucetGrants(since) >= faucet.dailyBudget) return limited(c, "The faucet's daily budget is spent. Try tomorrow.");
    return accept(c, "faucet", action);
  });

  app.post("/v1/passkeys", async (c) => {
    const r = passkeySchema.safeParse(await body(c));
    if (!r.success) throw new InvalidBody(`${r.error.issues[0]!.path.join(".") || "body"}: ${r.error.issues[0]!.message}`);
    const { qx, qy } = r.data;
    const gw = { address: addresses.gateway, abi: orderGatewayAbi as Abi };
    try {
      const account = ((await chain.read({ ...gw, functionName: "passkeyAccount", args: [qx, qy] })) as Address).toLowerCase();
      const wait = accountBuckets.take(account);
      if (wait > 0) return limited(c, "Too many actions for this account. Slow down.", wait);
      const [storedQx] = (await chain.read({ ...gw, functionName: "passkeys", args: [account] })) as readonly [Hex, Hex];
      if (BigInt(storedQx) !== 0n) return c.json({ account, registered: true, tx: null });
      // one registration per key at a time; concurrent callers share it
      let p = registering.get(account);
      if (!p) {
        p = (async () => {
          const call = { ...gw, functionName: "registerPasskey", args: [qx, qy] };
          await chain.simulate(call); // invalid curve points revert BadSignature
          const hash = await chain.send(call, withHeadroom(await chain.estimateGas(call)));
          const rcpt = await chain.waitForReceipt(hash);
          if (rcpt.status !== "success") throw new Error(`registerPasskey reverted: ${hash}`);
          return hash;
        })().finally(() => registering.delete(account));
        registering.set(account, p);
      }
      return c.json({ account, registered: true, tx: await p });
    } catch (e) {
      return chainError(c, e);
    }
  });

  const job = (c: Context) => {
    const j = store.get(c.req.param("id") ?? "");
    if (!j) return fail(c, 404, "NOT_FOUND", "Unknown job.");
    return c.json(jobJson(j));
  };
  app.get("/v1/jobs/:id", job);
  app.get("/v1/orders/:id", job); // legacy alias

  return app;
}
