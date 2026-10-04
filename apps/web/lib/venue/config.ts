import { chainById, type Deployment } from "@unison/sdk";
import type { Chain } from "viem";
import { DEPLOYMENTS } from "./deployments.generated.ts";

/**
 * Which venue this build talks to. Live mode needs a deployment plus a tape and a relayer; without them (or when
 * they don't answer) the app runs the in-browser simulation and says so.
 */
export type Network = "devnet" | "testnet" | "mainnet";

export interface NetConfig {
  network: Network;
  chain: Chain;
  rpcUrl: string;
  wsUrl: string | undefined;
  tapeUrl: string;
  relayerUrl: string;
  deployment: Deployment;
  /** the relayer drips test funds */
  faucet: boolean;
  explorer: string | undefined;
}

const BY_CHAIN: Record<string, Network> = { "31337": "devnet", "10143": "testnet", "143": "mainnet" };

export function netConfig(): NetConfig | null {
  const network = (process.env.NEXT_PUBLIC_NETWORK as Network | undefined) ?? BY_CHAIN[process.env.NEXT_PUBLIC_CHAIN_ID ?? ""];
  if (!network) return null;
  const deployment = DEPLOYMENTS[network];
  const tapeUrl = process.env.NEXT_PUBLIC_TAPE_URL;
  const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL;
  if (!deployment || !tapeUrl || !relayerUrl) return null;
  const chain = chainById(deployment.chainId);
  return {
    network,
    chain,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? chain.rpcUrls.default.http[0]!,
    wsUrl: process.env.NEXT_PUBLIC_RPC_WS_URL ?? chain.rpcUrls.default.webSocket?.[0],
    tapeUrl,
    relayerUrl,
    deployment,
    faucet: network !== "mainnet" && process.env.NEXT_PUBLIC_FAUCET !== "0",
    explorer: chain.blockExplorers?.default.url,
  };
}
