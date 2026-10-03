import { defineChain, type Chain } from "viem";
import type { Deployment } from "./types.ts";

/** Monad mainnet (chain 143). */
export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"], webSocket: ["wss://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

/** Monad testnet (chain 10143). */
export const monadTestnet = defineChain({
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  testnet: true,
});

/** Local anvil devnet (contracts/script/DevNet.s.sol). */
export const devnet = defineChain({
  id: 31_337,
  name: "Unison Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const chainById = (id: number): Chain => {
  const c = [monad, monadTestnet, devnet].find((x) => x.id === id);
  if (!c) throw new Error(`unknown chain ${id}`);
  return c;
};

/** Validates a deployments/<chainId>.json document. */
export function parseDeployment(json: unknown): Deployment {
  const d = json as Deployment;
  if (typeof d !== "object" || d === null || typeof d.exchange !== "string" || typeof d.markets !== "object") {
    throw new Error("invalid deployment document");
  }
  return d;
}

/** Node-only helper: loads deployments/<chainId>.json from a repo checkout. */
export async function loadDeploymentFile(path: string): Promise<Deployment> {
  const { readFile } = await import("node:fs/promises");
  return parseDeployment(JSON.parse(await readFile(path, "utf8")));
}
