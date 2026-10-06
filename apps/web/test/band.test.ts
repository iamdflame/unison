import { describe, expect, it } from "vitest";
import { bandOfPrint } from "../lib/venue/live.ts";

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
