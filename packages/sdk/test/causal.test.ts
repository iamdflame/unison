import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { closedAt, encodeCausalPayload, firstObservationAfter, roundInForce, sessionOpen } from "../src/causal.ts";

const FEED: Address = "0x00000000000000000000000000000000000000fe";
const PHASE = 1n << 64n;

/** A Chainlink proxy with `n` rounds in phase 1, observed every `every` s from `t0`, each landing 13 s later. */
function feed(n: number, t0: bigint, every: bigint) {
  const rounds = new Map<bigint, { observedAt: bigint; arrivedAt: bigint }>();
  for (let i = 1; i <= n; i++) {
    const observedAt = t0 + BigInt(i) * every;
    rounds.set(PHASE + BigInt(i), { observedAt, arrivedAt: observedAt + 13n });
  }
  let reads = 0;
  const latest = PHASE + BigInt(n);
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      reads++;
      const id = functionName === "latestRoundData" ? latest : (args![0] as bigint);
      const r = rounds.get(id);
      return r ? [id, 3_000_000n, r.observedAt, r.arrivedAt, id] : [id, 0n, 0n, 0n, id];
    },
  } as unknown as PublicClient;
  return { client, reads: () => reads };
}

describe("the first observation after a moment, from a feed's own history", () => {
  it("finds it among thousands of rounds in a few dozen reads", async () => {
    const f = feed(5_000, 1_000_000n, 30n); // rounds at 1,000,030 … 1,150,000
    const r = await firstObservationAfter(f.client, FEED, 1_000_000n + 30n * 1_234n + 5n);
    expect(r?.round).toBe(PHASE + 1_235n);
    expect(f.reads()).toBeLessThan(40);
  });

  it("is strictly after: an observation at the moment itself doesn't qualify", async () => {
    const f = feed(100, 0n, 10n);
    expect((await firstObservationAfter(f.client, FEED, 500n))?.observedAt).toBe(510n);
    expect((await firstObservationAfter(f.client, FEED, 499n))?.observedAt).toBe(500n);
  });

  it("is null until one has landed, and the phase's first round when every round is after", async () => {
    const f = feed(100, 0n, 10n);
    expect(await firstObservationAfter(f.client, FEED, 1_000n)).toBeNull();
    expect((await firstObservationAfter(f.client, FEED, 0n))?.round).toBe(PHASE + 1n);
  });

  it("finds the round in force at a moment (the quote divisor)", async () => {
    const f = feed(200, 0n, 3_600n); // hourly, like AUSD/USD
    expect((await roundInForce(f.client, FEED, 3_600n * 50n + 1_799n)).round).toBe(PHASE + 50n);
    expect((await roundInForce(f.client, FEED, 3_600n * 50n)).round).toBe(PHASE + 50n);
    await expect(roundInForce(f.client, FEED, 100n)).rejects.toThrow(/no round/);
  });
});

describe("sessions and the closed rule", () => {
  // Wed 2025-10-08 12:00 UTC (1970-01-01 was a Thursday)
  const WED_NOON = 1_759_924_800n;
  it("mirrors Session.isOpen, wrapping weeks included", () => {
    expect(sessionOpen(0, 0, WED_NOON)).toBe(true);
    expect(sessionOpen(0, 432_000, WED_NOON)).toBe(true); // Mon 00:00 → Sat 00:00
    expect(sessionOpen(0, 432_000, WED_NOON + 3n * 86_400n)).toBe(false); // Saturday
    expect(sessionOpen(597_600, 424_800, WED_NOON + 4n * 86_400n + 10n * 3_600n)).toBe(true); // Sun 22:00 FX open
  });

  it("closes a market whose session ended or whose feed went silent", () => {
    const f = { openSec: 0, closeSec: 0, maxAgeSec: 3_600 };
    const latest = { round: 1n, answer: 1n, observedAt: WED_NOON - 13n, arrivedAt: WED_NOON };
    expect(closedAt(f, latest, WED_NOON + 60n)).toBe(false);
    expect(closedAt(f, latest, WED_NOON + 3_601n)).toBe(true);
    expect(closedAt({ ...f, closeSec: 432_000 }, latest, WED_NOON + 3n * 86_400n)).toBe(true);
  });

  it("encodes the payload the adapter decodes", () => {
    expect(encodeCausalPayload(PHASE + 7n, 3n)).toBe(
      `0x${(PHASE + 7n).toString(16).padStart(64, "0")}${(3n).toString(16).padStart(64, "0")}`,
    );
  });
});
