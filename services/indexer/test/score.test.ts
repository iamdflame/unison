import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { edgeBps, edgeOf, inWindow, marksFill, priceOf, qualifies, quoteInForce, TERMS } from "../src/score.ts";

interface Row {
  placedAt: string;
  side: number;
  base: string;
  quote: string;
  markAnswer: string;
  markObservedAt: string;
  quoteAnswer: string;
  quoteObservedAt: string;
}
interface Leg {
  rule: string;
  account: string;
  contract: { edge: string; notional: string; fills: string };
  rows: Row[];
}
// the house adversary's real fills on Monad mainnet, with the contract's own score (scripts/vectors.mjs)
const legs = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8")) as Leg[];

describe("the indexer scores exactly as LatencyChallenge.edgeOf", () => {
  for (const leg of legs) {
    it(`matches the contract on the ${leg.rule} leg (${leg.rows.length} real fills)`, () => {
      let edge = 0n;
      let notional = 0n;
      for (const r of leg.rows) {
        expect(inWindow(BigInt(r.placedAt))).toBe(true);
        expect(marksFill(BigInt(r.markObservedAt), BigInt(r.placedAt))).toBe(true);
        expect(BigInt(r.quoteObservedAt) <= BigInt(r.markObservedAt)).toBe(true);
        const price = priceOf(BigInt(r.markAnswer), BigInt(r.quoteAnswer));
        edge += edgeOf(r.side, BigInt(r.base), BigInt(r.quote), price);
        notional += BigInt(r.quote);
      }
      expect(edge).toBe(BigInt(leg.contract.edge));
      expect(notional).toBe(BigInt(leg.contract.notional));
      expect(BigInt(leg.rows.length)).toBe(BigInt(leg.contract.fills));
    });
  }

  it("marks a fill with the first observation made at least horizonSec after the order", () => {
    expect(marksFill(1_060n, 1_000n)).toBe(true);
    expect(marksFill(1_059n, 1_000n)).toBe(false);
  });

  it("counts only fills inside the window", () => {
    expect(inWindow(TERMS.start)).toBe(true);
    expect(inWindow(TERMS.start - 1n)).toBe(false);
    expect(inWindow(TERMS.end + 1n)).toBe(false);
  });

  it("finds the AUSD/USD round in force by walking back from the newest", () => {
    const rounds: Record<string, { observedAt: bigint; previous?: string }> = {
      a: { observedAt: 100n },
      b: { observedAt: 200n, previous: "a" },
      c: { observedAt: 300n, previous: "b" },
    };
    expect(quoteInForce(rounds.c, (id) => rounds[id], 250n)).toBe(rounds.b);
    expect(quoteInForce(rounds.c, (id) => rounds[id], 300n)).toBe(rounds.c);
    expect(quoteInForce(rounds.c, (id) => rounds[id], 50n)).toBeUndefined();
  });

  it("states edge in basis points and applies the pot's terms", () => {
    expect(edgeBps(-1033n, 520574n)).toBe("-19.84");
    expect(edgeBps(1n, 3n)).toBe("3333.33");
    expect(edgeBps(0n, 0n)).toBe("0");
    expect(qualifies(30n, 1_000n, 1_000_000n)).toBe(true); // 10 bp over 30 fills
    expect(qualifies(29n, 1_000n, 1_000_000n)).toBe(false);
    expect(qualifies(30n, 200n, 1_000_000n)).toBe(false); // exactly 2 bp: the contract needs more
  });
});
