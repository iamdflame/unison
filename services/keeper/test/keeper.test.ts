import { describe, expect, it, vi, type Mock } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { Status, unisonExchangeAbi, type UnisonClient } from "@unison/sdk";
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
  /** the market's last reference publish time (ms); a vault request at REQUEST_S can process once it is later */
  lastRefTimeMs?: bigint;
  /** process() succeeds but leaves the queue as it was (a revert, in effect) */
  processFails?: boolean;
  status: number;
  discCadence: number;
  lastDiscoveryBatch: bigint;
}

const REQUEST_S = 1_000n;
const REF_AFTER_REQUEST = 2_000_000n; // ms, after REQUEST_S

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
      lastRefTimeMs: s.lastRefTimeMs ?? 0n,
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
      s.lastRefTimeMs = REF_AFTER_REQUEST; // the clear records a reference published after the request
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
      if (!s.processFails) s.vaultPending = 0n;
      return "0x03" as Hex;
    }),
    previewOrder: vi.fn(),
    order: vi.fn(),
    claim: vi.fn(),
    publicClient: {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", gasUsed: 1n })),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        // the vault's queue: head, length, and its oldest request
        if (functionName === "head") return 0n;
        if (functionName === "queueLength") return s.vaultPending;
        if (functionName === "request") return { owner: "0x00000000000000000000000000000000000000bb", redeem: false, time: REQUEST_S, amount: 1n };
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

  it("processes a vault request that already has a reference after it, without clearing again", async () => {
    const { client, sent } = fakeClient({ ...base, vaultPending: 1n, lastRefTimeMs: REF_AFTER_REQUEST, simVolume: 0n, lastCleared: 198n });
    await keeper(client).tick(200n);
    expect(sent).toEqual(["vault"]);
  });

  it("tries a failing process() at most once every 20 blocks, and never clears for it", async () => {
    const { client, sent } = fakeClient({ ...base, vaultPending: 1n, lastRefTimeMs: REF_AFTER_REQUEST, processFails: true, simVolume: 0n, lastCleared: 198n });
    const k = keeper(client);
    await k.tick(200n);
    await k.tick(205n);
    await k.tick(219n);
    await k.tick(221n);
    expect(sent).toEqual(["vault", "vault"]);
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

describe("auto-claim", () => {
  const A = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
  const B = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;
  /** An OrderPlaced log as the exchange emits it. */
  const placed = (account: Address, slot: bigint) => ({
    topics: encodeEventTopics({ abi: unisonExchangeAbi, eventName: "OrderPlaced", args: { marketId: 0n, account } }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [slot, 0n, 18_000n, 10n, 0n, 199n],
    ),
  });

  it("a reverted claim is logged; the others are claimed, the market still clears, and the slot is tried again", async () => {
    const state = { ...base, pending: true, simVolume: 5n, lastCleared: 196n };
    const { client, sent } = fakeClient(state);
    const c = client as unknown as { previewOrder: Mock; order: Mock; claim: Mock; publicClient: { waitForTransactionReceipt: Mock } };
    c.previewOrder.mockResolvedValue({ merged: true, closed: false, filled: 10n, quote: 0n });
    c.order.mockResolvedValue({ side: 0n, credited: 0n });
    // A's owner claimed first, so the keeper's claim for A reverts; B's goes through
    c.claim.mockImplementation(async (account: Address) => (account === A ? "0xbad" : "0x0c") as Hex);
    c.publicClient.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({ status: hash === "0xbad" ? "reverted" : "success", gasUsed: 1n }));
    const logs: Record<string, unknown>[] = [];
    const k = new Keeper({ client, relayUrl: "http://relay", marketIds: [0n], clearGas: 8_000_000n, repriceEvery: 5n, maxPendingAge: 10n, autoClaim: true, log: (m) => logs.push(m) });
    k.fetchPayload = async () => ({ payload: "0xabcd" as Hex, status: Status.OPEN });
    k.trackLogs([placed(A, 1n), placed(B, 2n)]);

    await expect(k.tick(200n)).resolves.toBe(2); // the clear, and B's claim
    expect(sent).toContain("open:199");
    expect(c.claim).toHaveBeenCalledTimes(2);
    expect(logs).toContainEqual(expect.objectContaining({ level: "warn", action: "claim", account: A }));

    await k.tick(201n); // A's slot is still tracked, so the keeper tries again
    expect(c.claim.mock.calls.filter(([account]) => account === A)).toHaveLength(2);
  });
});
