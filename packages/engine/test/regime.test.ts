import { describe, expect, it } from "vitest";
import {
  defaultRegime,
  deriveRegime,
  discoveryBandBps,
  discoveryTooEarly,
  nextDiscoveryBatch,
  RefStatus,
  regimeAfterClear,
  regimeBand,
  regimeBandBps,
  sqrt,
  type RegimeConfig,
} from "../src/index.ts";

/** Deterministic PRNG (xorshift64*) so failures are reproducible. */
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

/** Reference ⌊√a⌋ by bisection. */
function isqrt(a: bigint): bigint {
  let lo = 0n;
  let hi = 1n << 129n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid * mid <= a) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

// NVDA calibration (Regime.t.sol): bandBps 100, regime [200, 726, 100, 726, 235_800, 10]
const T0 = 1_760_000_000n;
const nvda: RegimeConfig = {
  extBandBps: 200,
  reopenBandBps: 726,
  discFloorBps: 100,
  discCapBps: 726,
  discHorizonSec: 235_800,
  discCadence: 10,
  halted: false,
  closedSince: 0n,
  lastDiscoveryBatch: 0n,
};
const market = { tickSize: 10_000n, minTick: 1, maxTick: (1 << 21) - 1, maxBandTicks: 4001, bandBps: 100, lastStatus: 0 };

describe("sqrt (OpenZeppelin Math.sqrt)", () => {
  it("is ⌊√a⌋ across the uint256 range", () => {
    const r = rng(99n);
    const cases = [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, (1n << 256n) - 1n, 1n << 255n, 10n ** 18n];
    for (let bits = 1n; bits <= 256n; bits++) {
      const a = r(1n << bits);
      const s = isqrt(a);
      cases.push(a, s * s, s * s + 1n, s * s === 0n ? 0n : s * s - 1n);
    }
    for (const a of cases) expect(sqrt(a)).toBe(isqrt(a));
    expect(() => sqrt(-1n)).toThrow(RangeError);
    expect(() => sqrt(1n << 256n)).toThrow(RangeError);
  });
});

describe("band per regime (contracts/test/unit/Regime.t.sol)", () => {
  const at = (status: number, now: bigint, g: RegimeConfig = nvda, lastStatus = 0) =>
    regimeBand({ market: { ...market, lastStatus }, regime: g, refPrice: 180_000_000n, status, now });

  it("LIVE and EXTENDED", () => {
    const live = at(RefStatus.OPEN, T0);
    expect(live.bandBps).toBe(100n);
    expect(live.hi - live.lo).toBe(360n); // ±1% of 18,000 ticks
    expect(at(RefStatus.EXTENDED, T0).bandBps).toBe(200n);
  });

  it("DISCOVERY widens with √(time closed) from the floor to the cap", () => {
    const since = T0;
    const g = { ...nvda, closedSince: since };
    expect(at(RefStatus.CLOSED, since, g).bandBps).toBe(100n); // floor right after the close
    expect(at(RefStatus.CLOSED, since + 235_800n / 4n, g).bandBps).toBe(363n); // cap · √(1/4)
    expect(at(RefStatus.CLOSED, since + 400_000n, g).bandBps).toBe(726n); // past the horizon
    expect(at(RefStatus.CLOSED, since + 40n * 3600n, g).bandBps).toBe(567n); // 40 h into the weekend
    // before the first CLOSED clear the clock has not started: the floor
    expect(at(RefStatus.CLOSED, T0 + 999_999n).bandBps).toBe(100n);
    // a clock in the future (closedSince > now) counts as zero elapsed
    expect(discoveryBandBps({ ...nvda, closedSince: T0 + 10n }, T0)).toBe(100n);
    // no horizon: the cap at once
    expect(discoveryBandBps({ ...nvda, discHorizonSec: 0 }, T0)).toBe(726n);
  });

  it("REOPENING after CLOSED or HALTED, then back to LIVE", () => {
    expect(at(RefStatus.OPEN, T0, nvda, RefStatus.CLOSED).bandBps).toBe(726n);
    expect(at(RefStatus.EXTENDED, T0, nvda, RefStatus.HALTED).bandBps).toBe(726n);
    expect(at(RefStatus.OPEN, T0, nvda, RefStatus.OPEN).bandBps).toBe(100n);
  });

  it("falls back to the live band when a regime value is 0", () => {
    const zero = { ...nvda, extBandBps: 0, reopenBandBps: 0, discFloorBps: 0, discCapBps: 0 };
    for (const [st, last] of [
      [RefStatus.EXTENDED, 0],
      [RefStatus.OPEN, RefStatus.CLOSED],
      [RefStatus.CLOSED, 0],
    ] as const) {
      expect(regimeBandBps({ market: { bandBps: 100, lastStatus: last }, regime: zero, status: st, now: T0 })).toBe(100n);
    }
  });

  it("clips the band to [minTick, maxTick] and maxBandTicks", () => {
    const narrow = regimeBand({
      market: { ...market, maxBandTicks: 101 },
      regime: nvda,
      refPrice: 180_000_000n,
      status: RefStatus.OPEN,
      now: T0,
    });
    expect([narrow.lo, narrow.hi]).toEqual([17_950n, 18_050n]);
    const low = regimeBand({ market: { ...market, minTick: 17_900 }, regime: nvda, refPrice: 1n, status: 0, now: T0 });
    expect([low.refTick, low.lo, low.hi]).toEqual([17_900n, 17_900n, 18_079n]);
    expect(() =>
      regimeBand({ market: { ...market, tickSize: 0 }, regime: nvda, refPrice: 1n, status: 0, now: T0 }),
    ).toThrow();
  });

  it("matches a direct transcription of _regimeBandBps on random inputs", () => {
    const r = rng(5n);
    for (let i = 0; i < 5_000; i++) {
      const g: RegimeConfig = {
        extBandBps: r(5_001n),
        reopenBandBps: r(5_001n),
        discFloorBps: r(3_000n),
        discCapBps: r(5_001n),
        discHorizonSec: r(3n) === 0n ? 0n : r(500_000n),
        discCadence: r(20n),
        halted: r(2n) === 0n,
        closedSince: r(3n) === 0n ? 0n : T0 - 300_000n + r(600_000n),
        lastDiscoveryBatch: 0n,
      };
      const m = { bandBps: 1n + r(5_000n), lastStatus: r(4n) };
      const st = Number(r(4n));
      const now = T0 + r(400_000n);
      let want: bigint;
      if (st === 2) {
        const since = g.closedSince === 0n ? now : BigInt(g.closedSince);
        let e = now > since ? now - since : 0n;
        const h = BigInt(g.discHorizonSec);
        if (h === 0n) want = BigInt(g.discCapBps);
        else {
          if (e > h) e = h;
          want = (BigInt(g.discCapBps) * isqrt((e * 10n ** 18n) / h)) / 10n ** 9n;
        }
        if (want < BigInt(g.discFloorBps)) want = BigInt(g.discFloorBps);
      } else if (m.lastStatus === 2n || m.lastStatus === 3n) want = BigInt(g.reopenBandBps);
      else want = st === 1 ? BigInt(g.extBandBps) : m.bandBps;
      if (want === 0n) want = m.bandBps;
      expect(regimeBandBps({ market: m, regime: g, status: st, now })).toBe(want);
    }
  });
});

describe("regime derivation", () => {
  it("halt override, DISCOVERY, REOPENING, EXTENDED, LIVE", () => {
    const d = (status: number, lastStatus: number, halted = false) => deriveRegime({ status, lastStatus, halted });
    expect(d(RefStatus.OPEN, RefStatus.OPEN)).toBe("LIVE");
    expect(d(RefStatus.EXTENDED, RefStatus.OPEN)).toBe("EXTENDED");
    expect(d(RefStatus.EXTENDED, RefStatus.EXTENDED)).toBe("EXTENDED");
    expect(d(RefStatus.CLOSED, RefStatus.OPEN)).toBe("DISCOVERY");
    expect(d(RefStatus.CLOSED, RefStatus.CLOSED)).toBe("DISCOVERY");
    expect(d(RefStatus.OPEN, RefStatus.CLOSED)).toBe("REOPENING");
    expect(d(RefStatus.EXTENDED, RefStatus.HALTED)).toBe("REOPENING");
    expect(d(RefStatus.HALTED, RefStatus.OPEN)).toBe("HALTED");
    expect(d(RefStatus.OPEN, RefStatus.OPEN, true)).toBe("HALTED");
    expect(d(RefStatus.CLOSED, RefStatus.OPEN, true)).toBe("HALTED");
    expect(() => d(4, 0)).toThrow();
  });

  it("accepts viem-shaped reads (numbers for small ints, bigints for uint64)", () => {
    const fromChain = { ...nvda, closedSince: 1_760_000_000n, lastDiscoveryBatch: 123n };
    expect(regimeBandBps({ market: { bandBps: 100, lastStatus: 2 }, regime: fromChain, status: 0, now: 1n })).toBe(726n);
  });
});

describe("DISCOVERY cadence and state transitions", () => {
  const g = { ...nvda, lastDiscoveryBatch: 1_000n, closedSince: T0 };

  it("call auctions run every discCadence blocks while CLOSED", () => {
    expect(discoveryTooEarly({ regime: g, status: RefStatus.CLOSED, upTo: 1_003n })).toBe(true);
    expect(discoveryTooEarly({ regime: g, status: RefStatus.CLOSED, upTo: 1_009n })).toBe(true);
    expect(discoveryTooEarly({ regime: g, status: RefStatus.CLOSED, upTo: 1_010n })).toBe(false);
    expect(nextDiscoveryBatch({ regime: g, lastCleared: 1_000n })).toBe(1_010n);
    // no cadence outside CLOSED, while halted, before the first DISCOVERY auction, or with cadence <= 1
    expect(discoveryTooEarly({ regime: g, status: RefStatus.OPEN, upTo: 1_001n })).toBe(false);
    expect(discoveryTooEarly({ regime: { ...g, halted: true }, status: RefStatus.CLOSED, upTo: 1_001n })).toBe(false);
    expect(discoveryTooEarly({ regime: { ...g, lastDiscoveryBatch: 0n }, status: 2, upTo: 1n })).toBe(false);
    expect(discoveryTooEarly({ regime: { ...g, discCadence: 1 }, status: 2, upTo: 1_000n })).toBe(false);
    expect(nextDiscoveryBatch({ regime: { ...g, discCadence: 1 }, lastCleared: 1_000n })).toBe(1_001n);
    expect(nextDiscoveryBatch({ regime: g, lastCleared: 2_000n })).toBe(2_001n);
  });

  it("a causal auction whose boundary the observation fixed is never too early", () => {
    expect(discoveryTooEarly({ regime: g, status: RefStatus.CLOSED, upTo: 1_003n, bound: true })).toBe(false);
    expect(discoveryTooEarly({ regime: g, status: RefStatus.CLOSED, upTo: 1_003n, bound: false })).toBe(true);
  });

  it("a completed clear starts, keeps or ends the closed period", () => {
    const open = { ...nvda };
    // first CLOSED clear: the clock starts at the reference publish time
    expect(regimeAfterClear({ regime: open, status: 2, refTimeMs: 1_760_000_123_456n, upTo: 50n })).toEqual({
      closedSince: 1_760_000_123n,
      lastDiscoveryBatch: 50n,
      lastStatus: 2,
    });
    // later CLOSED clears keep the clock
    expect(regimeAfterClear({ regime: g, status: 2, refTimeMs: 9n ** 15n, upTo: 1_010n }).closedSince).toBe(T0);
    // HALTED keeps it too (and is what lastStatus records under the override)
    expect(regimeAfterClear({ regime: { ...g, halted: true }, status: 0, refTimeMs: 0n, upTo: 1_011n })).toEqual({
      closedSince: T0,
      lastDiscoveryBatch: 1_000n,
      lastStatus: 3,
    });
    // OPEN / EXTENDED end it
    expect(regimeAfterClear({ regime: g, status: 1, refTimeMs: 0n, upTo: 1_012n }).closedSince).toBe(0n);
  });

  it("defaultRegime mirrors createMarket", () => {
    expect(defaultRegime(100)).toEqual({
      extBandBps: 200n,
      reopenBandBps: 500n,
      discFloorBps: 100n,
      discCapBps: 500n,
      discHorizonSec: 235_800n,
      discCadence: 10n,
      halted: false,
      closedSince: 0n,
      lastDiscoveryBatch: 0n,
    });
    expect(defaultRegime(3_000).discCapBps).toBe(5_000n);
  });
});
