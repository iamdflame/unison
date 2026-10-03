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
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";

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

const encodeSig = (kind: number, data: Hex): Hex =>
  encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, data]);

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
