/** Test helpers: synthetic logs from the real ABIs, and an in-memory tape (store + indexer + app, no network). */
import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Hex, type PublicClient } from "viem";
import { orderGatewayAbi, unisonExchangeAbi, type Deployment } from "@unison/sdk";
import { createTapeApp } from "../src/api.ts";
import { SqliteTapeStore } from "../src/db.ts";
import type { RawLog } from "../src/decode.ts";
import { receiptHash, ZERO_HASH } from "../src/derive.ts";
import { Indexer } from "../src/ingest.ts";
import { StreamHub } from "../src/stream.ts";
import type { MarketMeta } from "../src/views.ts";

export const ADDR = {
  exchange: "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
  gateway: "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853",
  reference: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707",
  ausd: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  nvda: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  spy: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
  vault: "0x959922be3caee4b8cd9a407cc3ac1c251c2007b1",
  alice: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  bob: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
} as const;

export const deployment: Deployment = {
  chainId: 31_337,
  exchange: ADDR.exchange,
  gateway: ADDR.gateway,
  operatorReference: ADDR.reference,
  AUSD: ADDR.ausd,
  markets: {
    "aNVDA/AUSD": { symbol: "aNVDA/AUSD", id: 0, base: ADDR.nvda, quote: ADDR.ausd, vault: ADDR.vault, reference: "operator" },
    "aSPY/AUSD": { symbol: "aSPY/AUSD", id: 1, base: ADDR.spy, quote: ADDR.ausd, reference: "operator" },
  },
};

const meta = (id: number, base: string, vault: string | null): MarketMeta => ({
  id,
  symbol: id === 0 ? "aNVDA/AUSD" : "aSPY/AUSD",
  base,
  quote: ADDR.ausd,
  vault,
  reference: "operator",
  tickSize: 10_000n,
  baseUnit: 10n ** 18n,
  maxFeeBps: 10n,
  baseDecimals: 18,
  quoteDecimals: 6,
  lastClearedAtStart: 0,
  statusAtStart: 0,
  haltedAtStart: false,
});

export const MARKETS: MarketMeta[] = [meta(0, ADDR.nvda, ADDR.vault), meta(1, ADDR.spy, null)];

export const txOf = (block: number, logIndex: number): Hex => `0x${(block * 1_000 + logIndex).toString(16).padStart(64, "0")}`;

/** A log of `eventName` as the contract at `address` would emit it. */
export function logOf(
  abi: Abi,
  address: string,
  eventName: string,
  args: Record<string, unknown>,
  at: { block: number; logIndex: number; tx?: Hex; removed?: boolean },
): RawLog {
  const ev = abi.find((x): x is AbiEvent => x.type === "event" && x.name === eventName);
  if (!ev) throw new Error(`no event ${eventName}`);
  const topics = encodeEventTopics({ abi: [ev], eventName, args } as never) as Hex[];
  const data = encodeAbiParameters(
    ev.inputs.filter((i) => !i.indexed),
    ev.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]),
  );
  return {
    address,
    topics,
    data,
    blockNumber: at.block,
    logIndex: at.logIndex,
    transactionHash: at.tx ?? txOf(at.block, at.logIndex),
    ...(at.removed ? { removed: true } : {}),
  };
}

/** Block timestamps (s) for tests: block n is at 1_760_000_000 + n. */
export const T0 = 1_760_000_000;
export const tsMap = (logs: readonly RawLog[], extra: number[] = []) =>
  new Map([...logs.map((l) => l.blockNumber), ...extra].map((b) => [b, T0 + b]));

export function memoryTape(opts: { now?: () => number; rateBurst?: number; keepaliveMs?: number; corsOrigins?: string[]; team?: string[] } = {}) {
  const store = new SqliteTapeStore(":memory:");
  const hub = new StreamHub(opts.now ? { now: opts.now } : {});
  const indexer = new Indexer({
    client: {} as PublicClient, // never called: tests commit logs with their timestamps
    deployment,
    store,
    hub,
    markets: MARKETS,
    log: () => {},
  });
  const app = createTapeApp({
    store,
    state: indexer,
    hub,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.rateBurst ? { rateBurst: opts.rateBurst, ratePerSec: 0.001 } : {}),
    ...(opts.keepaliveMs ? { keepaliveMs: opts.keepaliveMs } : {}),
    ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
    ...(opts.team ? { team: opts.team } : {}),
  });
  return { store, hub, indexer, app };
}

// ---------------------------------------------------------------------------------------------- a small market day

const ex = unisonExchangeAbi as Abi;
const gw = orderGatewayAbi as Abi;
export const E18 = 10n ** 18n;
export const PASSKEY = {
  account: "0x36ad6850ce84bddefb1a1f7232fd7d86adfe54e0",
  qx: `0x${"11".repeat(32)}`,
  qy: `0x${"22".repeat(32)}`,
} as const;
export const SESSION_KEY = "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc";

/** BatchCleared with a correctly chained receipt hash (block timestamps from `tsMap`). */
export function printLog(
  prev: Hex,
  p: { marketId?: number; upTo: number; tick: number; volume: bigint; refPrice: bigint; status?: number; bandLo?: number; bandHi?: number; refTimeMs?: number },
  at: { block: number; logIndex: number; tx?: Hex },
): { log: RawLog; receipt: Hex } {
  const marketId = p.marketId ?? 0;
  const status = p.status ?? 0;
  const refTimeMs = p.refTimeMs ?? (T0 + p.upTo) * 1000 + 400;
  const receipt = receiptHash(
    prev,
    { marketId, upTo: p.upTo, tick: p.tick, volume: p.volume.toString(), refPrice: p.refPrice.toString(), refTimeMs, status },
    T0 + at.block,
  );
  const log = logOf(
    ex,
    ADDR.exchange,
    "BatchCleared",
    {
      marketId: BigInt(marketId),
      upToBlock: BigInt(p.upTo),
      tick: BigInt(p.tick),
      price: BigInt(p.tick) * 10_000n,
      volume: p.volume,
      refPrice: p.refPrice,
      refTimeMs: BigInt(refTimeMs),
      status,
      bandLo: BigInt(p.bandLo ?? (p.tick === 0 ? 17_820 : p.tick - 180)),
      bandHi: BigInt(p.bandHi ?? (p.tick === 0 ? 18_180 : p.tick + 180)),
      receiptHash: receipt,
    },
    at,
  );
  return { log, receipt };
}

/**
 * Alice bids 3 @ 180.00, Bob asks 2 @ 179.70 → one auction prints 2 @ 179.90; Alice claims 2 (still open),
 * Bob is filled and settled; an empty auction follows; Bob places and cancels a pending bid; transfers,
 * a session grant, a passkey and a halt.
 */
export function marketDay(): RawLog[] {
  const placed = (account: string, slot: number, side: number, tick: number, qty: bigint, batch: number, logIndex: number) =>
    logOf(ex, ADDR.exchange, "OrderPlaced", {
      marketId: 0n, account, slot: BigInt(slot), side: BigInt(side), tick: BigInt(tick), qty, flags: 0n, batch: BigInt(batch),
    }, { block: batch, logIndex });
  const claimed = (account: string, slot: number, side: number, base: bigint, quote: bigint, fee: bigint, done: boolean, block: number, logIndex: number) =>
    logOf(ex, ADDR.exchange, "Claimed", {
      marketId: 0n, account, slot: BigInt(slot), side: BigInt(side), baseAmount: base, quoteAmount: quote, fee, done,
    }, { block, logIndex });
  const p1 = printLog(ZERO_HASH, { upTo: 11, tick: 17_990, volume: 2n * E18, refPrice: 179_950_000n }, { block: 12, logIndex: 0 });
  const p2 = printLog(p1.receipt, { upTo: 14, tick: 0, volume: 0n, refPrice: 180_000_000n }, { block: 15, logIndex: 0 });
  return [
    placed(ADDR.alice, 0, 0, 18_000, 3n * E18, 10, 0),
    placed(ADDR.bob, 0, 1, 17_970, 2n * E18, 10, 1),
    p1.log,
    claimed(ADDR.alice, 0, 0, 2n * E18, 0n, 0n, false, 13, 0),
    claimed(ADDR.bob, 0, 1, 0n, 359_692_060n, 107_940n, true, 13, 1),
    p2.log,
    placed(ADDR.bob, 1, 0, 17_000, E18, 20, 0),
    logOf(ex, ADDR.exchange, "OrderCancelled", { marketId: 0n, account: ADDR.bob, slot: 1n, releasedQty: E18 }, { block: 21, logIndex: 0 }),
    logOf(ex, ADDR.exchange, "Deposited", { account: ADDR.alice, token: ADDR.ausd, amount: 1_000_000_000n, payer: ADDR.bob }, { block: 22, logIndex: 0 }),
    logOf(ex, ADDR.exchange, "Withdrawn", { account: ADDR.alice, token: ADDR.ausd, amount: 10_000_000n, to: ADDR.alice }, { block: 22, logIndex: 1 }),
    logOf(gw, ADDR.gateway, "SessionSet", {
      account: ADDR.alice, key: SESSION_KEY, grant: { expiry: 1_900_000_000n, maxQty: 5n * E18, maxNotional: 2_000_000_000n, marketMask: 1n },
    }, { block: 23, logIndex: 0 }),
    logOf(gw, ADDR.gateway, "PasskeyRegistered", { account: PASSKEY.account, qx: PASSKEY.qx, qy: PASSKEY.qy }, { block: 24, logIndex: 0 }),
    logOf(ex, ADDR.exchange, "HaltSet", { marketId: 0n, halted: true, by: ADDR.bob }, { block: 25, logIndex: 0 }),
  ];
}
