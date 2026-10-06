import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hex, PublicClient } from "viem";
import { NotAClearError, verifyReceipt } from "../src/verify.ts";

// Every chain read behind the first causal print on Monad mainnet (scripts/record-receipt.mjs).
interface Fixture {
  tx: Hex;
  calls: { key: string; result: unknown }[];
}
const revive = (_: string, v: unknown) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/receipt-111055816.json", import.meta.url), "utf8"), revive) as Fixture;
const key = (method: string, args: unknown) => JSON.stringify([method, args], (_, v) => (typeof v === "bigint" ? `${v}n` : v));

/** A client that answers from the recording, with `edit` changing one answer to show what a forgery looks like. */
function replay(edit?: (method: string, result: unknown) => unknown): PublicClient {
  const answers = new Map(fixture.calls.map((c) => [c.key, c.result]));
  const answer = (method: string, args: unknown) => {
    const r = answers.get(key(method, args));
    if (r === undefined) throw new Error(`not recorded: ${key(method, args)}`);
    return Promise.resolve(edit ? edit(method, structuredClone(r)) : r);
  };
  return {
    getTransactionReceipt: (a: unknown) => answer("getTransactionReceipt", a),
    getBlock: (a: unknown) => answer("getBlock", a),
    readContract: (a: { address: unknown; functionName: unknown; args: unknown; blockNumber: unknown }) =>
      answer("readContract", { address: a.address, functionName: a.functionName, args: a.args, blockNumber: a.blockNumber }),
  } as unknown as PublicClient;
}

describe("a receipt, checked from the chain alone", () => {
  it("passes every check on the first causal print on mainnet", async () => {
    const v = await verifyReceipt(replay(), fixture.tx);
    expect(v.ok).toBe(true);
    expect(v.checks).toBe(6);
    expect(v.marketId).toBe(1n);
    expect(v.upToBlock).toBe(111_055_816n);
    expect(v.price).toBe(28_942n);
    expect(v.causal?.observedAt).toBe(1791295082n);
    expect(v.causal!.observedAt - v.causal!.sealedAt).toBe(6n);
  });

  it("fails when Chainlink's observation time is not the receipt's", async () => {
    // the round claims an observation one second later than the one the auction priced at
    const v = await verifyReceipt(
      replay((method, r) => (method === "readContract" && Array.isArray(r) && r.length === 5 && r[2] === 1791295082n ? [r[0], r[1], 1791295083n, r[3], r[4]] : r)),
      fixture.tx,
    );
    expect(v.ok).toBe(false);
    expect(v.steps.find((s) => s.kind === "check" && !s.ok)?.what).toMatch(/reference time is Chainlink's observation time/);
  });

  it("fails when an earlier observation already qualified", async () => {
    // the round before is said to be observed after the seal plus the skew, so it should have priced the auction
    const v = await verifyReceipt(
      replay((method, r) => (method === "readContract" && Array.isArray(r) && r.length === 5 && r[2] === 1791295052n ? [r[0], r[1], 1791295080n, r[3], r[4]] : r)),
      fixture.tx,
    );
    expect(v.ok).toBe(false);
    expect(v.failures).toBe(1);
    expect(v.steps.find((s) => s.kind === "check" && !s.ok)?.what).toMatch(/no earlier observation qualified/);
  });

  it("fails when the receipt chain is broken", async () => {
    const v = await verifyReceipt(replay(), fixture.tx, { prev: `0x${"11".repeat(32)}` });
    expect(v.ok).toBe(false);
    expect(v.steps.find((s) => s.kind === "check" && !s.ok)?.what).toMatch(/receipt hash recomputes/);
  });

  it("refuses a transaction that did not finish an auction", async () => {
    const client = replay((method, r) => (method === "getTransactionReceipt" ? { ...(r as object), logs: [] } : r));
    await expect(verifyReceipt(client, fixture.tx)).rejects.toBeInstanceOf(NotAClearError);
  });
});
