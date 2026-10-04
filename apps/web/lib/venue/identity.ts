"use client";

import type { Address, Hex } from "viem";
import { createStore } from "../store/createStore.ts";
import type { NetConfig } from "./config.ts";

/**
 * Who is trading. A passkey account (Face ID, Touch ID, Windows Hello) has no private key: its address commits to
 * the P-256 public key (OrderGateway.passkeyAccount), so it is funded with depositFor and acts only through signed
 * gateway messages. A trading session is a browser key the passkey grants once, with caps, that can never withdraw.
 *
 * This module is only the state, so every page can know who is signed in for free. The signing itself lives in
 * `signer.ts` and loads on demand: the exports below forward to it.
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

export function remember(id: PasskeyIdentity) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* private mode: this tab only */
  }
  identity.set(id);
}

export function keepSession(s: TradingSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* this page only */
  }
  session.set(s);
}

export function forgetSession() {
  session.set(null);
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing kept */
  }
}

export function signOut() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* nothing stored */
  }
  identity.set(null);
  forgetSession();
}

type Signer = typeof import("./signer.ts");
let signer: Promise<Signer> | null = null;
/** The signing code (viem, the curves, the ABIs). Loading twice is free; a failed load is retried next time. */
export function loadSigner(): Promise<Signer> {
  signer ??= import("./signer.ts").catch((e: unknown) => {
    signer = null;
    throw e;
  });
  return signer;
}

/**
 * Starts loading the signer when a signature is near (a sign-in sheet opens, a signed-in trader lands on a
 * ticket), so a Face ID prompt never waits on the network and keeps its user activation.
 */
export function warmSigner() {
  loadSigner().catch(() => undefined);
}

export const createPasskey: Signer["createPasskey"] = async (...a) => (await loadSigner()).createPasskey(...a);
export const signInWithPasskey: Signer["signInWithPasskey"] = async (...a) => (await loadSigner()).signInWithPasskey(...a);
export const startSession: Signer["startSession"] = async (...a) => (await loadSigner()).startSession(...a);
export const withdrawFunds: Signer["withdrawFunds"] = async (...a) => (await loadSigner()).withdrawFunds(...a);
export const grantAgentKey: Signer["grantAgentKey"] = async (...a) => (await loadSigner()).grantAgentKey(...a);
export const revokeKey: Signer["revokeKey"] = async (...a) => (await loadSigner()).revokeKey(...a);
/** The venue's reason for a failure, in words (loads the decoder and the ABIs it reads reverts with). */
export const describeError = async (e: unknown) => (await loadSigner()).describeError(e);
