/**
 * Passkey (WebAuthn P-256) accounts for the OrderGateway — contracts/src/access/OrderGateway.sol and
 * contracts/src/libraries/WebAuthn.sol.
 *
 *   // register: navigator.credentials.create(...) → the public key → the account address
 *   const { qx, qy } = spkiToP256(new Uint8Array(cred.response.getPublicKey()));   // or publicKeyFromAttestation
 *   const account = passkeyAccount(qx, qy);                                         // OrderGateway.passkeyAccount
 *   // sign: the EIP-712 digest is the WebAuthn challenge
 *   const a = await navigator.credentials.get({ publicKey: { challenge: challengeFromDigest(digest), ... } });
 *   const sig = passkeySignatureFromWebAuthn(a.response);                           // gateway.ts
 *
 * A passkey account has no private key: fund it only with `UnisonExchange.depositFor`.
 */
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
import { encodeAbiParameters, getAddress, hexToBytes, keccak256, toHex, type Address, type Hex } from "viem";
import type { WebAuthnResult } from "./gateway.ts";

/** A P-256 public key as the gateway stores it (two bytes32 words). */
export interface P256PublicKey {
  qx: Hex;
  qy: Hex;
}

/** Bytes as WebAuthn hands them out (ArrayBuffer), as a view, or as hex. */
export type BytesLike = Uint8Array | ArrayBufferLike | ArrayBufferView | Hex;

const P256_N = p256.CURVE.n;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

function bytes(b: BytesLike): Uint8Array {
  if (typeof b === "string") return hexToBytes(b);
  if (b instanceof Uint8Array) return b;
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return new Uint8Array(b);
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function word(v: Hex | bigint | Uint8Array): Hex {
  if (typeof v === "bigint") return toHex(v, { size: 32 });
  const b = typeof v === "string" ? hexToBytes(v) : v;
  if (b.length !== 32) throw new Error("passkey: a coordinate must be 32 bytes");
  return toHex(b);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function keyOf(point: Uint8Array): P256PublicKey {
  const p = p256.ProjectivePoint.fromHex(point); // validates: on the curve, not infinity
  const { x, y } = p.toAffine();
  return { qx: toHex(x, { size: 32 }), qy: toHex(y, { size: 32 }) };
}

/** `OrderGateway.passkeyAccount(qx, qy)`: address(uint160(uint256(keccak256(abi.encode("unison.passkey", qx, qy))))). */
export function passkeyAccount(qx: Hex | bigint | Uint8Array, qy: Hex | bigint | Uint8Array): Address {
  const h = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "bytes32" }],
      ["unison.passkey", word(qx), word(qy)],
    ),
  );
  return getAddress(`0x${h.slice(26)}`);
}

// ------------------------------------------------------------------ public keys

const OID_EC_PUBLIC_KEY = "2a8648ce3d0201"; // 1.2.840.10045.2.1
const OID_PRIME256V1 = "2a8648ce3d030107"; // 1.2.840.10045.3.1.7

/** One DER TLV at `pos`: [tag, contentStart, contentEnd]. */
function der(buf: Uint8Array, pos: number, expectTag: number): [number, number] {
  if (buf[pos] !== expectTag) throw new Error(`passkey: DER tag 0x${expectTag.toString(16)} expected`);
  let len = buf[pos + 1];
  if (len === undefined) throw new Error("passkey: truncated DER");
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 2) throw new Error("passkey: unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[p++]!;
  }
  if (p + len > buf.length) throw new Error("passkey: truncated DER");
  return [p, p + len];
}

/** The P-256 key of a SubjectPublicKeyInfo — what `AuthenticatorAttestationResponse.getPublicKey()` returns. */
export function spkiToP256(spki: BytesLike): P256PublicKey {
  const b = bytes(spki);
  const [s0] = der(b, 0, 0x30);
  const [a0, a1] = der(b, s0, 0x30); // AlgorithmIdentifier
  const [o0, o1] = der(b, a0, 0x06);
  const [c0, c1] = der(b, o1, 0x06);
  if (toHex(b.subarray(o0, o1)).slice(2) !== OID_EC_PUBLIC_KEY || toHex(b.subarray(c0, c1)).slice(2) !== OID_PRIME256V1) {
    throw new Error("passkey: not a P-256 (ES256) public key");
  }
  const [k0, k1] = der(b, a1, 0x03); // BIT STRING
  if (b[k0] !== 0) throw new Error("passkey: unexpected BIT STRING padding");
  return keyOf(b.subarray(k0 + 1, k1));
}

type Cbor = number | bigint | string | boolean | null | undefined | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

/** A minimal CBOR decoder (definite lengths; ints, byte/text strings, arrays, maps, tags, simple values). */
function cbor(buf: Uint8Array, pos: number): [Cbor, number] {
  const ib = buf[pos];
  if (ib === undefined) throw new Error("passkey: truncated CBOR");
  const major = ib >> 5;
  const ai = ib & 0x1f;
  let p = pos + 1;
  let n: bigint;
  if (ai < 24) n = BigInt(ai);
  else if (ai <= 27) {
    const len = 1 << (ai - 24);
    if (p + len > buf.length) throw new Error("passkey: truncated CBOR");
    n = 0n;
    for (let i = 0; i < len; i++) n = (n << 8n) | BigInt(buf[p++]!);
  } else throw new Error("passkey: unsupported CBOR (indefinite length or reserved)");
  const int = (v: bigint): number | bigint => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);
  switch (major) {
    case 0:
      return [int(n), p];
    case 1:
      return [typeof int(n) === "number" ? -1 - Number(n) : -1n - n, p];
    case 2:
    case 3: {
      const end = p + Number(n);
      if (end > buf.length) throw new Error("passkey: truncated CBOR");
      const s = buf.subarray(p, end);
      return [major === 2 ? s : new TextDecoder().decode(s), end];
    }
    case 4: {
      const out: Cbor[] = [];
      for (let i = 0n; i < n; i++) {
        const [v, q] = cbor(buf, p);
        out.push(v);
        p = q;
      }
      return [out, p];
    }
    case 5: {
      const out = new Map<Cbor, Cbor>();
      for (let i = 0n; i < n; i++) {
        const [k, q] = cbor(buf, p);
        const [v, r] = cbor(buf, q);
        out.set(k, v);
        p = r;
      }
      return [out, p];
    }
    case 6:
      return cbor(buf, p); // tag: the tagged value
    default:
      if (n === 20n) return [false, p];
      if (n === 21n) return [true, p];
      if (n === 22n) return [null, p];
      if (n === 23n) return [undefined, p];
      throw new Error("passkey: unsupported CBOR simple value");
  }
}

function coseToKey(m: Cbor): P256PublicKey {
  if (!(m instanceof Map)) throw new Error("passkey: COSE key must be a map");
  if (m.get(1) !== 2) throw new Error("passkey: COSE key is not EC2");
  const crv = m.get(-1);
  if (crv !== undefined && crv !== 1) throw new Error("passkey: COSE key is not on P-256");
  const x = m.get(-2);
  const y = m.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
    throw new Error("passkey: COSE key without 32-byte x / y");
  }
  return keyOf(concat(new Uint8Array([4]), x, y));
}

/** The P-256 key of a COSE_Key (EC2: -2 = x, -3 = y) — for authenticators/browsers without `getPublicKey()`. */
export function cosePublicKeyToP256(cose: BytesLike): P256PublicKey {
  return coseToKey(cbor(bytes(cose), 0)[0]);
}

/** The credential and its P-256 key from an attestation object (`navigator.credentials.create`). */
export function publicKeyFromAttestation(attestationObject: BytesLike): P256PublicKey & { credentialId: Hex } {
  const att = cbor(bytes(attestationObject), 0)[0];
  const authData = att instanceof Map ? att.get("authData") : undefined;
  if (!(authData instanceof Uint8Array)) throw new Error("passkey: attestation object without authData");
  if (authData.length < 55 || (authData[32]! & FLAG_AT) === 0) {
    throw new Error("passkey: authenticator data carries no attested credential");
  }
  const idLen = (authData[53]! << 8) | authData[54]!;
  const idEnd = 55 + idLen;
  if (idEnd > authData.length) throw new Error("passkey: truncated credential id");
  const [cose] = cbor(authData, idEnd); // extensions may follow the key
  return { ...coseToKey(cose), credentialId: toHex(authData.subarray(55, idEnd)) };
}

// ------------------------------------------------------------------ assertions

/** RFC 4648 base64url without padding (what WebAuthn puts in clientDataJSON, and OZ `Base64.encodeURL`). */
export function base64UrlEncode(b: BytesLike): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const u = bytes(b);
  let out = "";
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    out += a[(n >> 18) & 63]! + a[(n >> 12) & 63]!;
    if (i + 1 < u.length) out += a[(n >> 6) & 63]!;
    if (i + 2 < u.length) out += a[n & 63]!;
  }
  return out;
}

/** The WebAuthn challenge for a gateway digest: the digest's 32 bytes (the gateway expects b64url(digest)). */
export function challengeFromDigest(digest: Hex): Uint8Array<ArrayBuffer> {
  const b = hexToBytes(digest);
  if (b.length !== 32) throw new Error("passkey: the digest must be 32 bytes");
  return new Uint8Array(b);
}

const clientBytes = (c: string | BytesLike): Uint8Array =>
  typeof c === "string" && !c.startsWith("0x") ? utf8(c) : bytes(c as BytesLike);

/** The signed message: sha256(authenticatorData ‖ sha256(clientDataJSON)). */
export function assertionMessageHash(authenticatorData: BytesLike, clientDataJSON: string | BytesLike): Hex {
  return toHex(sha256(concat(bytes(authenticatorData), sha256(clientBytes(clientDataJSON)))));
}

export interface PasskeyAssertion {
  authenticatorData: BytesLike;
  /** the JSON text, or its bytes as the browser returns them */
  clientDataJSON: string | BytesLike;
}

export interface PasskeyCandidate extends P256PublicKey {
  account: Address;
}

/**
 * Both public keys an assertion's signature is valid for (recovery bits 0 and 1) and their accounts. Logging back
 * in without the stored key: the registered one (`OrderGateway.passkeys(account)`) is the user's.
 */
export function recoverPasskeyCandidates(a: PasskeyAssertion & { signatureDer: BytesLike }): PasskeyCandidate[] {
  const msg = hexToBytes(assertionMessageHash(a.authenticatorData, a.clientDataJSON));
  const sig = p256.Signature.fromDER(bytes(a.signatureDer));
  const out: PasskeyCandidate[] = [];
  for (const bit of [0, 1]) {
    try {
      const k = keyOf(sig.addRecoveryBit(bit).recoverPublicKey(msg).toRawBytes(false));
      out.push({ ...k, account: passkeyAccount(k.qx, k.qy) });
    } catch {
      /* no point for this recovery bit */
    }
  }
  return out;
}

const isRS = (x: unknown): x is { r: bigint; s: bigint } =>
  typeof x === "object" && x !== null && typeof (x as { r?: unknown }).r === "bigint";

/**
 * Off-chain `WebAuthn.verify(abi.encodePacked(digest), requireUV, assertion, qx, qy)` for the assertion
 * `encodePasskeyAssertion` would submit: `"type":"webauthn.get"` and `"challenge":"<b64url(digest)>"` at the
 * indices it computes, User Present (and User Verified unless `requireUV: false`), a valid P-256 signature over
 * sha256(authenticatorData ‖ sha256(clientDataJSON)) with s normalized to low-s as the encoder does.
 */
export function verifyPasskeyAssertion(
  a: PasskeyAssertion & {
    /** DER (what WebAuthn returns) or the decoded r, s */
    signature: BytesLike | { r: bigint; s: bigint };
    qx: Hex | bigint | Uint8Array;
    qy: Hex | bigint | Uint8Array;
    digest: Hex;
    requireUV?: boolean;
  },
): boolean {
  try {
    const cd = clientBytes(a.clientDataJSON);
    const text = new TextDecoder().decode(cd);
    const at = (i: number, s: string) => {
      const want = utf8(s);
      if (i < 0 || i + want.length > cd.length) return false;
      for (let k = 0; k < want.length; k++) if (cd[i + k] !== want[k]) return false;
      return true;
    };
    const typeTag = '"type":"webauthn.get"';
    if (!at(text.indexOf(typeTag), typeTag)) return false;
    const challenge = `"challenge":"${base64UrlEncode(challengeFromDigest(a.digest))}"`;
    if (!at(text.indexOf('"challenge":"'), challenge)) return false;
    const ad = bytes(a.authenticatorData);
    if (ad.length < 37) return false;
    const flags = ad[32]!;
    if ((flags & FLAG_UP) === 0) return false;
    if ((a.requireUV ?? true) && (flags & FLAG_UV) === 0) return false;
    const sig = isRS(a.signature)
      ? new p256.Signature(a.signature.r, a.signature.s)
      : p256.Signature.fromDER(bytes(a.signature));
    const low = sig.s > P256_N / 2n ? new p256.Signature(sig.r, P256_N - sig.s) : sig;
    const pub = concat(new Uint8Array([4]), hexToBytes(word(a.qx)), hexToBytes(word(a.qy)));
    const msg = hexToBytes(assertionMessageHash(ad, cd));
    return p256.verify(low, msg, pub, { lowS: true, prehash: false });
  } catch {
    return false;
  }
}

/** An `AuthenticatorAssertionResponse` (or anything shaped like it, e.g. from a WebAuthn library). */
export interface AssertionResponseLike {
  authenticatorData: BytesLike;
  clientDataJSON: BytesLike;
  /** DER-encoded ECDSA signature */
  signature: BytesLike;
}

/** `navigator.credentials.get(...).response` → the `WebAuthnResult` `encodePasskeyAssertion` takes. */
export function webauthnAssertionToResult(response: AssertionResponseLike): WebAuthnResult {
  const sig = p256.Signature.fromDER(bytes(response.signature));
  return {
    authenticatorData: new Uint8Array(bytes(response.authenticatorData)),
    clientDataJSON: new TextDecoder().decode(bytes(response.clientDataJSON)),
    r: sig.r,
    s: sig.s,
  };
}
