import type { Address, Hex } from "viem";

/** Reference-market session status (IReferenceAdapter.Status). */
export const Status = { OPEN: 0, EXTENDED: 1, CLOSED: 2, HALTED: 3 } as const;
export type StatusCode = (typeof Status)[keyof typeof Status];
export const statusName = (s: number): keyof typeof Status =>
  (["OPEN", "EXTENDED", "CLOSED", "HALTED"] as const)[s] ?? "HALTED";

/** Trading regime implied by the status (SPEC §6). */
export type Regime = "LIVE" | "EXTENDED" | "DISCOVERY" | "REOPENING" | "HALTED";

export const Side = { BID: 0, ASK: 1 } as const;
export type SideCode = (typeof Side)[keyof typeof Side];

export const JobPhase = { IDLE: 0, MERGE: 1, APPLY: 2, CLOSE_IOC: 3 } as const;

export interface MarketState {
  base: Address;
  quote: Address;
  refAdapter: Address;
  baseIdx: number;
  quoteIdx: number;
  shards: number;
  active: boolean;
  permissioned: boolean;
  strictAfterClose: boolean;
  bandBps: number;
  feeBps: number;
  maxFeeBps: number;
  minTick: number;
  maxTick: number;
  maxBandTicks: number;
  baseUnit: bigint;
  tickSize: bigint;
  lastCleared: bigint;
  pendingHead: bigint;
  pendingTail: bigint;
  auctions: bigint;
  lastPrintTick: bigint;
  lastRefTimeMs: bigint;
  lastStatus: number;
  lastRefPrice: bigint;
  receiptHash: Hex;
}

export interface RegimeState {
  extBandBps: number;
  reopenBandBps: number;
  discFloorBps: number;
  discCapBps: number;
  discHorizonSec: number;
  discCadence: number;
  halted: boolean;
  closedSince: bigint;
  lastDiscoveryBatch: bigint;
}

export interface OrderRecord {
  qty: bigint;
  tick: bigint;
  market: bigint;
  side: bigint;
  shard: bigint;
  flags: bigint;
  state: bigint;
  batch: bigint;
  feeBps: bigint;
  maxFeeBps: bigint;
  credited: bigint;
}

export interface OrderPreview {
  merged: boolean;
  filled: bigint;
  remainder: bigint;
  quote: bigint;
  closed: boolean;
}

export interface MarketDeployment {
  symbol: string;
  id: number;
  base: Address;
  quote: Address;
  vault?: Address;
  reference: "operator" | "chainlink" | "pyth" | "manual";
  seedPrice?: number;
}

/** Token metadata in a deployment document. */
export interface DeploymentToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

/** Shape of deployments/<chainId>.json (written by contracts/script). */
export interface Deployment {
  chainId: number;
  /** e.g. "monad-testnet" */
  label?: string;
  /** block the deployment script started at: indexers start here */
  startBlock?: number;
  /** token metadata keyed by symbol */
  tokens?: Record<string, DeploymentToken>;
  exchange: Address;
  operatorReference?: Address;
  gateway?: Address;
  chainlinkReference?: Address;
  pythReference?: Address;
  markets: Record<string, MarketDeployment>;
  accounts?: Record<string, Address>;
  [token: string]: unknown;
}
