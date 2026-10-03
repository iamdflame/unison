/**
 * Operator-signed references (contracts/src/pricing/OperatorSignedReference.sol, SPEC §7.2).
 * A relay signs one EIP-712 `Reference` per (venue, market, batch); the keeper passes the encoded report to
 * `UnisonExchange.clear(marketId, payload)`.
 */
import {
  encodeAbiParameters,
  hashTypedData,
  parseSignature,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";

export const REFERENCE_DOMAIN_NAME = "Unison Reference";
export const REFERENCE_DOMAIN_VERSION = "1";

export const referenceTypes = {
  Reference: [
    { name: "venue", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "batch", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "publishTimeMs", type: "uint64" },
    { name: "status", type: "uint8" },
  ],
} as const;

export interface ReferenceMessage {
  venue: Address;
  marketId: bigint;
  batch: bigint;
  price: bigint;
  publishTimeMs: bigint;
  status: number;
}

export interface ReferenceSig {
  signerId: number;
  v: number;
  r: Hex;
  s: Hex;
}

export interface SignedReport {
  price: bigint;
  publishTimeMs: bigint;
  status: number;
  sigs: ReferenceSig[];
}

export const referenceDomain = (chainId: number, adapter: Address) => ({
  name: REFERENCE_DOMAIN_NAME,
  version: REFERENCE_DOMAIN_VERSION,
  chainId,
  verifyingContract: adapter,
});

export function referenceDigest(chainId: number, adapter: Address, message: ReferenceMessage): Hex {
  return hashTypedData({
    domain: referenceDomain(chainId, adapter),
    types: referenceTypes,
    primaryType: "Reference",
    message,
  });
}

/** Signs a reference with a secp256k1 key (P-256 relays sign the same digest with their HSM). */
export async function signReferenceEcdsa(
  account: LocalAccount,
  signerId: number,
  chainId: number,
  adapter: Address,
  message: ReferenceMessage,
): Promise<ReferenceSig> {
  const sig = await account.signTypedData({
    domain: referenceDomain(chainId, adapter),
    types: referenceTypes,
    primaryType: "Reference",
    message,
  });
  const { r, s, v, yParity } = parseSignature(sig);
  return { signerId, v: Number(v ?? (yParity === 0 ? 27n : 28n)), r, s };
}

/** ABI-encodes a report as the `payload` of `UnisonExchange.clear`. */
export function encodeReport(report: SignedReport): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "price", type: "uint256" },
          { name: "publishTimeMs", type: "uint64" },
          { name: "status", type: "uint8" },
          {
            name: "sigs",
            type: "tuple[]",
            components: [
              { name: "signerId", type: "uint8" },
              { name: "v", type: "uint8" },
              { name: "r", type: "bytes32" },
              { name: "s", type: "bytes32" },
            ],
          },
        ],
      },
    ],
    [report],
  );
}

/** JSON transport for reports (bigint → string). */
export const reportToJson = (r: SignedReport) => ({
  price: r.price.toString(),
  publishTimeMs: r.publishTimeMs.toString(),
  status: r.status,
  sigs: r.sigs,
});

export const reportFromJson = (j: ReturnType<typeof reportToJson>): SignedReport => ({
  price: BigInt(j.price),
  publishTimeMs: BigInt(j.publishTimeMs),
  status: j.status,
  sigs: j.sigs,
});
