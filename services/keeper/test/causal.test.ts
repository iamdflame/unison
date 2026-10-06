import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import type { CausalFeed, Observation, UnisonClient } from "@unison/sdk";
import { Keeper, type CausalHistory } from "../src/keeper.ts";

const ADAPTER: Address = "0x00000000000000000000000000000000000000cc";
const FEED: Address = "0x00000000000000000000000000000000000000fe";
const VAULT: Address = "0x00000000000000000000000000000000000000aa";
const NOW = 1_000_000n;

interface S {
  pending: boolean;
  oldest?: bigint;
  vaultPending?: bigint;
  requestTime?: bigint;
  lastRefTimeMs?: bigint;
  simFails?: boolean;
  lastDiscoveryBatch?: bigint;
}

/** A causal market (WMON/AUSD, id 1, skew 2 s) and just enough chain to drive the keeper. */
function causalClient(s: S) {
  const sent: { kind: string; payload?: Hex }[] = [];
  const client = {
    exchange: "0x00000000000000000000000000000000000000ee",
    walletClient: { account: { address: "0x00000000000000000000000000000000000000ff" } },
    deployment: { markets: { "WMON/AUSD": { id: 1, vault: VAULT, reference: "chainlink-causal" } } },
    causal: vi.fn(async () => ({ on: true, skewSec: 2 })),
    jobPhase: vi.fn(async () => 0),
    market: vi.fn(async () => ({
      pendingHead: 0n,
      pendingTail: s.pending ? 1n : 0n,
      refAdapter: ADAPTER,
      lastRefTimeMs: s.lastRefTimeMs ?? 0n,
      lastCleared: 100n,
      lastStatus: 0,
    })),
    pendingTimes: vi.fn(async () => (s.pending ? [{ batch: 150n, time: s.oldest ?? NOW - 40n }] : [])),
    regime: vi.fn(async () => ({ discCadence: 10, lastDiscoveryBatch: s.lastDiscoveryBatch ?? 0n })),
    simulateClear: vi.fn(async () => {
      if (s.simFails) throw new Error("execution reverted: NotYet()");
      return { tick: 30_400n, volume: 0n };
    }),
    clear: vi.fn(async (_m: bigint, payload: Hex) => {
      sent.push({ kind: "clear", payload });
      s.pending = false;
      return "0x01" as Hex;
    }),
    processVault: vi.fn(async () => {
      sent.push({ kind: "vault" });
      s.vaultPending = 0n;
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

const obs = (round: bigint, observedAt: bigint, arrivedAt = observedAt + 13n): Observation => ({
  round,
  answer: 3_040_000n,
  observedAt,
  arrivedAt,
});

function history(after: Observation | null, latest: Observation, feed: Partial<CausalFeed> = {}): CausalHistory {
  return {
    payload: vi.fn(async () => (after ? { payload: "0xfeed" as Hex, base: after } : null)),
    feed: vi.fn(async () => ({
      base: FEED,
      quote: "0x0000000000000000000000000000000000000000" as Address,
      maxAgeSec: 3_600,
      quoteMaxAgeSec: 3_600,
      openSec: 0,
      closeSec: 0,
      depegBps: 50,
      ...feed,
    })),
    latest: vi.fn(async () => latest),
  };
}

function keeper(client: UnisonClient, h: CausalHistory) {
  return new Keeper({
    client,
    relayUrl: "http://relay",
    marketIds: [1n],
    clearGas: "auto",
    repriceEvery: 5n,
    maxPendingAge: 10n,
    autoClaim: false,
    log: () => {},
    history: h,
    now: () => NOW,
  });
}

describe("causal markets (SPEC §7.4)", () => {
  it("clear an auction with the first observation after its oldest order, as soon as it lands", async () => {
    const { client, raw, sent } = causalClient({ pending: true, oldest: NOW - 40n });
    const first = obs(77n, NOW - 30n);
    const h = history(first, first);
    await keeper(client, h).tick(200n);
    expect(h.payload).toHaveBeenCalledWith(ADAPTER, 1n, NOW - 38n); // oldest + skew
    expect(raw.simulateClear).toHaveBeenCalledWith(1n, "0xfeed");
    expect(sent).toEqual([{ kind: "clear", payload: "0xfeed" }]);
  });

  it("wait for Chainlink while the market is open and nothing has been observed after the oldest order", async () => {
    const { client, sent } = causalClient({ pending: true, oldest: NOW - 10n });
    await keeper(client, history(null, obs(76n, NOW - 60n, NOW - 47n))).tick(200n);
    expect(sent).toEqual([]);
  });

  it("run a DISCOVERY call auction with no observation when the feed has gone silent", async () => {
    const { client, sent } = causalClient({ pending: true, oldest: NOW - 10n });
    await keeper(client, history(null, obs(76n, NOW - 4_000n, NOW - 3_987n))).tick(200n);
    expect(sent).toEqual([{ kind: "clear", payload: "0x" }]);
  });

  it("run a DISCOVERY call auction when the session is closed, on its cadence", async () => {
    // a Mon 00:00 → Sat 00:00 UTC window; NOW (1970-01-12 13:46 UTC) falls on a Monday, so shift to a Saturday
    const sat = 1_759_536_000n + 12n * 3_600n; // Sat 2025-10-04 12:00 UTC
    const { client, sent } = causalClient({ pending: true, oldest: sat - 10n, lastDiscoveryBatch: 195n });
    const h = history(null, obs(76n, sat - 50_000n, sat - 49_987n), { openSec: 0, closeSec: 432_000 });
    const k = new Keeper({ ...keeper(client, h).cfg, now: () => sat });
    await k.tick(200n); // upTo 199 < 195 + 10: the next call auction is a few blocks away
    expect(sent).toEqual([]);
    await k.tick(210n);
    expect(sent).toEqual([{ kind: "clear", payload: "0x" }]);
  });

  it("never send a clear the chain refuses (Monad charges the gas limit for a revert)", async () => {
    const { client, sent } = causalClient({ pending: true, simFails: true });
    const first = obs(77n, NOW - 30n);
    await keeper(client, history(first, first)).tick(200n);
    expect(sent).toEqual([]);
  });

  it("give a waiting vault request an observation made after it, then process it", async () => {
    const { client, sent } = causalClient({
      pending: false,
      vaultPending: 1n,
      requestTime: NOW - 100n,
      lastRefTimeMs: (NOW - 500n) * 1000n,
    });
    const k = keeper(client, history(null, obs(80n, NOW - 20n)));
    await k.tick(200n);
    expect(sent[0]).toEqual({ kind: "clear", payload: "0x" });
  });

  it("not clear for a vault request when the latest observation predates it", async () => {
    const { client, sent } = causalClient({
      pending: false,
      vaultPending: 1n,
      requestTime: NOW - 10n,
      lastRefTimeMs: (NOW - 500n) * 1000n,
    });
    await keeper(client, history(null, obs(80n, NOW - 20n))).tick(200n);
    expect(sent).toEqual([]);
  });
});
