import { describe, expect, it } from "vitest";
import { bandOfPrint } from "../lib/venue/live.ts";
import { bandHalfTicks, refTickOf } from "../lib/venue/ticks.ts";

describe("the band a print was cleared in", () => {
  it("reads the market's own band back from a print's edge, as the venue computes it", () => {
    // WMON's first causal print on mainnet: ref 28,994 (tick $0.000001), edge 29,138, on the ±50 bp band set at the cutover
    expect(bandOfPrint(29_138, 28_994n, 1n)).toBe(50);
    // the old-rule control's first print: ref 29,120, edge 29,265
    expect(bandOfPrint(29_265, 29_120n, 1n)).toBe(50);
    // an aNVDA print at launch: ref $239.937756 rounds to tick 23,994 ($0.01 ticks), edge 24,233, ±100 bp
    expect(bandOfPrint(24_233, 239_937_756n, 10_000n)).toBe(100);
  });
  it("says nothing without a band or a tick size", () => {
    expect(bandOfPrint(0, 28_994n, 1n)).toBeNull();
    expect(bandOfPrint(29_138, 28_994n, 0n)).toBeNull();
  });
});

describe("the reference and band a page shows", () => {
  it("rounds the reference half up to a tick, as ExchangeClearing._band does (not down)", () => {
    // aNVDA at launch: $239.937756 is tick 23,994 to the venue; truncating gave 23,993
    expect(refTickOf(239_937_756n, 10_000n)).toBe(23_994);
    expect(refTickOf(239_935_000n, 10_000n)).toBe(23_994); // exactly half a tick rounds up
    expect(refTickOf(239_934_999n, 10_000n)).toBe(23_993);
    expect(refTickOf(28_994n, 1n)).toBe(28_994);
    expect(refTickOf(28_994n, 0n)).toBe(0);
  });
  it("floors the band's half-width, at least one tick (the print's own edge, not one tick wider)", () => {
    // the same aNVDA print: ±100 bp of 23,994 is 239.94 ticks, so the venue's edge is 24,233
    expect(23_994 + bandHalfTicks(23_994, 100)).toBe(24_233);
    expect(bandHalfTicks(28_994, 50)).toBe(144);
    expect(bandHalfTicks(10, 50)).toBe(1);
  });
});
