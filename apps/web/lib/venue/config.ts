import { chainById, type Deployment } from "@unison/sdk";
import type { Chain } from "viem";
import { DEPLOYMENTS } from "./deployments.generated.ts";

/**
 * Which venue the app talks to. A build knows up to two networks: its default one (NEXT_PUBLIC_NETWORK or
 * NEXT_PUBLIC_CHAIN_ID, with NEXT_PUBLIC_TAPE_URL and friends) and, beside it, Monad mainnet or the public testnet
 * (NEXT_PUBLIC_MAINNET_* / NEXT_PUBLIC_TESTNET_*). The visitor picks one with the venue switch (`?network=` or
 * the stored choice). Live mode needs a deployment plus a tape and a relayer; without them (or when they don't
 * answer) the app runs the in-browser simulation and says so.
 */
export type Network = "devnet" | "testnet" | "mainnet";

export interface NetConfig {
  network: Network;
  chain: Chain;
  rpcUrl: string;
  wsUrl: string | undefined;
  tapeUrl: string;
  relayerUrl: string;
  /** the reference relay (signed prices), when this network has one: mainnet's prices are Chainlink's, so it doesn't */
  relayUrl: string | undefined;
  deployment: Deployment;
  /** the relayer drips test funds */
  faucet: boolean;
  explorer: string | undefined;
}

interface NetEnv {
  tape: string | undefined;
  relayer: string | undefined;
  relay: string | undefined;
  rpc: string | undefined;
  ws: string | undefined;
}

const BY_CHAIN: Record<string, Network> = { "31337": "devnet", "10143": "testnet", "143": "mainnet" };
export const NETWORK_KEY = "unison.network";

/** The build's own network, named by NEXT_PUBLIC_NETWORK or NEXT_PUBLIC_CHAIN_ID. */
export const defaultNetwork = (): Network | undefined =>
  (process.env.NEXT_PUBLIC_NETWORK as Network | undefined) ?? BY_CHAIN[process.env.NEXT_PUBLIC_CHAIN_ID ?? ""];

// Every variable is named in full: the client bundle only carries NEXT_PUBLIC_* values it sees written out.
const DEFAULT_ENV: NetEnv = {
  tape: process.env.NEXT_PUBLIC_TAPE_URL,
  relayer: process.env.NEXT_PUBLIC_RELAYER_URL,
  relay: process.env.NEXT_PUBLIC_RELAY_URL,
  rpc: process.env.NEXT_PUBLIC_RPC_URL,
  ws: process.env.NEXT_PUBLIC_RPC_WS_URL,
};
const NAMED_ENV: Partial<Record<Network, NetEnv>> = {
  mainnet: {
    tape: process.env.NEXT_PUBLIC_MAINNET_TAPE_URL,
    relayer: process.env.NEXT_PUBLIC_MAINNET_RELAYER_URL,
    relay: undefined,
    rpc: process.env.NEXT_PUBLIC_MAINNET_RPC_URL,
    ws: process.env.NEXT_PUBLIC_MAINNET_RPC_WS_URL,
  },
  testnet: {
    tape: process.env.NEXT_PUBLIC_TESTNET_TAPE_URL,
    relayer: process.env.NEXT_PUBLIC_TESTNET_RELAYER_URL,
    relay: process.env.NEXT_PUBLIC_TESTNET_RELAY_URL,
    rpc: process.env.NEXT_PUBLIC_TESTNET_RPC_URL,
    ws: process.env.NEXT_PUBLIC_TESTNET_RPC_WS_URL,
  },
};

const envFor = (network: Network): NetEnv | undefined => {
  const named = NAMED_ENV[network];
  if (named?.tape && named.relayer) return named;
  return network === defaultNetwork() ? DEFAULT_ENV : undefined;
};

/** The networks this build can trade on, the default first. */
export function networks(): Network[] {
  const d = defaultNetwork();
  const all: Network[] = ["mainnet", "testnet", "devnet"];
  return (d ? [d, ...all.filter((n) => n !== d)] : all).filter((n) => {
    const e = envFor(n);
    return !!(DEPLOYMENTS[n] && e?.tape && e.relayer);
  });
}

/** The network the visitor chose (a `?network=` link, then the stored choice), if this build has it; else the default. */
export function selectedNetwork(): Network | undefined {
  const have = networks();
  let pick: string | null = null;
  try {
    const linked = new URLSearchParams(globalThis.location?.search ?? "").get("network");
    // a shared link (…?network=mainnet) is a choice too: it sticks for the next page
    if (linked && have.some((n) => n === linked)) globalThis.localStorage?.setItem(NETWORK_KEY, linked);
    pick = linked ?? globalThis.localStorage?.getItem(NETWORK_KEY) ?? null;
  } catch {
    /* storage blocked: the link alone, else the default */
    pick = new URLSearchParams(globalThis.location?.search ?? "").get("network");
  }
  return have.find((n) => n === pick) ?? have[0];
}

/** Switches network: remembered in this browser, and the page reloads onto it (each network is its own venue). */
export function chooseNetwork(n: Network) {
  try {
    localStorage.setItem(NETWORK_KEY, n);
  } catch {
    /* the link below still carries it */
  }
  const u = new URL(location.href);
  u.searchParams.set("network", n);
  location.assign(u.toString());
}

export function netConfig(network: Network | undefined = selectedNetwork()): NetConfig | null {
  if (!network) return null;
  const deployment = DEPLOYMENTS[network];
  const e = envFor(network);
  if (!deployment || !e?.tape || !e.relayer) return null;
  const chain = chainById(deployment.chainId);
  return {
    network,
    chain,
    rpcUrl: e.rpc ?? chain.rpcUrls.default.http[0]!,
    wsUrl: e.ws ?? chain.rpcUrls.default.webSocket?.[0],
    tapeUrl: e.tape,
    relayerUrl: e.relayer,
    relayUrl: e.relay,
    deployment,
    faucet: network !== "mainnet" && process.env.NEXT_PUBLIC_FAUCET !== "0",
    explorer: chain.blockExplorers?.default.url,
  };
}

/** How a network is named to people. */
export const networkName = (n: Network) => (n === "mainnet" ? "Monad mainnet" : n === "testnet" ? "Monad testnet" : "Local devnet");
