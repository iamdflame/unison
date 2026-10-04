import { describe, expect, it } from "vitest";
import { marketByTicker } from "../lib/content/markets.ts";
import { vaultCurve } from "../lib/unison/vaultCurve.ts";

// aNVDA's mainnet vault: spread 10 bp, depth 40 bp/tick, 10 ticks, skew 15, cap 1000 bp, swing 30, ext ×2, closed ×4
const p = marketByTicker("aNVDA")!.vault!;
const E18 = 10n ** 18n;
const at180 = { refPrice: 180_000_000n, refTick: 18_000, baseUnit: E18 };

describe("LiquidityVault.curve port", () => {
  it("reads the vault parameters from the deploy config", () => {
    expect(p).toEqual({ spreadBps: 10, depthBps: 40, widthTicks: 10, maxSkewTicks: 15, maxAuctionBps: 1000, swingBps: 30, extMult: 2, closedMult: 4 });
  });

  it("quotes symmetrically around the reference at 50/50 inventory", () => {
    // NAV = 1,000,000 quote + 5,555.55… base × 180 ≈ 2,000,000 AUSD; half = 18000 × 10 / 10000 = 18 ticks
    const c = vaultCurve(p, { ...at180, status: "OPEN", baseBalance: (1_000_000_000_000n * E18) / 180_000_000n, quoteBalance: 1_000_000_000_000n });
    expect(c.half).toBe(18);
    expect(c.skew).toBe(0);
    expect([c.bidTop, c.askBottom, c.bidTicks, c.askTicks]).toEqual([17_982, 18_018, 10, 10]);
    // per tick: min(40 bp of NAV, 1000 bp / 10 ticks) = 40 bp of ~2,000,000 = ~8,000 AUSD → ~44.44 base
    expect(Number(c.perTick) / 1e18).toBeCloseTo(44.444, 2);
  });

  it("widens by the regime multiplier and stops when halted", () => {
    const inv = { ...at180, baseBalance: 0n, quoteBalance: 1_000_000_000_000n };
    expect(vaultCurve(p, { ...inv, status: "EXTENDED" }).half).toBe(36);
    expect(vaultCurve(p, { ...inv, status: "CLOSED" }).half).toBe(72);
    expect(vaultCurve(p, { ...inv, status: "HALTED" }).bidTicks).toBe(0);
  });

  it("skews both sides toward rebalancing", () => {
    // all quote: base weight 0 → skew = (0 − 5000) × 15 / 5000 = −15: both sides move up (buy base sooner)
    const allQuote = vaultCurve(p, { ...at180, status: "OPEN", baseBalance: 0n, quoteBalance: 1_000_000_000_000n });
    expect(allQuote.skew).toBe(-15);
    expect([allQuote.bidTop, allQuote.askBottom]).toEqual([17_997, 18_033]);
    // all base: weight 10000 → skew +15: both sides move down (sell base sooner)
    const allBase = vaultCurve(p, { ...at180, status: "OPEN", baseBalance: 1_000n * E18, quoteBalance: 0n });
    expect(allBase.skew).toBe(15);
    expect([allBase.bidTop, allBase.askBottom]).toEqual([17_967, 18_003]);
  });

  it("truncates negative skew toward zero, like Solidity", () => {
    // weight 4999 bp → (−1 × 15) / 5000 = −0.003 → 0
    const c = vaultCurve(p, { ...at180, status: "OPEN", baseBalance: (4_999n * E18) / 180n, quoteBalance: 5_001_000_000n });
    expect(c.skew).toBe(0);
  });
});
