/**
 * OrderGateway signing (contracts/src/access/OrderGateway.sol). Users, agents and passkeys sign; anyone relays.
 *
 *   const o = buildOrder({ account, marketId: 0n, side: Side.BID, tick: 18_010n, qty: 10n ** 18n });
 *   const sig = await signAsAccount(wallet, chainId, gateway, o);       // EOA / Mera passkey-derived key
 *   const sig = await signAsSession(agentKey, chainId, gateway, o);     // capped AI-agent session key
 *   const sig = encodePasskeyAssertion(webauthnResult);                 // passkey account (navigator.credentials.get)
 *   await fetch(`${relayer}/v1/orders`, { method: "POST", body: JSON.stringify(orderToJson(o, sig)) });
 */
import {
  encodeAbiParameters,
  hashTypedData,
  toHex,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type Transport,
  type WalletClient,
} from "viem";
import { webauthnAssertionToResult, type AssertionResponseLike } from "./passkey.ts";

export const SIG_ACCOUNT = 0;
export const SIG_SESSION = 1;
export const SIG_PASSKEY = 2;

export const gatewayTypes = {
  Order: [
    { name: "account", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "tick", type: "uint32" },
    { name: "qty", type: "uint96" },
    { name: "flags", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Cancel: [
    { name: "account", type: "address" },
    { name: "slot", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Withdraw: [
    { name: "account", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Session: [
    { name: "account", type: "address" },
    { name: "key", type: "address" },
    { name: "expiry", type: "uint64" },
    { name: "maxQty", type: "uint96" },
    { name: "maxNotional", type: "uint128" },
    { name: "marketMask", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface GatewayOrder {
  account: Address;
  marketId: bigint;
  side: number;
  tick: number;
  qty: bigint;
  flags: number;
  nonce: bigint;
  deadline: bigint;
}

export interface GatewayCancel {
  account: Address;
  slot: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface GatewayWithdraw {
  account: Address;
  token: Address;
  amount: bigint;
  to: Address;
  nonce: bigint;
  deadline: bigint;
}

export interface GatewaySession {
  account: Address;
  key: Address;
  expiry: bigint;
  maxQty: bigint;
  maxNotional: bigint;
  marketMask: bigint;
  nonce: bigint;
}

type Primary = keyof typeof gatewayTypes;

export const gatewayDomain = (chainId: number, gateway: Address) => ({
  name: "Unison Gateway",
  version: "1",
  chainId,
  verifyingContract: gateway,
});

/** Random 256-bit unordered nonce (Permit2-style bitmap on-chain). */
export function randomNonce(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt(toHex(b));
}

export function buildOrder(
  o: Omit<GatewayOrder, "flags" | "nonce" | "deadline" | "tick" | "side"> & {
    side: number;
    tick: bigint | number;
    ioc?: boolean;
    nonce?: bigint;
    ttlSeconds?: number;
  },
): GatewayOrder {
  return {
    account: o.account,
    marketId: o.marketId,
    side: o.side,
    tick: Number(o.tick),
    qty: o.qty,
    flags: o.ioc ? 1 : 0,
    nonce: o.nonce ?? randomNonce(),
    deadline: BigInt(Math.floor(Date.now() / 1000) + (o.ttlSeconds ?? 120)),
  };
}

interface Freshness {
  /** default: a random 256-bit unordered nonce */
  nonce?: bigint;
  /** default: 120 s */
  ttlSeconds?: number;
}

const deadlineIn = (ttlSeconds = 120): bigint => BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);

/** A cancel of the account's order `slot` (random nonce, 120 s deadline — as `buildOrder`). */
export function buildCancel(c: { account: Address; slot: bigint | number } & Freshness): GatewayCancel {
  return { account: c.account, slot: BigInt(c.slot), nonce: c.nonce ?? randomNonce(), deadline: deadlineIn(c.ttlSeconds) };
}

/**
 * A withdrawal (needs the account's own signature: EOA, ERC-1271 or passkey — never a session key). `to` is
 * explicit on purpose: a passkey account has no private key, so tokens sent to its own address are lost.
 */
export function buildWithdraw(
  w: { account: Address; token: Address; amount: bigint; to: Address } & Freshness,
): GatewayWithdraw {
  return {
    account: w.account,
    token: w.token,
    amount: w.amount,
    to: w.to,
    nonce: w.nonce ?? randomNonce(),
    deadline: deadlineIn(w.ttlSeconds),
  };
}

/**
 * A session-key grant for `grantSessionSigned`: the key may place and cancel within the caps until `expiry`
 * (default: 1 hour from now; `expiry: 0n` revokes). Markets as a bit mask or a list of ids (0..255).
 */
export function buildSession(s: {
  account: Address;
  key: Address;
  /** base units per order */
  maxQty: bigint;
  /** quote units per order */
  maxNotional: bigint;
  marketMask?: bigint;
  marketIds?: readonly (bigint | number)[];
  /** unix seconds; overrides ttlSeconds */
  expiry?: bigint;
  /** default 3,600 */
  ttlSeconds?: number;
  nonce?: bigint;
}): GatewaySession {
  let mask = s.marketMask;
  if (mask === undefined) {
    if (!s.marketIds) throw new Error("buildSession: marketMask or marketIds is required");
    mask = 0n;
    for (const id of s.marketIds) {
      const i = BigInt(id);
      if (i < 0n || i > 255n) throw new Error(`buildSession: market ${i} outside 0..255`);
      mask |= 1n << i;
    }
  }
  return {
    account: s.account,
    key: s.key,
    expiry: s.expiry ?? deadlineIn(s.ttlSeconds ?? 3_600),
    maxQty: s.maxQty,
    maxNotional: s.maxNotional,
    marketMask: mask,
    nonce: s.nonce ?? randomNonce(),
  };
}

export function gatewayDigest<P extends Primary>(
  chainId: number,
  gateway: Address,
  primaryType: P,
  message: Record<string, unknown>,
): Hex {
  return hashTypedData({
    domain: gatewayDomain(chainId, gateway),
    types: gatewayTypes,
    primaryType,
    message,
  } as never);
}

async function signTyped(
  signer: LocalAccount,
  chainId: number,
  gateway: Address,
  primaryType: Primary,
  message: Record<string, unknown>,
): Promise<Hex> {
  return signer.signTypedData({
    domain: gatewayDomain(chainId, gateway),
    types: gatewayTypes,
    primaryType,
    message: message as never,
  });
}

/** The gateway's signature envelope: abi.encode(uint8 kind, bytes data). */
export const encodeSig = (kind: number, data: Hex): Hex =>
  encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, data]);

/**
 * Signature by the account through a wallet client — e.g. an injected browser wallet (`eth_signTypedData_v4`).
 * The signer is `account` if given, else the client's account; it must be the action's account (or the owner key
 * of an ERC-1271 wallet).
 */
export async function signTypedForGateway<T extends Transport, C extends Chain | undefined, A extends Account | undefined>(
  walletClient: WalletClient<T, C, A>,
  chainId: number,
  gateway: Address,
  primaryType: Primary,
  message: GatewayOrder | GatewayCancel | GatewayWithdraw | GatewaySession,
  account?: Account | Address,
): Promise<Hex> {
  const signer = account ?? walletClient.account;
  if (!signer) throw new Error("signTypedForGateway: the wallet client has no account");
  const sig = await walletClient.signTypedData({
    account: signer,
    domain: gatewayDomain(chainId, gateway),
    types: gatewayTypes,
    primaryType,
    message,
  } as never);
  return encodeSig(SIG_ACCOUNT, sig);
}

/** Signature by the account itself (EOA, Mera-derived key, or an ERC-1271 wallet's owner key). */
export async function signAsAccount(
  account: LocalAccount,
  chainId: number,
  gateway: Address,
  message: GatewayOrder | GatewayCancel | GatewayWithdraw | GatewaySession,
  primaryType: Primary = "Order",
): Promise<Hex> {
  return encodeSig(SIG_ACCOUNT, await signTyped(account, chainId, gateway, primaryType, message as never));
}

/** Signature by a session key the account granted (orders and cancels only). */
export async function signAsSession(
  key: LocalAccount,
  chainId: number,
  gateway: Address,
  message: GatewayOrder | GatewayCancel,
  primaryType: "Order" | "Cancel" = "Order",
): Promise<Hex> {
  const sig = await signTyped(key, chainId, gateway, primaryType, message as never);
  return encodeSig(SIG_SESSION, encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [key.address, sig]));
}

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export interface WebAuthnResult {
  authenticatorData: Uint8Array | Hex;
  clientDataJSON: string;
  /** DER-decoded signature components */
  r: bigint;
  s: bigint;
}

/** Encodes a WebAuthn assertion (from navigator.credentials.get with challenge = digest bytes) for the gateway. */
export function encodePasskeyAssertion(a: WebAuthnResult): Hex {
  const typeIndex = a.clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = a.clientDataJSON.indexOf('"challenge":"');
  if (typeIndex < 0 || challengeIndex < 0) throw new Error("not a webauthn.get assertion");
  const s = a.s > P256_N / 2n ? P256_N - a.s : a.s; // the contract accepts low-s only
  const authData = typeof a.authenticatorData === "string" ? a.authenticatorData : toHex(a.authenticatorData);
  const data = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "authenticatorData", type: "bytes" },
          { name: "clientDataJSON", type: "string" },
          { name: "challengeIndex", type: "uint256" },
          { name: "typeIndex", type: "uint256" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    [
      {
        authenticatorData: authData,
        clientDataJSON: a.clientDataJSON,
        challengeIndex: BigInt(challengeIndex),
        typeIndex: BigInt(typeIndex),
        r: toHex(a.r, { size: 32 }),
        s: toHex(s, { size: 32 }),
      },
    ],
  );
  return encodeSig(SIG_PASSKEY, data);
}

/**
 * A passkey signature for the gateway straight from `navigator.credentials.get(...).response`, requested with
 * `challenge: challengeFromDigest(digest)`.
 */
export function passkeySignatureFromWebAuthn(response: AssertionResponseLike): Hex {
  return encodePasskeyAssertion(webauthnAssertionToResult(response));
}

/** Parses a DER-encoded ECDSA signature (what WebAuthn returns) into r, s. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error("not DER");
  let i = 2;
  const read = () => {
    if (der[i] !== 0x02) throw new Error("bad DER integer");
    const len = der[i + 1]!;
    const v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    return BigInt(toHex(v));
  };
  return { r: read(), s: read() };
}

export const orderToJson = (o: GatewayOrder, sig: Hex) => ({
  order: {
    ...o,
    marketId: o.marketId.toString(),
    qty: o.qty.toString(),
    nonce: o.nonce.toString(),
    deadline: o.deadline.toString(),
  },
  sig,
});

export const orderFromJson = (j: ReturnType<typeof orderToJson>): { order: GatewayOrder; sig: Hex } => ({
  order: {
    ...j.order,
    marketId: BigInt(j.order.marketId),
    qty: BigInt(j.order.qty),
    nonce: BigInt(j.order.nonce),
    deadline: BigInt(j.order.deadline),
  },
  sig: j.sig,
});

export const cancelToJson = (c: GatewayCancel, sig: Hex) => ({
  cancel: { ...c, slot: c.slot.toString(), nonce: c.nonce.toString(), deadline: c.deadline.toString() },
  sig,
});

export const cancelFromJson = (j: ReturnType<typeof cancelToJson>): { cancel: GatewayCancel; sig: Hex } => ({
  cancel: {
    ...j.cancel,
    slot: BigInt(j.cancel.slot),
    nonce: BigInt(j.cancel.nonce),
    deadline: BigInt(j.cancel.deadline),
  },
  sig: j.sig,
});

export const withdrawToJson = (w: GatewayWithdraw, sig: Hex) => ({
  withdraw: { ...w, amount: w.amount.toString(), nonce: w.nonce.toString(), deadline: w.deadline.toString() },
  sig,
});

export const withdrawFromJson = (j: ReturnType<typeof withdrawToJson>): { withdraw: GatewayWithdraw; sig: Hex } => ({
  withdraw: {
    ...j.withdraw,
    amount: BigInt(j.withdraw.amount),
    nonce: BigInt(j.withdraw.nonce),
    deadline: BigInt(j.withdraw.deadline),
  },
  sig: j.sig,
});

export const sessionToJson = (s: GatewaySession, sig: Hex) => ({
  session: {
    ...s,
    expiry: s.expiry.toString(),
    maxQty: s.maxQty.toString(),
    maxNotional: s.maxNotional.toString(),
    marketMask: s.marketMask.toString(),
    nonce: s.nonce.toString(),
  },
  sig,
});

export const sessionFromJson = (j: ReturnType<typeof sessionToJson>): { session: GatewaySession; sig: Hex } => ({
  session: {
    ...j.session,
    expiry: BigInt(j.session.expiry),
    maxQty: BigInt(j.session.maxQty),
    maxNotional: BigInt(j.session.maxNotional),
    marketMask: BigInt(j.session.marketMask),
    nonce: BigInt(j.session.nonce),
  },
  sig: j.sig,
});
