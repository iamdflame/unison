import { describe, expect, it } from "vitest";
import { compute } from "@unison/engine";
import { createRng, createSim, curves, detExp, detLn, mulberry32, type Batch, type SimConfig } from "../src/index.ts";

const nvda: SimConfig = {
  seed: 42,
  symbol: "aNVDA/AUSD",
  refPrice: 180_000_000n,
  tickSize: 10_000n,
  baseUnit: 10n ** 18n,
  bandBps: 100,
};

const json = (b: unknown) => JSON.stringify(b, (_, v) => (typeof v === "bigint" ? `${v}n` : v));

function run(cfg: SimConfig, n: number): Batch[] {
  const sim = createSim(cfg);
  return Array.from({ length: n }, () => sim.step());
}

describe("determinism", () => {
  it("the same seed replays the same market; another seed does not", () => {
    const a = run(nvda, 400);
    const b = run(nvda, 400);
    expect(json(a)).toBe(json(b));
    expect(json(run({ ...nvda, seed: 43 }, 400))).not.toBe(json(a));
  });

  it("is built from engine-independent arithmetic", () => {
    // golden values: a regression here means the stream changed for every consumer (hero, demo, tests)
    const r = mulberry32(1);
    expect([r(), r(), r()].map((x) => x.toFixed(12))).toEqual(["0.627073940588", "0.002735721180", "0.527447039960"]);
    for (const x of [-30, -1, -1e-9, 0, 1e-6, 0.5, 1, 2.5, 30]) {
      expect(Math.abs(detExp(x) / Math.exp(x) - 1)).toBeLessThan(1e-13);
    }
    for (const x of [1e-12, 0.001, 0.5, 1, 2, 10, 1e9]) {
      expect(Math.abs(detLn(x) - Math.log(x))).toBeLessThan(1e-12 * Math.max(1, Math.abs(Math.log(x))));
    }
    const g = createRng(7);
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < 20_000; i++) {
      const z = g.normal();
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / 20_000)).toBeLessThan(0.03);
    expect(Math.abs(s2 / 20_000 - 1)).toBeLessThan(0.05);
    let k = 0;
    for (let i = 0; i < 20_000; i++) k += g.poisson(2);
    expect(Math.abs(k / 20_000 - 2)).toBeLessThan(0.05);
  });
});

describe("auction invariants", () => {
  const configs: SimConfig[] = [
    nvda,
    { ...nvda, seed: 7, refPrice: 660_000_000n, bandBps: 50, vault: { baseShare: 0.1 } }, // aSPY-like, base-light vault
    { ...nvda, seed: 9, vault: false, arrivalsPerBlock: 4, iocShare: 0.6 }, // book only
    { ...nvda, seed: 11, tickSize: 1_000n, baseUnit: 10n ** 6n, vault: { nav: 50_000, baseShare: 0.9 } },
  ];

  it("one uniform price inside the band; fills equal the engine's volume; nobody fills beyond their limit", () => {
    let traded = 0;
    let vaultTrades = 0;
    for (const cfg of configs) {
      const sim = createSim(cfg);
      for (let i = 0; i < 1_500; i++) {
        const b = sim.step();
        // the batch's clearing is the engine's clearing of the batch's input
        expect(compute(b.input)).toEqual(b.result);
        expect(b.refTick >= b.bandLo && b.refTick <= b.bandHi).toBe(true);
        if (!b.result.traded) {
          expect(b.volume).toBe(0n);
          expect(b.orders.every((o) => o.filled === 0n)).toBe(true);
          continue;
        }
        traded++;
        const t = b.result.tick;
        expect(t >= b.bandLo && t <= b.bandHi).toBe(true);
        expect(b.price).toBe(t * BigInt(cfg.tickSize));
        let bought = b.vault?.fill.boughtBase ?? 0n;
        let sold = b.vault?.fill.soldBase ?? 0n;
        if (b.vault && (b.vault.fill.boughtBase > 0n || b.vault.fill.soldBase > 0n)) vaultTrades++;
        for (const o of b.orders) {
          expect(o.filled >= 0n && o.filled <= o.qty).toBe(true);
          if (o.filled === 0n) continue;
          if (o.side === 0) {
            expect(o.tick >= t).toBe(true); // a buyer never pays above its limit
            bought += o.filled;
          } else {
            expect(o.tick <= t).toBe(true); // a seller never sells below its limit
            sold += o.filled;
          }
        }
        expect(bought).toBe(b.volume);
        expect(sold).toBe(b.volume);
        if (b.vault) {
          if (b.vault.fill.boughtBase > 0n) expect(b.vault.slot.bidHi >= t).toBe(true);
          if (b.vault.fill.soldBase > 0n) expect(b.vault.slot.askLo <= t).toBe(true);
        }
      }
    }
    expect(traded).toBeGreaterThan(2_000);
    expect(vaultTrades).toBeGreaterThan(300);
  }, 60_000); // a property run over many configurations: seconds locally, longer on a shared CI runner

  it("keeps the vault solvent and its inventory consistent with its fills", () => {
    const sim = createSim(nvda);
    let base = sim.state.vault!.base;
    let quote = sim.state.vault!.quote;
    for (let i = 0; i < 2_000; i++) {
      const b = sim.step();
      const f = b.vault!.fill;
      base += f.boughtBase - f.soldBase;
      quote += f.receivedQuote - f.paidQuote;
      expect([b.vault!.base, b.vault!.quote]).toEqual([base, quote]);
      expect(base >= 0n && quote >= 0n).toBe(true);
    }
  });

  it("book bookkeeping: IOC and filled orders leave, the rest carries its remainder", () => {
    const sim = createSim({ ...nvda, seed: 5 });
    for (let i = 0; i < 300; i++) {
      const b = sim.step();
      const next = new Map(sim.state.book.map((o) => [o.id, o]));
      for (const o of b.orders) {
        const kept = next.get(o.id);
        if (o.ioc || o.filled === o.qty) expect(kept).toBeUndefined();
        else if (kept) expect(kept.qty).toBe(o.qty - o.filled);
      }
    }
  });
});

describe("curves", () => {
  it("cross at the clearing tick: executed volume = max over the band of min(demand, supply)", () => {
    const sim = createSim({ ...nvda, seed: 3 });
    for (let i = 0; i < 300; i++) {
      const b = sim.step();
      const c = curves(b);
      expect(c.ticks[0]).toBe(b.bandLo);
      expect(c.ticks[c.ticks.length - 1]).toBe(b.bandHi);
      let best = 0n;
      for (let k = 0; k < c.ticks.length; k++) {
        const e = c.demand[k]! < c.supply[k]! ? c.demand[k]! : c.supply[k]!;
        if (e > best) best = e;
        if (k > 0) {
          expect(c.demand[k]! <= c.demand[k - 1]!).toBe(true);
          expect(c.supply[k]! >= c.supply[k - 1]!).toBe(true);
        }
      }
      expect(best).toBe(b.volume);
      if (b.result.traded) {
        const k = Number(b.result.tick - b.bandLo);
        expect(c.demand[k]! >= b.volume && c.supply[k]! >= b.volume).toBe(true);
      }
    }
  });
});

describe("throughput", () => {
  it("runs at least 2,000 steps per second", () => {
    const sim = createSim(nvda);
    for (let i = 0; i < 300; i++) sim.step(); // warm up the JIT and the book
    const n = 4_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) sim.step();
    const perSecond = n / ((performance.now() - t0) / 1000);
    expect(perSecond).toBeGreaterThan(2_000);
  });
});
