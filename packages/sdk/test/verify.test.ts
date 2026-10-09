import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hex, PublicClient } from "viem";
import { discoveryBand, NotAClearError, verifyReceipt } from "../src/verify.ts";

// Every chain read behind three receipts: the first causal print on Monad mainnet (scripts/record-receipt.mjs), and a
// DISCOVERY call auction and a halted auction made on an anvil fork of mainnet on a Saturday (scripts/fork-receipts.mjs).
interface Fixture {
  tx: Hex;
  rule: string;
  calls: { key: string; result?: unknown; error?: string }[];
}
const revive = (_: string, v: unknown) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), revive) as Fixture;
const mainnet = load("receipt-111055816.json");
const discovery = load("receipt-discovery-fork.json");
const halted = load("receipt-halted-fork.json");
const key = (method: string, args: unknown) => JSON.stringify([method, args], (_, v) => (typeof v === "bigint" ? `${v}n` : v));

type Edit = (method: string, result: unknown, args: Record<string, unknown>) => unknown;

/** A client that answers from a recording, with `edit` changing an answer (or filling in a failed read) to show what
 *  a forgery looks like. */
function replay(fixture: Fixture, edit?: Edit): PublicClient {
  const answers = new Map(fixture.calls.map((c) => [c.key, c]));
  const answer = (method: string, args: Record<string, unknown>) => {
    const c = answers.get(key(method, args));
    if (c === undefined) throw new Error(`not recorded: ${key(method, args)}`);
    const edited = edit?.(method, c.result === undefined ? undefined : structuredClone(c.result), args);
    if (edited !== undefined) return Promise.resolve(edited);
    if (c.error !== undefined) return Promise.reject(new Error(c.error));
    return Promise.resolve(c.result);
  };
  return {
    getTransactionReceipt: (a: Record<string, unknown>) => answer("getTransactionReceipt", a),
    getBlock: (a: Record<string, unknown>) => answer("getBlock", a),
    readContract: (a: Record<string, unknown>) =>
      answer("readContract", { address: a.address, functionName: a.functionName, args: a.args, blockNumber: a.blockNumber }),
    getLogs: (a: Record<string, unknown>) => answer("getLogs", { address: a.address, args: a.args, fromBlock: a.fromBlock, toBlock: a.toBlock }),
  } as unknown as PublicClient;
}

const failed = (v: Awaited<ReturnType<typeof verifyReceipt>>) => v.steps.filter((s) => s.kind === "check" && !s.ok).map((s) => s.what);
const isRead = (fn: string) => (method: string, args: Record<string, unknown>) => method === "readContract" && args.functionName === fn;

describe("a causal receipt, checked from the chain alone", () => {
  it("passes every check on the first causal print on mainnet", async () => {
    const v = await verifyReceipt(replay(mainnet), mainnet.tx);
    expect(v.ok).toBe(true);
    expect(v.rule).toBe("causal");
    expect(v.checks).toBe(6);
    expect(v.marketId).toBe(1n);
    expect(v.upToBlock).toBe(111_055_816n);
    expect(v.price).toBe(28_942n);
    expect(v.causal?.observedAt).toBe(1791295082n);
    expect(v.causal!.observedAt - v.causal!.sealedAt).toBe(6n);
    // two batches waited for it, the older sealed at …065: the rule is judged from that one
    expect(v.steps.some((s) => s.kind === "check" && /oldest waiting order's seal \(block 111055781, at 1791295065\)/.test(s.what))).toBe(true);
  });

  it("fails when Chainlink's observation time is not the receipt's", async () => {
    // the round claims an observation one second later than the one the auction priced at
    const v = await verifyReceipt(
      replay(mainnet, (method, r) => (method === "readContract" && Array.isArray(r) && r.length === 5 && r[2] === 1791295082n ? [r[0], r[1], 1791295083n, r[3], r[4]] : undefined)),
      mainnet.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)[0]).toMatch(/reference time is Chainlink's observation time/);
  });

  it("fails when an earlier observation already qualified", async () => {
    // the round before is said to be observed after the seal plus the skew, so it should have priced the auction
    const v = await verifyReceipt(
      replay(mainnet, (method, r) => (method === "readContract" && Array.isArray(r) && r.length === 5 && r[2] === 1791295052n ? [r[0], r[1], 1791295080n, r[3], r[4]] : undefined)),
      mainnet.tx,
    );
    expect(v.ok).toBe(false);
    expect(v.failures).toBe(1);
    expect(failed(v)[0]).toMatch(/no earlier observation qualified/);
  });

  it("judges the first observation from the oldest order, not the newest", async () => {
    // had the oldest order been sealed at …040, the round before (observed at …052) was already after it plus the
    // skew: that order should have cleared a round earlier. Measured from the newest seal (…076) it would look fine.
    const v = await verifyReceipt(
      replay(mainnet, (method, r, args) => (isRead("pendingTimes")(method, args) ? [[111_055_700n, 111_055_816n], [1791295040n, 1791295076n]] : undefined)),
      mainnet.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)).toEqual([expect.stringMatching(/oldest waiting order's seal \(block 111055700, at 1791295040\).*no earlier observation qualified/)]);
  });

  it("fails when an order sealed in time was left out", async () => {
    // a third batch, sealed at …078, was more than the skew before the observation (…082): it belonged in this auction
    const v = await verifyReceipt(
      replay(mainnet, (method, r, args) =>
        isRead("pendingTimes")(method, args) ? [[111_055_781n, 111_055_816n, 111_055_822n], [1791295065n, 1791295076n, 1791295078n]] : undefined,
      ),
      mainnet.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)).toEqual([expect.stringMatching(/next waiting order, sealed in block 111055822.*none was left out/)]);
  });

  it("passes when the next order came within the skew of the observation", async () => {
    const v = await verifyReceipt(
      replay(mainnet, (method, r, args) =>
        isRead("pendingTimes")(method, args) ? [[111_055_781n, 111_055_816n, 111_055_830n], [1791295065n, 1791295076n, 1791295080n]] : undefined,
      ),
      mainnet.tx,
    );
    expect(v.ok).toBe(true);
    expect(v.checks).toBe(7);
  });

  it("still checks what it can when the RPC keeps no state from before the clear", async () => {
    const v = await verifyReceipt(
      replay(mainnet, (method, r, args) => (isRead("pendingTimes")(method, args) ? Promise.reject(new Error("missing trie node")) : undefined)),
      mainnet.tx,
    );
    expect(v.ok).toBe(true);
    expect(v.steps.filter((s) => s.kind === "skip").map((s) => s.what)).toEqual([
      expect.stringMatching(/oldest waiting order/),
      expect.stringMatching(/none left out/),
    ]);
  });

  it("fails when the receipt chain is broken", async () => {
    const v = await verifyReceipt(replay(mainnet), mainnet.tx, { prev: `0x${"11".repeat(32)}` });
    expect(v.ok).toBe(false);
    expect(failed(v)[0]).toMatch(/receipt hash recomputes/);
  });

  it("refuses a transaction that did not finish an auction", async () => {
    const client = replay(mainnet, (method, r) => (method === "getTransactionReceipt" ? { ...(r as object), logs: [] } : undefined));
    await expect(verifyReceipt(client, mainnet.tx)).rejects.toBeInstanceOf(NotAClearError);
  });
});

describe("a DISCOVERY call auction, while the market is closed", () => {
  it("passes every check: the newest observation, a closed session, and the regime's band", async () => {
    const v = await verifyReceipt(replay(discovery), discovery.tx);
    expect(v.ok).toBe(true);
    expect(v.rule).toBe("discovery");
    expect(v.status).toBe(2);
    expect(v.checks).toBe(10);
    expect(v.volume).toBe(10n ** 15n);
    // priced at the last observation, made before every order in it
    expect(v.causal!.observedAt).toBeLessThan(v.causal!.sealedAt);
    expect(v.steps.some((s) => s.kind === "check" && /band is ticks 23210–23678: 100 bp/.test(s.what))).toBe(true);
  });

  it("fails when a newer observation had landed before the auction cleared", async () => {
    const v = await verifyReceipt(
      replay(discovery, (method, r, args) => {
        if (!isRead("getRoundData")(method, args)) return undefined;
        const round = (args.args as bigint[])[0]!;
        if (round !== 18446744073709556682n) return undefined; // the round after the one the auction used
        return [round, 23_500_000_000n, 1791594000n, 1791594005n, round];
      }),
      discovery.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)).toEqual([expect.stringMatching(/next round landed at 1791594005, not before the clear/)]);
  });

  it("fails when the band is wider than the regime allows", async () => {
    // a regime that had been closed for a day would give a wider band than the one the auction logged
    const v = await verifyReceipt(
      replay(discovery, (method, r, args) => (isRead("regimeOf")(method, args) ? { ...(r as object), closedSince: 1791594011n - 86_400n } : undefined)),
      discovery.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)).toEqual([expect.stringMatching(/band is ticks/)]);
  });

  it("fails when the market was open", async () => {
    // a feed whose session never closes, and that had just reported: no DISCOVERY auction was allowed
    const v = await verifyReceipt(
      replay(discovery, (method, r, args) => {
        if (!isRead("feeds")(method, args)) return undefined;
        const f = [...(r as unknown[])];
        f[5] = 10_000_000; // maxAgeSec
        f[7] = 0; // openSec
        f[8] = 0; // closeSec: open == close is always open
        return f;
      }),
      discovery.tx,
    );
    expect(v.ok).toBe(false);
    expect(failed(v)).toEqual([expect.stringMatching(/silent for .* past its 10000000 s maximum age/)]);
  });
});

describe("a halted auction", () => {
  it("trades nothing, and every check of the observation it read still passes", async () => {
    const v = await verifyReceipt(replay(halted), halted.tx);
    expect(v.ok).toBe(true);
    expect(v.status).toBe(3);
    expect(v.volume).toBe(0n);
    expect(v.steps.some((s) => s.kind === "check" && s.ok && s.what === "a halted auction trades nothing")).toBe(true);
  });
});

describe("the DISCOVERY band", () => {
  const m = { bandBps: 100, minTick: 1, maxTick: 2_097_151, maxBandTicks: 4001, tickSize: 10_000n };
  const g = { discFloorBps: 100, discCapBps: 726, discHorizonSec: 172_800, closedSince: 0n };

  it("starts at the floor, and widens with √time to the cap", () => {
    const px = 234_441_963n; // $234.44, tick 23444
    expect(discoveryBand(m, g, px, 1791594011n)).toMatchObject({ refTick: 23444n, bps: 100n, lo: 23210n, hi: 23678n });
    // a quarter of the horizon closed: √0.25 × 726 = 363 bp
    expect(discoveryBand(m, { ...g, closedSince: 1791594011n - 43_200n }, px, 1791594011n).bps).toBe(363n);
    // past the horizon: the cap, 726 bp, which is 1,702 ticks each side (inside the 2,000-tick limit)
    const capped = discoveryBand(m, { ...g, closedSince: 1n }, px, 1791594011n);
    expect(capped.bps).toBe(726n);
    expect(capped.hi - capped.refTick).toBe(1702n);
  });
});
