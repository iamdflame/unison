/**
 * Typed client for the gasless relayer (services/relayer, docs/API.md).
 *
 *   const relayer = new RelayerClient("https://relayer.unison.trade");
 *   const { id } = await relayer.postOrder(order, await signAsSession(agent, chainId, gateway, order));
 *   const job = await relayer.waitForJob(id);            // → { status: "done", result: { slot } }
 *
 * Every action is simulated before it is accepted; failures throw a `RelayerError` with the decoded
 * custom-error `code` and a human `message` (see `decodeUnisonError`).
 */
import type { Address, Hex } from "viem";
import type { GatewayCancel, GatewayOrder, GatewaySession, GatewayWithdraw } from "./gateway.ts";

export type RelayerJobKind = "order" | "cancel" | "withdraw" | "session" | "claim" | "faucet";
export type RelayerJobStatus = "queued" | "sent" | "done" | "failed";

export interface RelayerJob {
  id: string;
  kind: RelayerJobKind;
  status: RelayerJobStatus;
  tx?: Hex;
  result?: { slot?: number };
  error?: { code: string; message: string };
}

export interface PasskeyRegistration {
  account: Address;
  registered: true;
  /** null when the passkey was already registered */
  tx: Hex | null;
}

export interface RelayerHealth {
  ok: boolean;
  relayer: Address;
  chainId: number;
  queued: number;
  faucet: boolean;
}

export class RelayerError extends Error {
  readonly code: string;
  readonly status: number;
  /** the failed job, when the error comes from `waitForJob` */
  readonly job?: RelayerJob;
  constructor(code: string, message: string, status = 0, job?: RelayerJob) {
    super(message);
    this.name = "RelayerError";
    this.code = code;
    this.status = status;
    if (job) this.job = job;
  }
}

/** JSON with every bigint as a decimal string (the relayer's wire format). */
export const relayerJson = (body: unknown): string =>
  JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export class RelayerClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, opts: { fetch?: typeof fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const r = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: relayerJson(body) }),
    });
    let j: unknown;
    try {
      j = await r.json();
    } catch {
      throw new RelayerError("UNAVAILABLE", `relayer: HTTP ${r.status}`, r.status);
    }
    if (!r.ok) {
      const e = (j as { error?: { code?: string; message?: string } }).error;
      throw new RelayerError(e?.code ?? "UNAVAILABLE", e?.message ?? `relayer: HTTP ${r.status}`, r.status);
    }
    return j as T;
  }

  health(): Promise<RelayerHealth> {
    return this.call("GET", "/health");
  }

  postOrder(order: GatewayOrder, sig: Hex): Promise<{ id: string }> {
    return this.call("POST", "/v1/orders", { order, sig });
  }

  postCancel(cancel: GatewayCancel, sig: Hex): Promise<{ id: string }> {
    return this.call("POST", "/v1/cancels", { cancel, sig });
  }

  /** Withdrawals need the account's own signature (session keys are rejected). */
  postWithdraw(withdraw: GatewayWithdraw, sig: Hex): Promise<{ id: string }> {
    return this.call("POST", "/v1/withdrawals", { withdraw, sig });
  }

  /** Grants (or, with expiry 0, revokes) a session key with the account's signature. */
  postSession(session: GatewaySession, sig: Hex): Promise<{ id: string }> {
    return this.call("POST", "/v1/sessions", { session, sig });
  }

  /** Registers a passkey account (idempotent). Fund it only through `UnisonExchange.depositFor`. */
  registerPasskey(qx: Hex, qy: Hex): Promise<PasskeyRegistration> {
    return this.call("POST", "/v1/passkeys", { qx, qy });
  }

  /** Settles filled orders (permissionless; the keeper also auto-claims). */
  claim(account: Address, slots: readonly (number | bigint)[]): Promise<{ id: string }> {
    return this.call("POST", "/v1/claims", { account, slots: slots.map(Number) });
  }

  /** Devnet / testnet only: mock AUSD plus every market's base token, deposited for `account`. */
  faucet(account: Address): Promise<{ id: string }> {
    return this.call("POST", "/v1/faucet", { account });
  }

  job(id: string): Promise<RelayerJob> {
    return this.call("GET", `/v1/jobs/${encodeURIComponent(id)}`);
  }

  /** Polls a job until it is done (resolves) or failed (throws a `RelayerError` carrying the job). */
  async waitForJob(
    id: string,
    opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RelayerJob> {
    const until = Date.now() + (opts.timeoutMs ?? 60_000);
    for (;;) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("aborted");
      const j = await this.job(id);
      if (j.status === "done") return j;
      if (j.status === "failed") {
        throw new RelayerError(j.error?.code ?? "UNKNOWN", j.error?.message ?? "relayed action failed", 0, j);
      }
      if (Date.now() >= until) throw new RelayerError("TIMEOUT", `job ${id} still ${j.status}`, 0, j);
      await sleep(opts.intervalMs ?? 500, opts.signal);
    }
  }
}
