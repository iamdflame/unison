import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import type { UnisonClient } from "@unison/sdk";
import { Keeper, type CausalHistory, type StreamsSource } from "../src/keeper.ts";

const ADAPTER: Address = "0x00000000000000000000000000000000000000cc";
const VAULT: Address = "0x00000000000000000000000000000000000000aa";
const NOW = 1_000_000n;

interface S {
  pending: boolean;
  oldest?: bigint;
  vaultPending?: bigint;
  requestTime?: bigint;
  lastRefTimeMs?: bigint;
}

/** A causal market (id 1, skew 2 s) on a Data Streams adapter, with just enough chain to drive the keeper. */
function streamsClient(s: S) {
  const sent: { kind: string; payload?: Hex; report?: Hex }[] = [];
  const client = {
    exchange: "0x00000000000000000000000000000000000000ee",
    walletClient: { account: { address: "0x00000000000000000000000000000000000000ff" } },
    deployment: { markets: { "aNVDA/AUSD": { id: 1, vault: VAULT, reference: "streams-causal" } } },
    causal: vi.fn(async () => ({ on: true, skewSec: 2 })),
    jobPhase: vi.fn(async () => 0),
    paused: vi.fn(async () => false),
    market: vi.fn(async () => ({
      active: true,
      pendingHead: 0n,
      pendingTail: s.pending ? 1n : 0n,
      refAdapter: ADAPTER,
      lastRefTimeMs: s.lastRefTimeMs ?? 0n,
      lastCleared: 100n,
      lastStatus: 0,
    })),
    pendingTimes: vi.fn(async () => (s.pending ? [{ batch: 150n, time: s.oldest ?? NOW - 10n }] : [])),
    regime: vi.fn(async () => ({ discCadence: 10, lastDiscoveryBatch: 0n, halted: false })),
    simulateClear: vi.fn(async () => ({ tick: 23_000n, volume: 0n })),
    clear: vi.fn(async (_m: bigint, payload: Hex) => {
      sent.push({ kind: "clear", payload });
      s.pending = false;
      return "0x01" as Hex;
    }),
    submitStreamsReport: vi.fn(async (_a: Address, report: Hex) => {
      sent.push({ kind: "submit", report });
      return "0x03" as Hex;
    }),
    processVault: vi.fn(async () => {
      sent.push({ kind: "vault" });
      return "0x02" as Hex;
    }),
    publicClient: {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", gasUsed: 1n })),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "head") return 0n;
        if (functionName === "queueLength") return s.vaultPending ?? 0n;
        if (functionName === "request") return { owner: VAULT, redeem: false, time: s.requestTime ?? NOW - 100n, amount: 1n };
        throw new Error(`unexpected read ${functionName}`);
      }),
      estimateContractGas: vi.fn(async () => 900_000n),
    },
  };
  return { client: client as unknown as UnisonClient, raw: client, sent };
}

/** a Chainlink history that must never be asked: Data Streams markets don't read push feeds */
const noHistory: CausalHistory = {
  payload: vi.fn(async () => {
    throw new Error("push feed read on a Streams market");
  }),
  feed: vi.fn(async () => {
    throw new Error("push feed read on a Streams market");
  }),
  latest: vi.fn(async () => {
    throw new Error("push feed read on a Streams market");
  }),
};

function source(o: Partial<StreamsSource> = {}): StreamsSource {
  return {
    isStreams: vi.fn(async () => true),
    payload: vi.fn(async () => ({ payload: "0xbeef" as Hex, fullReport: "0x5eed" as Hex, stored: false, observedAt: NOW - 7n })),
    latest: vi.fn(async () => null),
    ...o,
  };
}

function keeper(client: UnisonClient, streams: StreamsSource) {
  return new Keeper({
    client,
    relayUrl: "http://relay",
    marketIds: [1n],
    clearGas: "auto",
    repriceEvery: 5n,
    maxPendingAge: 10n,
    autoClaim: false,
    log: () => {},
    history: noHistory,
    streams,
    now: () => NOW,
  });
}

describe("causal markets on Chainlink Data Streams", () => {
  it("bring the first report after the oldest order on chain, then clear the auction with it", async () => {
    const { client, sent } = streamsClient({ pending: true, oldest: NOW - 10n });
    const src = source();
    await keeper(client, src).tick(200n);
    expect(src.payload).toHaveBeenCalledWith(ADAPTER, 1n, NOW - 8n); // oldest + skew
    expect(sent).toEqual([
      { kind: "submit", report: "0x5eed" },
      { kind: "clear", payload: "0xbeef" },
    ]);
  });

  it("skip the submit when somebody already brought that report", async () => {
    const { client, sent } = streamsClient({ pending: true });
    const src = source({
      payload: vi.fn(async () => ({ payload: "0xbeef" as Hex, fullReport: "0x5eed" as Hex, stored: true, observedAt: NOW - 7n })),
    });
    await keeper(client, src).tick(200n);
    expect(sent).toEqual([{ kind: "clear", payload: "0xbeef" }]);
  });

  it("wait while the report isn't out, closed market or not: there is no empty-payload path", async () => {
    const { client, sent } = streamsClient({ pending: true });
    await keeper(client, source({ payload: vi.fn(async () => null) })).tick(200n);
    expect(sent).toEqual([]);
  });

  it("give a vault request the newest report once it is newer than the last reference and later than the request", async () => {
    const { client, sent } = streamsClient({ pending: false, vaultPending: 1n, requestTime: NOW - 100n, lastRefTimeMs: (NOW - 500n) * 1000n });
    const src = source({ latest: vi.fn(async () => ({ fullReport: "0x1a7e" as Hex, stored: false, observedAt: NOW - 1n })) });
    await keeper(client, src).tick(200n);
    expect(sent).toEqual([
      { kind: "submit", report: "0x1a7e" },
      { kind: "clear", payload: "0x" },
    ]);
  });

  it("not run an empty auction at a report from before the request", async () => {
    const { client, sent } = streamsClient({ pending: false, vaultPending: 1n, requestTime: NOW - 100n, lastRefTimeMs: (NOW - 500n) * 1000n });
    const src = source({ latest: vi.fn(async () => ({ fullReport: "0x1a7e" as Hex, stored: true, observedAt: NOW - 200n })) });
    await keeper(client, src).tick(200n);
    expect(sent).toEqual([]);
  });

  it("leave push-feed markets on their own path", async () => {
    const { client, sent } = streamsClient({ pending: true });
    const history: CausalHistory = {
      payload: vi.fn(async () => ({ payload: "0xfeed" as Hex, base: { round: 7n, answer: 1n, observedAt: NOW - 5n, arrivedAt: NOW } })),
      feed: vi.fn(),
      latest: vi.fn(),
    } as unknown as CausalHistory;
    const k = new Keeper({ ...keeper(client, source({ isStreams: vi.fn(async () => false) })).cfg, history });
    await k.tick(200n);
    expect(sent).toEqual([{ kind: "clear", payload: "0xfeed" }]);
  });
});
