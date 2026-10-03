import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { Status, type UnisonClient } from "@unison/sdk";
import { Keeper } from "../src/keeper.ts";

interface FakeState {
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
  const client = {
    deployment: { markets: { "aNVDA/AUSD": { id: 0, vault: "0x00000000000000000000000000000000000000aa" } } },
    jobPhase: vi.fn(async () => s.phase),
    market: vi.fn(async () => ({
      lastCleared: s.lastCleared,
      pendingHead: 0n,
      pendingTail: s.pending ? 1n : 0n,
    })),
    regime: vi.fn(async () => ({ discCadence: s.discCadence, lastDiscoveryBatch: s.lastDiscoveryBatch })),
    vault: vi.fn(async () => ({ pendingRequests: s.vaultPending })),
    simulateClearUpTo: vi.fn(async () => ({ tick: 18_000n, volume: s.simVolume })),
    clearUpTo: vi.fn(async (_m: bigint, upTo: bigint) => {
      sent.push(`open:${upTo}`);
      s.phase = 0;
      s.lastCleared = upTo;
      s.pending = false;
      return "0x01" as Hex;
    }),
    clear: vi.fn(async () => {
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
    publicClient: { waitForTransactionReceipt: vi.fn(async () => ({ status: "success", gasUsed: 1n })) },
  };
  return { client: client as unknown as UnisonClient, sent };
}

function keeper(client: UnisonClient) {
  const k = new Keeper({
    client,
    relayUrl: "http://relay",
    marketIds: [0n],
    clearGas: 8_000_000n,
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
