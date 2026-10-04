/**
 * Relayed actions: request-body schemas (zod), their typed form, and the contract call each one becomes.
 * Job payloads are stored as the same wire JSON and re-parsed with the same schemas on restart.
 */
import { decodeAbiParameters, erc20Abi, parseAbi, type Abi, type Address, type Hex } from "viem";
import {
  orderGatewayAbi,
  SIG_SESSION,
  unisonExchangeAbi,
  type GatewayCancel,
  type GatewayOrder,
  type GatewaySession,
  type GatewayWithdraw,
} from "@unison/sdk";
import type { RelayerJobKind } from "@unison/sdk/relayer";
import { z } from "zod";

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((s) => s.toLowerCase() as Address);
const hex = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "expected 0x-prefixed hex")
  .transform((s) => s as Hex);
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex string")
  .transform((s) => s.toLowerCase() as Hex);
const uint = (bits: number) =>
  z
    .union([z.string().regex(/^\d+$/, "expected a decimal integer string"), z.number().int().nonnegative()])
    .transform((v) => BigInt(v))
    .refine((v) => v < 1n << BigInt(bits), `must fit in uint${bits}`);
const small = (max: number) => z.coerce.number().int().min(0).max(max);

export const schemas = {
  order: z.object({
    order: z.object({
      account: address,
      marketId: uint(256),
      side: small(1),
      tick: small(2 ** 32 - 1),
      qty: uint(96),
      flags: small(255),
      nonce: uint(256),
      deadline: uint(64),
    }),
    sig: hex,
  }),
  cancel: z.object({
    cancel: z.object({ account: address, slot: uint(256), nonce: uint(256), deadline: uint(64) }),
    sig: hex,
  }),
  withdraw: z.object({
    withdraw: z.object({
      account: address,
      token: address,
      amount: uint(256),
      to: address,
      nonce: uint(256),
      deadline: uint(64),
    }),
    sig: hex,
  }),
  session: z.object({
    session: z.object({
      account: address,
      key: address,
      expiry: uint(64),
      maxQty: uint(96),
      maxNotional: uint(128),
      marketMask: uint(256),
      nonce: uint(256),
    }),
    sig: hex,
  }),
  claim: z.object({ account: address, slots: z.array(small(54)).min(1).max(55) }),
  faucet: z.object({ account: address }),
} as const;

export const passkeySchema = z.object({ qx: bytes32, qy: bytes32 });

export type Action =
  | { kind: "order"; order: GatewayOrder; sig: Hex }
  | { kind: "cancel"; cancel: GatewayCancel; sig: Hex }
  | { kind: "withdraw"; withdraw: GatewayWithdraw; sig: Hex }
  | { kind: "session"; session: GatewaySession; sig: Hex }
  | { kind: "claim"; account: Address; slots: number[] }
  | { kind: "faucet"; account: Address };

export class InvalidBody extends Error {}

/** Validates a request body (or a stored payload) for `kind`. */
export function parseAction(kind: RelayerJobKind, body: unknown): Action {
  const r = schemas[kind].safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new InvalidBody(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  return { kind, ...r.data } as Action;
}

/** The wire JSON of an action (bigints as decimal strings). */
export function actionJson(a: Action): string {
  const { kind: _kind, ...body } = a;
  return JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** The account an action is for (rate limits, faucet limits, the job's owner). */
export function accountOf(a: Action): Address {
  switch (a.kind) {
    case "order":
      return a.order.account;
    case "cancel":
      return a.cancel.account;
    case "withdraw":
      return a.withdraw.account;
    case "session":
      return a.session.account;
    default:
      return a.account;
  }
}

/** Signed gateway actions share one unordered-nonce space per account. */
export function nonceKey(a: Action): string | undefined {
  switch (a.kind) {
    case "order":
      return `${a.order.account}:${a.order.nonce}`;
    case "cancel":
      return `${a.cancel.account}:${a.cancel.nonce}`;
    case "withdraw":
      return `${a.withdraw.account}:${a.withdraw.nonce}`;
    case "session":
      return `${a.session.account}:${a.session.nonce}`;
    default:
      return undefined;
  }
}

export function deadlineOf(a: Action): bigint | undefined {
  if (a.kind === "order") return a.order.deadline;
  if (a.kind === "cancel") return a.cancel.deadline;
  if (a.kind === "withdraw") return a.withdraw.deadline;
  return undefined;
}

/** Signature kind (SIG_ACCOUNT / SIG_SESSION / SIG_PASSKEY), or undefined if the envelope doesn't decode. */
export function sigKind(sig: Hex): number | undefined {
  try {
    return Number(decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], sig)[0]);
  } catch {
    return undefined;
  }
}

export const isSessionSig = (sig: Hex) => sigKind(sig) === SIG_SESSION;

export interface Addresses {
  gateway: Address;
  exchange: Address;
}

/** The single-action contract call (faucet drips are several calls: see the flusher). */
export function callOf(a: Action, d: Addresses): ContractCall {
  const gw = { address: d.gateway, abi: orderGatewayAbi as Abi };
  switch (a.kind) {
    case "order":
      return { ...gw, functionName: "place", args: [a.order, a.sig] };
    case "cancel":
      return { ...gw, functionName: "cancel", args: [a.cancel, a.sig] };
    case "withdraw":
      return { ...gw, functionName: "withdraw", args: [a.withdraw, a.sig] };
    case "session":
      return { ...gw, functionName: "grantSessionSigned", args: [a.session, a.sig] };
    case "claim":
      return {
        address: d.exchange,
        abi: unisonExchangeAbi as Abi,
        functionName: "claim",
        args: [a.account, a.slots.map(BigInt)],
      };
    case "faucet":
      throw new Error("a faucet drip is not a single call");
  }
}

export const placeBatchCall = (orders: readonly { order: GatewayOrder; sig: Hex }[], d: Addresses): ContractCall => ({
  address: d.gateway,
  abi: orderGatewayAbi as Abi,
  functionName: "placeBatch",
  args: [orders.map((o) => o.order), orders.map((o) => o.sig)],
});

export const mockErc20Abi = parseAbi(["function mint(address to, uint256 amount)"]);

export const erc20 = (token: Address, functionName: "approve" | "allowance" | "decimals", args: readonly unknown[]): ContractCall => ({
  address: token,
  abi: erc20Abi as Abi,
  functionName,
  args,
});
