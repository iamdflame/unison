import { describe, expect, it } from "vitest";
import {
  buildClearingInput,
  clipCurve,
  compute,
  CurveRevert,
  defaultRegime,
  emptyCurve,
  loadCurves,
  mergeCurves,
  RefStatus,
  settleCurves,
  slotLevels,
  startAuction,
  vaultCurve,
  vaultSource,
  type Curve,
  type VaultParams,
} from "../src/index.ts";

function rng(seed: bigint) {
  let s = seed | 1n;
  const mask = (1n << 64n) - 1n;
  return (n: bigint): bigint => {
    s ^= (s >> 12n) & mask;
    s ^= (s << 25n) & mask;
    s ^= (s >> 27n) & mask;
    const v = (s * 2685821657736338717n) & mask;
    return n === 0n ? 0n : v % n;
  };
}

const B = 10n ** 18n;
const USD = 10n ** 6n;
// contracts/test/unit/LiquidityVault.t.sol
const params: VaultParams = {
  spreadBps: 20,
  depthBps: 100,
  widthTicks: 5,
  maxSkewTicks: 10,
  maxAuctionBps: 2_000,
  swingBps: 30,
  extMult: 2,
  closedMult: 4,
  paused: false,
};
const market = {
  tickSize: 10_000n,
  minTick: 1,
  maxTick: (1 << 21) - 1,
  maxBandTicks: 2001,
  bandBps: 100,
  lastStatus: 0,
  baseUnit: B,
};
const T0 = 1_760_000_000n;

describe("LiquidityVault.curve", () => {
  const flat = { params, baseBalance: 0n, quoteBalance: 100_000n * USD, baseUnit: B, refPrice: 180n * USD, refTick: 18_000n };

  it("widens by regime and skews with inventory (test_curve_widensByRegime_andSkewsWithInventory)", () => {
    const o = vaultCurve({ ...flat, status: RefStatus.OPEN });
    expect(o.bidTop).toBe(18_000n - 36n + 10n); // a flat-quote vault skews bids up to buy inventory
    expect(o.askBottom).toBe(18_000n + 36n + 10n);
    expect(o.bidTicks).toBe(5n);
    expect(o.bidPerTick).toBe(5_555_555_555_555_555_555n); // 1% of NAV per tick at $180
    expect(vaultCurve({ ...flat, status: RefStatus.EXTENDED }).bidTop).toBe(18_000n - 72n + 10n);
    expect(vaultCurve({ ...flat, status: RefStatus.CLOSED }).bidTop).toBe(18_000n - 144n + 10n);
    expect(vaultCurve({ ...flat, status: RefStatus.HALTED })).toEqual(emptyCurve()); // never trades while halted
  });

  it("returns no curve when paused, without a reference, for another market, or with nothing to quote", () => {
    expect(vaultCurve({ ...flat, status: 0, params: { ...params, paused: true } })).toEqual(emptyCurve());
    expect(vaultCurve({ ...flat, status: 0, refPrice: 0n })).toEqual(emptyCurve());
    expect(vaultCurve({ ...flat, status: 0, marketId: 1, vaultMarketId: 0 })).toEqual(emptyCurve());
    expect(vaultCurve({ ...flat, status: 0, quoteBalance: 0n })).toEqual(emptyCurve());
    expect(vaultCurve({ ...flat, status: 0, quoteBalance: 10n })).toEqual(emptyCurve()); // perTick rounds to 0
  });

  it("skews the other way when overweight base and caps depth per auction", () => {
    // all base: weight 100% → skew +maxSkew → both quotes move down
    const c = vaultCurve({ ...flat, status: 0, baseBalance: 1_000n * B, quoteBalance: 0n });
    expect(c.bidTop).toBe(18_000n - 36n - 10n);
    expect(c.askBottom).toBe(18_000n + 36n - 10n);
    // 29.99% base → skew = (2999 - 5000)·10/5000 = -4.002 → -4 (int256 division truncates toward zero, not -5)
    const n = vaultCurve({ ...flat, status: 0, baseBalance: (2_999n * B) / 10n, quoteBalance: 126_018n * USD });
    expect(n.bidTop).toBe(18_000n - 36n + 4n);
    // depth 1% × 5 ticks > a 2% auction cap → perTick = cap / width
    const capped = vaultCurve({ ...flat, status: 0, params: { ...params, maxAuctionBps: 200 } });
    expect(capped.bidPerTick).toBe((((100_000n * USD * 200n) / 10_000n / 5n) * B) / (180n * USD));
  });

  it("reverts like the contract on overflow", () => {
    // mulDiv(base, refPrice, baseUnit) above uint256
    expect(() => vaultCurve({ ...flat, status: 0, baseBalance: 1n << 250n, baseUnit: 1n })).toThrow(CurveRevert);
    // q + baseVal
    expect(() => vaultCurve({ ...flat, status: 0, quoteBalance: (1n << 256n) - 1n, baseBalance: B })).toThrow(
      CurveRevert,
    );
    // navQ · depthBps
    expect(() => vaultCurve({ ...flat, status: 0, quoteBalance: 1n << 255n, baseBalance: 1n << 250n })).toThrow(
      CurveRevert,
    );
  });
});

describe("clipping and inventory caps (_loadCurves)", () => {
  const cv: Curve = { bidTop: 105n, bidTicks: 10n, bidPerTick: 7n * B, askBottom: 108n, askTicks: 10n, askPerTick: 3n * B };

  it("clips to the band", () => {
    const s = clipCurve(cv, { lo: 100, hi: 112, tickSize: 10_000, baseUnit: B, baseBalance: 1_000n * B, quoteBalance: 10n ** 12n });
    expect(s).toEqual({ bidLo: 100n, bidHi: 105n, bidQ: 7n * B, askLo: 108n, askHi: 112n, askQ: 3n * B });
    // band entirely below the bid curve's top: top clips to hi
    const t = clipCurve(cv, { lo: 90, hi: 101, tickSize: 10_000, baseUnit: B, baseBalance: 0n, quoteBalance: 10n ** 12n });
    expect([t.bidLo, t.bidHi, t.askQ]).toEqual([96n, 101n, 0n]);
    // a curve reaching below tick 1 starts at tick 1
    const low = clipCurve({ ...cv, bidTop: 3n }, { lo: 1, hi: 50, tickSize: 1, baseUnit: B, baseBalance: 0n, quoteBalance: 10n ** 30n });
    expect([low.bidLo, low.bidHi]).toEqual([1n, 3n]);
    // disjoint from the band
    expect(clipCurve(cv, { lo: 200, hi: 300, tickSize: 1, baseUnit: B, baseBalance: B, quoteBalance: B }).bidQ).toBe(0n);
  });

  it("caps bids so the worst-case cost fits the quote balance, asks by the base balance", () => {
    const r = rng(17n);
    for (let i = 0; i < 2_000; i++) {
      const top = 50n + r(20_000n);
      const c: Curve = { bidTop: top, bidTicks: 1n + r(30n), bidPerTick: 1n + r(100n * B), askBottom: top + 1n, askTicks: 1n + r(30n), askPerTick: 1n + r(100n * B) };
      const lo = top - r(40n);
      const hi = top + r(40n);
      const quote = r(10n ** 12n);
      const base = r(1_000n * B);
      const tickSize = 1n + r(20_000n);
      const s = clipCurve(c, { lo, hi, tickSize, baseUnit: B, baseBalance: base, quoteBalance: quote });
      if (s.bidQ !== 0n) {
        const ticks = s.bidHi - s.bidLo + 1n;
        const worst = (ticks * s.bidQ * s.bidHi * tickSize + B - 1n) / B; // ceil at the top tick
        expect(worst <= quote).toBe(true);
        expect(s.bidQ <= c.bidPerTick).toBe(true);
        expect(s.bidLo >= lo && s.bidHi <= hi).toBe(true);
      }
      if (s.askQ !== 0n) {
        expect((s.askHi - s.askLo + 1n) * s.askQ <= base).toBe(true);
        expect(s.askLo >= lo && s.askHi <= hi && s.askLo >= c.askBottom).toBe(true);
      }
    }
  });

  it("a reverting source adds nothing; slots merge into the input", () => {
    const a = { refPrice: 1n, status: 0, refTick: 105n, lo: 100n, hi: 112n, tickSize: 10_000n, baseUnit: B };
    const slots = loadCurves(
      [
        { curve: cv, baseBalance: 1_000n * B, quoteBalance: 10n ** 12n },
        {
          curve: () => {
            throw new CurveRevert("boom");
          },
          baseBalance: 1n,
          quoteBalance: 1n,
        },
      ],
      a,
    );
    expect(slots[1]!.bidQ + slots[1]!.askQ).toBe(0n);
    const x = mergeCurves(buildClearingInput([{ side: 0, tick: 104, qty: B }], a), slots);
    const lv = slotLevels(slots[0]!, 100n, 112n);
    expect(x.bids[4]).toBe(lv.bids[4]! + B);
    expect(x.asks[12]).toBe(3n * B);
    expect(x.bids.reduce((s, v) => s + v, 0n)).toBe(6n * 7n * B + B);
  });
});

describe("startAuction (LiquidityVault.t.sol scenarios)", () => {
  const regime = defaultRegime(100);

  it("the vault buys from a seller at the uniform price", () => {
    const r = startAuction({
      market,
      regime,
      refPrice: 180n * USD,
      status: RefStatus.OPEN,
      now: T0,
      book: [{ side: 1, tick: 17_900, qty: 10n * B }],
      sources: [vaultSource({ params, baseBalance: 0n, quoteBalance: 100_000n * USD, baseUnit: B })],
    });
    expect(r.regime).toBe("LIVE");
    expect([r.band!.lo, r.band!.hi]).toEqual([17_820n, 18_180n]);
    expect(r.result.tick).toBe(17_973n); // min-imbalance tick inside the vault's bid curve
    expect(r.result.volume).toBe(10n * B);
    expect(r.curveFills[0]).toEqual({ boughtBase: 10n * B, paidQuote: 1_797_300_000n, soldBase: 0n, receivedQuote: 0n });

    // test_attribution_reconcilesNav: then a buyer lifts the vault's asks at 18_047
    const next = startAuction({
      market,
      regime,
      refPrice: 180n * USD,
      status: RefStatus.OPEN,
      now: T0 + 1n,
      book: [{ side: 0, tick: 18_100, qty: 5n * B }],
      sources: [vaultSource({ params, baseBalance: 10n * B, quoteBalance: 100_000n * USD - 1_797_300_000n, baseUnit: B })],
    });
    expect(next.result.tick).toBe(18_047n);
    expect(next.result.volume).toBe(5n * B);
    expect(next.curveFills[0]!.soldBase).toBe(5n * B);
  });

  it("apportions the marginal tick to the sources first and conserves volume", () => {
    const r = rng(23n);
    for (let run = 0; run < 400; run++) {
      const book = Array.from({ length: 1 + Number(r(12n)) }, () => ({
        side: Number(r(2n)),
        tick: 17_700n + r(600n),
        qty: 1n + r(40n * B),
      }));
      const sources = [
        vaultSource({ params, baseBalance: r(500n * B), quoteBalance: r(200_000n * USD), baseUnit: B }),
        {
          curve: { bidTop: 17_990n + r(20n), bidTicks: 1n + r(8n), bidPerTick: r(5n * B), askBottom: 18_000n + r(20n), askTicks: 1n + r(8n), askPerTick: r(5n * B) },
          baseBalance: r(50n * B),
          quoteBalance: r(50_000n * USD),
        },
      ];
      const out = startAuction({ market, regime, refPrice: 180n * USD, status: Number(r(3n)), now: T0, book, sources });
      if (!out.result.traded) continue;
      const x = out.input!;
      // the merged input is exactly book + clipped curves, and the clearing ran on it
      expect(compute(x)).toEqual(out.result);
      expect(settleCurves(x, out.result, out.slots, market).fills).toEqual(out.curveFills);
      // the sources never get more than their in-band curve quantity at ticks the price allows
      for (let i = 0; i < sources.length; i++) {
        const s = out.slots[i]!;
        const f = out.curveFills[i]!;
        if (f.boughtBase > 0n) expect(out.result.tick <= s.bidHi).toBe(true);
        if (f.soldBase > 0n) expect(out.result.tick >= s.askLo).toBe(true);
        expect(f.boughtBase <= (s.bidQ === 0n ? 0n : (s.bidHi - s.bidLo + 1n) * s.bidQ)).toBe(true);
        expect(f.soldBase <= (s.askQ === 0n ? 0n : (s.askHi - s.askLo + 1n) * s.askQ)).toBe(true);
      }
    }
  });

  it("no auction while HALTED; an exhausted daily cap runs none, a partial cap caps the volume", () => {
    const base = {
      market,
      regime,
      refPrice: 180n * USD,
      now: T0,
      book: [
        { side: 0, tick: 18_010, qty: 4n * B },
        { side: 1, tick: 17_990, qty: 4n * B },
      ],
    };
    const h = startAuction({ ...base, status: RefStatus.HALTED });
    expect([h.ran, h.band, h.regime]).toEqual([false, null, "HALTED"]);
    expect(startAuction({ ...base, status: 0, regime: { ...regime, halted: true } }).ran).toBe(false);
    const ex = startAuction({ ...base, status: 0, capRemaining: 0 });
    expect([ex.ran, ex.band?.lo]).toEqual([false, 17_820n]);
    const capped = startAuction({ ...base, status: 0, capRemaining: B });
    expect(capped.result.volume).toBe(B);
    expect(capped.result.tick).toBe(startAuction({ ...base, status: 0 }).result.tick); // price stays uncapped
  });
});
