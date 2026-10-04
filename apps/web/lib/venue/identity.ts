"use client";

import {
  base64UrlEncode,
  buildSession,
  buildWithdraw,
  challengeFromDigest,
  gatewayDigest,
  passkeyAccount,
  passkeySignatureFromWebAuthn,
  publicKeyFromAttestation,
  recoverPasskeyCandidates,
  RelayerClient,
  signAsSession,
  spkiToP256,
  TapeClient,
  type GatewayCancel,
  type GatewayOrder,
} from "@unison/sdk";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createStore } from "../store/createStore.ts";
import type { NetConfig } from "./config.ts";

/**
 * Who is trading. A passkey account (Face ID, Touch ID, Windows Hello) has no private key: its address commits to
 * the P-256 public key (OrderGateway.passkeyAccount), so it is funded with depositFor and acts only through signed
 * gateway messages. A trading session is a browser key the passkey grants once, with caps, that can never withdraw.
 */
export interface PasskeyIdentity {
  kind: "passkey";
  network: string;
  credentialId: string; // base64url
  qx: Hex;
  qy: Hex;
  account: Address;
}

export interface TradingSession {
  account: Address;
  key: Hex; // private key, kept for this tab only
  address: Address;
  expiry: number; // unix seconds
}

const IDENTITY_KEY = "unison.identity";
const SESSION_KEY = "unison.session";

const load = <T>(storage: Storage | undefined, key: string): T | null => {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const identity = createStore<PasskeyIdentity | null>(null);
export const session = createStore<TradingSession | null>(null);

/** Restores the identity for this network (and this tab's session) after hydration. */
export function restoreIdentity(net: NetConfig) {
  const id = load<PasskeyIdentity>(globalThis.localStorage, IDENTITY_KEY);
  identity.set(id && id.network === net.network ? id : null);
  const s = load<TradingSession>(globalThis.sessionStorage, SESSION_KEY);
  session.set(s && id && s.account === id.account && s.expiry > Date.now() / 1000 + 30 ? s : null);
}

function remember(id: PasskeyIdentity) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* private mode: this tab only */
  }
  identity.set(id);
}

const fromB64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function signOut() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing stored */
  }
  identity.set(null);
  session.set(null);
}

/** Creates a passkey on this device and registers its account through the relayer (gasless, idempotent). */
export async function createPasskey(net: NetConfig, label = "Unison"): Promise<PasskeyIdentity> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Unison", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled.");
  const res = cred.response as AuthenticatorAttestationResponse;
  const spki = typeof res.getPublicKey === "function" ? res.getPublicKey() : null;
  const key = spki ? spkiToP256(new Uint8Array(spki)) : publicKeyFromAttestation(new Uint8Array(res.attestationObject));
  const relayer = new RelayerClient(net.relayerUrl);
  const reg = await relayer.registerPasskey(key.qx, key.qy);
  const id: PasskeyIdentity = {
    kind: "passkey",
    network: net.network,
    credentialId: base64UrlEncode(new Uint8Array(cred.rawId)),
    qx: key.qx,
    qy: key.qy,
    account: reg.account ?? passkeyAccount(key.qx, key.qy),
  };
  remember(id);
  return id;
}

/** Signs in with an existing passkey on a new device: recover its key from one assertion, no backend needed. */
export async function signInWithPasskey(net: NetConfig): Promise<PasskeyIdentity> {
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), userVerification: "required", timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Sign-in was cancelled.");
  const res = cred.response as AuthenticatorAssertionResponse;
  const candidates = recoverPasskeyCandidates({
    authenticatorData: new Uint8Array(res.authenticatorData),
    clientDataJSON: new Uint8Array(res.clientDataJSON),
    signatureDer: new Uint8Array(res.signature),
  });
  const tape = new TapeClient(net.tapeUrl);
  for (const c of candidates) {
    if (await tape.passkey(c.account)) {
      const id: PasskeyIdentity = {
        kind: "passkey",
        network: net.network,
        credentialId: base64UrlEncode(new Uint8Array(cred.rawId)),
        qx: c.qx,
        qy: c.qy,
        account: c.account,
      };
      remember(id);
      return id;
    }
  }
  throw new Error("This passkey has no Unison account on this network yet. Create one instead.");
}

/** One Face ID (or Touch ID, Windows Hello) over a gateway digest. */
export async function signWithPasskey(id: PasskeyIdentity, digest: Hex): Promise<Hex> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeFromDigest(digest),
      allowCredentials: [{ type: "public-key", id: fromB64Url(id.credentialId) }],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Signing was cancelled.");
  return passkeySignatureFromWebAuthn(cred.response as AuthenticatorAssertionResponse);
}

/**
 * Starts a trading session: one passkey signature grants a fresh browser key, for one hour, inside caps (size and
 * notional per order, these markets). The key lives in this tab only and can never withdraw.
 */
export async function startSession(
  net: NetConfig,
  id: PasskeyIdentity,
  caps: { maxQty: bigint; maxNotional: bigint; marketIds: number[]; hours?: number },
): Promise<TradingSession> {
  const pk = generatePrivateKey();
  const key = privateKeyToAccount(pk);
  const grant = buildSession({
    account: id.account,
    key: key.address,
    maxQty: caps.maxQty,
    maxNotional: caps.maxNotional,
    marketIds: caps.marketIds,
    ttlSeconds: Math.round((caps.hours ?? 1) * 3600),
  });
  await postGrant(net, id, grant);
  const s: TradingSession = { account: id.account, key: pk, address: key.address, expiry: Number(grant.expiry) };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* this page only */
  }
  session.set(s);
  return s;
}

/**
 * Withdraws from the venue ledger to a wallet. Only the passkey itself can sign it (one Face ID); a trading
 * session never can. The account address has no key, so sending to it would lose the tokens: refused here.
 */
export async function withdrawFunds(net: NetConfig, id: PasskeyIdentity, token: Address, amount: bigint, to: Address): Promise<void> {
  if (to.toLowerCase() === id.account.toLowerCase()) {
    throw new Error("Send it to a wallet you control. Your Unison account address has no key, so tokens sent there can't be recovered.");
  }
  const w = buildWithdraw({ account: id.account, token, amount, to });
  const sig = await signWithPasskey(id, gatewayDigest(net.deployment.chainId, net.deployment.gateway as Address, "Withdraw", w as never));
  const relayer = new RelayerClient(net.relayerUrl);
  const { id: job } = await relayer.postWithdraw(w, sig);
  await relayer.waitForJob(job);
}

/** One Face ID over a session grant (or revocation), relayed and mined. */
async function postGrant(net: NetConfig, id: PasskeyIdentity, grant: ReturnType<typeof buildSession>) {
  const gateway = net.deployment.gateway as Address;
  const sig = await signWithPasskey(id, gatewayDigest(net.deployment.chainId, gateway, "Session", grant as never));
  const relayer = new RelayerClient(net.relayerUrl);
  const { id: job } = await relayer.postSession(grant, sig);
  await relayer.waitForJob(job);
}

/**
 * Mints a key for an agent: a fresh key pair made here, granted with one passkey signature, inside caps (markets,
 * size and notional per order, expiry). The private key is returned once and never stored. It can place and
 * cancel orders for this account, and can never withdraw.
 */
export async function grantAgentKey(
  net: NetConfig,
  id: PasskeyIdentity,
  caps: { maxQty: bigint; maxNotional: bigint; marketIds: number[]; ttlSeconds: number },
): Promise<{ privateKey: Hex; address: Address; expiry: number }> {
  const privateKey = generatePrivateKey();
  const key = privateKeyToAccount(privateKey);
  const grant = buildSession({ account: id.account, key: key.address, ...caps });
  await postGrant(net, id, grant);
  return { privateKey, address: key.address, expiry: Number(grant.expiry) };
}

/** Revokes a key at once (a grant with expiry 0). Signed with the passkey. */
export async function revokeKey(net: NetConfig, id: PasskeyIdentity, key: Address): Promise<void> {
  await postGrant(net, id, buildSession({ account: id.account, key, maxQty: 0n, maxNotional: 0n, marketMask: 0n, expiry: 0n }));
  const s = session.get();
  if (s && s.address.toLowerCase() === key.toLowerCase()) {
    session.set(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing kept */
    }
  }
}

/** Signs an order or a cancel: silently with the session key when one is active, otherwise with the passkey. */
export async function signAction(net: NetConfig, id: PasskeyIdentity, primaryType: "Order" | "Cancel", message: GatewayOrder | GatewayCancel): Promise<Hex> {
  const gateway = net.deployment.gateway as Address;
  const s = session.get();
  if (s && s.account === id.account && s.expiry > Date.now() / 1000 + 10) {
    return signAsSession(privateKeyToAccount(s.key), net.deployment.chainId, gateway, message, primaryType);
  }
  return signWithPasskey(id, gatewayDigest(net.deployment.chainId, gateway, primaryType, message as never));
}
