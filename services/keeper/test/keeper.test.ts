import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { Status, type UnisonClient } from "@unison/sdk";
import { Keeper } from "../src/keeper.ts";
import { parseClearGas } from "../src/main.ts";

interface FakeState {
  reference?: "operator" | "chainlink" | "pyth" | "manual";
  /** adapter read() status; undefined = the read reverts */
  adapterStatus?: number;
  lastStatus?: number;
  estimate?: bigint;
  phase: number;
  lastCleared: bigint;
  pending: boolean;
  simVolume: bigint;
  vaultPending: bigint;
  status: number;
  discCadence: number;
  lastDiscoveryBatch: bigint;
}

/** Minimal UnisonClient double exposing exactly what the keeper uses. */
function fakeClient(s: FakeState) {
  const sent: string[] = [];
  const payloads: string[] = [];
  const gas: (bigint | undefined)[] = [];
  const client = {
    exchange: "0x00000000000000000000000000000000000000ee",
    walletClient: { account: { address: "0x00000000000000000000000000000000000000ff" } },
    deployment: {
      markets: {
        "aNVDA/AUSD": { id: 0, vault: "0x00000000000000000000000000000000000000aa", ...(s.reference ? { reference: s.reference } : {}) },
      },
    },
    jobPhase: vi.fn(async () => s.phase),
    market: vi.fn(async () => ({
      lastCleared: s.lastCleared,
      pendingHead: 0n,
      pendingTail: s.pending ? 1n : 0n,
      refAdapter: "0x00000000000000000000000000000000000000cc",
      lastStatus: s.lastStatus ?? Status.OPEN,
    })),
    regime: vi.fn(async () => ({ discCadence: s.discCadence, lastDiscoveryBatch: s.lastDiscoveryBatch })),
    vault: vi.fn(async () => ({ pendingRequests: s.vaultPending })),
    simulateClearUpTo: vi.fn(async (_m: bigint, _u: bigint, payload: string) => {
      payloads.push(payload);
      return { tick: 18_000n, volume: s.simVolume };
    }),
    clearUpTo: vi.fn(async (_m: bigint, upTo: bigint, _p: string, g?: bigint) => {
      gas.push(g);
      sent.push(`open:${upTo}`);
      s.phase = 0;
      s.lastCleared = upTo;
      s.pending = false;
      return "0x01" as Hex;
    }),
    clear: vi.fn(async (_m: bigint, _p: string, g?: bigint) => {
      gas.push(g);
      sent.push("continue");
      s.phase = 0;
      return "0x02" as Hex;
    }),
    processVault: vi.fn(async () => {
      sent.push("vault");
      s.vaultPending = 0n;
      return "0x03" as Hex;
    }),
    previewOrder: vi.fn(),
    order: vi.fn(),
    claim: vi.fn(),
    publicClient: {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", gasUsed: 1n })),
      readContract: vi.fn(async () => {
        if (s.adapterStatus === undefined) throw new Error("execution reverted");
        return [180_000_000n, 1_760_000_000_000n, s.adapterStatus];
      }),
      estimateContractGas: vi.fn(async () => s.estimate ?? 1_000_000n),
    },
  };
  return { client: client as unknown as UnisonClient, sent, payloads, gas };
}

function keeper(client: UnisonClient, clearGas: bigint | "auto" = 8_000_000n) {
  const k = new Keeper({
    client,
    relayUrl: "http://relay",
    marketIds: [0n],
    clearGas,
    repriceEvery: 5n,
    maxPendingAge: 10n,
    autoClaim: false,
    log: () => {},
  });
  k.fetchPayload = async (_m, _b) => ({ payload: "0xabcd" as Hex, status: stateStatus });
  return k;
}
let stateStatus: number = Status.OPEN;

const base: FakeState = {
  phase: 0,
  lastCleared: 100n,
  pending: false,
  simVolume: 0n,
  vaultPending: 0n,
  status: Status.OPEN,
  discCadence: 10,
  lastDiscoveryBatch: 0n,
};

describe("keeper cost policy (Monad charges the gas limit)", () => {
  it("continues a running job without a reference", async () => {
    const { client, sent } = fakeClient({ ...base, phase: 2 });
    await keeper(client).tick(200n);
    expect(sent).toEqual(["continue"]);
  });

  it("does not pay for a clear that would not trade and has nothing stale to merge", async () => {
    const { client, sent } = fakeClient({ ...base, pending: true, simVolume: 0n, lastCleared: 196n });
    await keeper(client).tick(200n); // pending batch age 3 < 10
    expect(sent).toEqual([]);
  });

  it("clears when the auction would trade", async () => {
    const { client, sent } = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n });
    await keeper(client).tick(200n);
    expect(sent).toEqual(["open:199"]);
  });

  it("merges pending orders once they exceed the age budget, even without a trade", async () => {
    const { client, sent } = fakeClient({ ...base, pending: true, simVolume: 0n, lastCleared: 180n });
    await keeper(client).tick(200n);
    expect(sent).toEqual(["open:199"]);
  });

  it("gives a waiting vault queue its post-request reference, then processes it", async () => {
    const { client, sent } = fakeClient({ ...base, vaultPending: 1n, simVolume: 0n, lastCleared: 198n });
    await keeper(client).tick(200n);
    expect(sent).toEqual(["open:199", "vault"]);
  });

  it("respects the DISCOVERY call-auction cadence", async () => {
    stateStatus = Status.CLOSED;
    const { client, sent } = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n, lastDiscoveryBatch: 195n });
    await keeper(client).tick(200n); // 199 < 195 + 10
    expect(sent).toEqual([]);
    stateStatus = Status.OPEN;
  });
});

describe("non-operator markets (Chainlink, Pyth, manual)", () => {
  it("clear with an empty payload and never ask the relay", async () => {
    const { client, sent, payloads } = fakeClient({ ...base, reference: "chainlink", adapterStatus: Status.OPEN, pending: true, simVolume: 5n, lastCleared: 196n });
    const k = keeper(client);
    const relay = vi.spyOn(k, "fetchPayload");
    await k.tick(200n);
    expect(relay).not.toHaveBeenCalled();
    expect(payloads).toEqual(["0x"]);
    expect(sent).toEqual(["open:199"]);
  });

  it("take the DISCOVERY cadence from the adapter's own status", async () => {
    const { client, sent } = fakeClient({
      ...base, reference: "chainlink", adapterStatus: Status.CLOSED, pending: true, simVolume: 5n, lastCleared: 196n, lastDiscoveryBatch: 195n,
    });
    await keeper(client).tick(200n); // CLOSED: 199 < 195 + 10
    expect(sent).toEqual([]);
  });

  it("fall back to the last clear's status when the adapter read reverts", async () => {
    const closed = fakeClient({ ...base, reference: "pyth", lastStatus: Status.CLOSED, pending: true, simVolume: 5n, lastCleared: 196n, lastDiscoveryBatch: 195n });
    await keeper(closed.client).tick(200n);
    expect(closed.sent).toEqual([]);
    const open = fakeClient({ ...base, reference: "pyth", lastStatus: Status.OPEN, pending: true, simVolume: 5n, lastCleared: 196n, lastDiscoveryBatch: 195n });
    await keeper(open.client).tick(200n);
    expect(open.sent).toEqual(["open:199"]);
  });
});

describe("CLEAR_GAS", () => {
  it("auto: the clear's gas estimate × 1.2", async () => {
    const { client, gas } = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n, estimate: 2_000_000n });
    await keeper(client, "auto").tick(200n);
    expect(gas).toEqual([2_400_000n]);
  });

  it("auto: a paused job continues with the full budget, never an estimate (it would settle on pausing)", async () => {
    const { client, gas } = fakeClient({ ...base, phase: 2, estimate: 64_000n });
    await keeper(client, "auto").tick(200n);
    expect(gas).toEqual([25_000_000n]);
  });

  it("auto: an opening estimate is clamped to the floor and the budget", async () => {
    const low = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n, estimate: 60_000n });
    await keeper(low.client, "auto").tick(200n);
    expect(low.gas).toEqual([2_000_000n]);
    const high = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n, estimate: 40_000_000n });
    await keeper(high.client, "auto").tick(200n);
    expect(high.gas).toEqual([25_000_000n]);
  });

  it("auto: the attempt after a reverted clear gets the full budget", async () => {
    const state = { ...base, pending: true, simVolume: 5n, lastCleared: 196n, estimate: 3_000_000n };
    const { client, gas } = fakeClient(state);
    const receipts = (client.publicClient as unknown as { waitForTransactionReceipt: ReturnType<typeof vi.fn> }).waitForTransactionReceipt;
    receipts.mockResolvedValueOnce({ status: "reverted", gasUsed: 2_953_125n });
    const k = keeper(client, "auto");
    await k.tick(200n);
    state.pending = true;
    state.lastCleared = 196n;
    await k.tick(201n);
    expect(gas).toEqual([3_600_000n, 25_000_000n]);
    // and once one goes through, estimates resume
    state.pending = true;
    state.lastCleared = 197n;
    await k.tick(202n);
    expect(gas.at(-1)).toBe(3_600_000n);
  });

  it("a fixed limit is passed through untouched", async () => {
    const { client, gas } = fakeClient({ ...base, pending: true, simVolume: 5n, lastCleared: 196n });
    await keeper(client).tick(200n);
    expect(gas).toEqual([8_000_000n]);
  });

  it("parses the env value", () => {
    expect(parseClearGas("auto")).toBe("auto");
    expect(parseClearGas(" AUTO ")).toBe("auto");
    expect(parseClearGas("8000000")).toBe(8_000_000n);
  });
});
