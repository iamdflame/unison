import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, concat, decodeAbiParameters, hexToBytes, keccak256, toBytes, toHex, type Hex } from "viem";
import {
  assertionMessageHash,
  base64UrlEncode,
  challengeFromDigest,
  cosePublicKeyToP256,
  passkeyAccount,
  publicKeyFromAttestation,
  recoverPasskeyCandidates,
  spkiToP256,
  verifyPasskeyAssertion,
  webauthnAssertionToResult,
} from "../src/passkey.ts";
import { encodePasskeyAssertion, passkeySignatureFromWebAuthn } from "../src/gateway.ts";

const N = p256.CURVE.n;

/**
 * Known vector shared with contracts/test/unit/PasskeyVector.t.sol: the P-256 key 0xBEEF (the gateway tests' passkey),
 * its gateway account, and the SDK's encoding of a deterministic (RFC 6979) assertion over DIGEST, which the
 * Solidity test feeds to WebAuthn.verify.
 */
const VECTOR = {
  qx: "0xf7631cc34b56c24b1758ae6867b23811c129c035fa67cc2a40c617bedb3c4b51",
  qy: "0xdb6bdf29e488c62b18e938e5fb42eed65fa74ea4f3d53ebd35cf9b385374d042",
  account: "0xD897a1ef65F292eA356dee820C7A4B419331Fd02",
  digest: keccak256(toBytes("unison.sdk.passkey-vector")),
  encoded: ("0x" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "0000000000000000000000000000000000000000000000000000000000000200" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "00000000000000000000000000000000000000000000000000000000000000c0" +
    "0000000000000000000000000000000000000000000000000000000000000120" +
    "0000000000000000000000000000000000000000000000000000000000000017" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "cbe3967c8b999c0950cc6997e969a09139f61748f2c037b776eb8466793e9d15" +
    "0a5d6763e5554fe91de52334cca052a95c0b0140878b3c0247ea9a74258a989e" +
    "0000000000000000000000000000000000000000000000000000000000000025" +
    "48627082047d5a725f5f8d7866d7ecb9ad098f0d6d3ad46919bb964855e38c58" +
    "0500000001000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000085" +
    "7b2274797065223a22776562617574686e2e676574222c226368616c6c656e67" +
    "65223a2262583336686f555f554e36494d5569354c565662665f376e69456e34" +
    "46546b4672746b3063682d724e4e51222c226f726967696e223a226874747073" +
    "3a2f2f756e69736f6e2e7472616465222c2263726f73734f726967696e223a66" +
    "616c73657d000000000000000000000000000000000000000000000000000000") as Hex,
} as const;

/** authenticatorData and clientDataJSON exactly as OrderGateway.t.sol `_sigPasskey` builds them. */
function assertion(digest: Hex, flags = 0x05) {
  const authenticatorData = concat([toHex(sha256(toBytes("unison.trade"))), toHex(flags, { size: 1 }), "0x00000001"]);
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${base64UrlEncode(challengeFromDigest(digest))}","origin":"https://unison.trade","crossOrigin":false}`;
  return { authenticatorData, clientDataJSON };
}

/** An authenticator: signs sha256(authData ‖ sha256(clientDataJSON)) and returns the DER signature, like WebAuthn. */
function sign(priv: Uint8Array, a: { authenticatorData: Hex; clientDataJSON: string }) {
  const h = sha256(concat([hexToBytes(a.authenticatorData), sha256(toBytes(a.clientDataJSON))]));
  return p256.sign(h, priv);
}

const keyOf = (priv: Uint8Array) => {
  const pub = p256.getPublicKey(priv, false);
  return { qx: toHex(pub.slice(1, 33)), qy: toHex(pub.slice(33)) };
};

describe("passkey accounts", () => {
  it("derives OrderGateway.passkeyAccount (vector shared with the Solidity tests)", () => {
    const k = keyOf(toBytes(0xbeefn, { size: 32 }));
    expect(k).toEqual({ qx: VECTOR.qx, qy: VECTOR.qy });
    expect(passkeyAccount(k.qx, k.qy)).toBe(VECTOR.account);
    expect(passkeyAccount(BigInt(k.qx), hexToBytes(k.qy))).toBe(VECTOR.account);
    expect(() => passkeyAccount("0x01", k.qy)).toThrow();
  });

  it("reads the key from SPKI, COSE and a whole attestation object", () => {
    const priv = p256.utils.randomPrivateKey();
    const k = keyOf(priv);
    const point = p256.getPublicKey(priv, false);
    const spki = concat(["0x3059301306072a8648ce3d020106082a8648ce3d030107034200", toHex(point)]);
    expect(spkiToP256(spki)).toEqual(k);
    expect(spkiToP256(hexToBytes(spki).buffer)).toEqual(k);
    // a secp256k1 key is refused
    expect(() => spkiToP256(spki.replace("2a8648ce3d030107", "2b8104000a0000") as Hex)).toThrow();

    // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    const cose = concat(["0xa5010203262001215820", toHex(point.slice(1, 33)), "0x225820", toHex(point.slice(33))]);
    expect(cosePublicKeyToP256(cose)).toEqual(k);

    // attestation object {"fmt": "none", "attStmt": {}, "authData": rpIdHash | flags (UP|UV|AT) | count | aaguid |
    // credIdLen | credId | COSE key}
    const credId = toHex(p256.utils.randomPrivateKey().slice(0, 16));
    const authData = concat([
      toHex(sha256(toBytes("unison.trade"))),
      "0x45",
      "0x00000000",
      toHex(new Uint8Array(16)),
      "0x0010",
      credId,
      cose,
    ]);
    const len = hexToBytes(authData).length;
    const att = concat([
      "0xa3",
      "0x63",
      toHex(toBytes("fmt")),
      "0x64",
      toHex(toBytes("none")),
      "0x67",
      toHex(toBytes("attStmt")),
      "0xa0",
      "0x68",
      toHex(toBytes("authData")),
      "0x59",
      toHex(len, { size: 2 }),
      authData,
    ]);
    expect(publicKeyFromAttestation(att)).toEqual({ ...k, credentialId: credId });
  });
});

describe("assertions", () => {
  it("challenge = the digest's bytes; base64url without padding", () => {
    for (let i = 0; i < 50; i++) {
      const b = p256.utils.randomPrivateKey().slice(0, i % 33);
      expect(base64UrlEncode(b)).toBe(Buffer.from(b).toString("base64url"));
    }
    const d = keccak256("0x1234");
    expect(bytesToHex(challengeFromDigest(d))).toBe(d);
    expect(() => challengeFromDigest("0x1234")).toThrow();
  });

  it("recovery and verification agree on signatures made in the test", () => {
    for (let i = 0; i < 25; i++) {
      const priv = p256.utils.randomPrivateKey();
      const k = keyOf(priv);
      const digest = keccak256(toBytes(`order ${i}`));
      const a = assertion(digest);
      const sig = sign(priv, a);
      const h = sha256(concat([hexToBytes(a.authenticatorData), sha256(toBytes(a.clientDataJSON))]));
      expect(assertionMessageHash(a.authenticatorData, a.clientDataJSON)).toBe(toHex(h));

      const candidates = recoverPasskeyCandidates({ ...a, signatureDer: sig.toDERRawBytes() });
      expect(candidates).toHaveLength(2);
      const mine = candidates.find((c) => c.qx === k.qx && c.qy === k.qy);
      expect(mine?.account).toBe(passkeyAccount(k.qx, k.qy));
      // both recovered keys verify, as ECDSA recovery implies; the signer's key verifies under every input format
      for (const c of candidates) {
        expect(verifyPasskeyAssertion({ ...a, signature: sig.toDERRawBytes(), qx: c.qx, qy: c.qy, digest })).toBe(true);
      }
      expect(verifyPasskeyAssertion({ ...a, signature: { r: sig.r, s: sig.s }, ...k, digest })).toBe(true);
      expect(verifyPasskeyAssertion({ ...a, signature: toHex(sig.toDERRawBytes()), ...k, digest })).toBe(true);
      // a high-s signature is the same assertion once normalized (the gateway only takes low-s)
      const high = sig.s > N / 2n ? sig : new p256.Signature(sig.r, N - sig.s);
      expect(verifyPasskeyAssertion({ ...a, signature: { r: high.r, s: high.s }, ...k, digest })).toBe(true);
      expect(encodePasskeyAssertion({ ...a, r: high.r, s: high.s })).toBe(encodePasskeyAssertion({ ...a, r: sig.r, s: sig.s }));

      // what must fail
      const other = keyOf(p256.utils.randomPrivateKey());
      expect(verifyPasskeyAssertion({ ...a, signature: sig.toDERRawBytes(), ...other, digest })).toBe(false);
      expect(verifyPasskeyAssertion({ ...a, signature: sig.toDERRawBytes(), ...k, digest: keccak256(digest) })).toBe(false);
      const tampered = { ...a, clientDataJSON: a.clientDataJSON.replace("unison.trade", "evil.example") };
      expect(verifyPasskeyAssertion({ ...tampered, signature: sig.toDERRawBytes(), ...k, digest })).toBe(false);
    }
  });

  it("enforces the authenticator flags like WebAuthn.verify (UP always, UV unless requireUV: false)", () => {
    const priv = p256.utils.randomPrivateKey();
    const k = keyOf(priv);
    const digest = keccak256("0xabcd");
    const upOnly = assertion(digest, 0x01);
    const s1 = sign(priv, upOnly).toDERRawBytes();
    expect(verifyPasskeyAssertion({ ...upOnly, signature: s1, ...k, digest })).toBe(false);
    expect(verifyPasskeyAssertion({ ...upOnly, signature: s1, ...k, digest, requireUV: false })).toBe(true);
    const none = assertion(digest, 0x04);
    expect(verifyPasskeyAssertion({ ...none, signature: sign(priv, none).toDERRawBytes(), ...k, digest })).toBe(false);
    const create = { ...assertion(digest), clientDataJSON: assertion(digest).clientDataJSON.replace("get", "create") };
    expect(verifyPasskeyAssertion({ ...create, signature: sign(priv, create).toDERRawBytes(), ...k, digest })).toBe(false);
  });

  it("turns an AuthenticatorAssertionResponse into exactly the bytes the gateway verifies", () => {
    const a = assertion(VECTOR.digest);
    const sig = sign(toBytes(0xbeefn, { size: 32 }), a); // RFC 6979: deterministic
    const response = {
      authenticatorData: hexToBytes(a.authenticatorData).buffer,
      clientDataJSON: toBytes(a.clientDataJSON).buffer,
      signature: sig.toDERRawBytes().buffer,
    };
    const r = webauthnAssertionToResult(response);
    expect([r.r, r.s, r.clientDataJSON]).toEqual([sig.r, sig.s, a.clientDataJSON]);
    expect(encodePasskeyAssertion(r)).toBe(VECTOR.encoded);
    expect(passkeySignatureFromWebAuthn(response)).toBe(VECTOR.encoded);
    // the envelope the gateway decodes: (uint8 kind = SIG_PASSKEY, bytes data = abi.encode(WebAuthn.Assertion))
    const [kind, data] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], VECTOR.encoded);
    expect(kind).toBe(2);
    const [w] = decodeAbiParameters(
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
      data,
    );
    expect([w.challengeIndex, w.typeIndex]).toEqual([23n, 1n]);
    expect(verifyPasskeyAssertion({ ...a, signature: { r: BigInt(w.r), s: BigInt(w.s) }, ...VECTOR, digest: VECTOR.digest })).toBe(true);
  });
});
