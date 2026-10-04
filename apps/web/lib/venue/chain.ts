"use client";

import { UnisonClient } from "@unison/sdk";
import { createPublicClient, http } from "viem";
import type { NetConfig } from "./config.ts";

/**
 * The full contract client (viem), for the reads the light reader doesn't cover: a vault's whole state, for one.
 * Imported on demand, so only the pages that need it pay for it.
 */
let client: { net: NetConfig; chain: UnisonClient } | null = null;
export function chainClient(net: NetConfig): UnisonClient {
  if (!client || client.net !== net) {
    const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
    client = { net, chain: new UnisonClient({ publicClient: publicClient as never, deployment: net.deployment }) };
  }
  return client.chain;
}
