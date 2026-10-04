import { afterEach, describe, expect, it, vi } from "vitest";
import { marketByTicker } from "../lib/content/markets.ts";
import { DemoMarket, nextAuction, SIM_VAULT_NAV } from "../lib/demo/engine.ts";
import { BEAT_MS } from "../lib/motion/tokens.ts";

/**
 * The simulation must keep the venue's rules, or the terminal teaches the wrong market. These run a market through
 * a few minutes of beats at a fixed clock: a Saturday (DISCOVERY) and a Tuesday morning (LIVE).
 */
const nvda = marketByTicker("aNVDA")!;
type Beat = { beat(now: number, warmup: boolean): void };

function run(at: string, beats: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  const m = new DemoMarket(nvda);
  const start = Date.now();
  const states = [];
  for (let i = 1; i <= beats; i++) {
    const now = start + i * BEAT_MS;
    vi.setSystemTime(now);
    (m as unknown as Beat).beat(now, true);
    states.push(m.store.get());
  }
  return states;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the simulation at night (DISCOVERY)", () => {
  const states = run("2026-10-03T16:00:00Z", 600); // Sat 12:00 ET

  it("holds the reference at the last close", () => {
    expect(states[0]!.regime.name).toBe("DISCOVERY");
    expect(new Set(states.map((s) => s.refTick)).size).toBe(1);
  });

  it("clears no more often than the contract allows, and gathers orders in between", () => {
    const cadence = nvda.regime.discCadence;
    const auctions = [...new Set(states.map((s) => s.lastAuction))];
    expect(auctions.length).toBeGreaterThan(30);
    for (let i = 1; i < auctions.length; i++) expect(auctions[i]! - auctions[i - 1]!).toBeGreaterThanOrEqual(cadence);
    // between auctions the batch forming only grows
    expect(states.some((s) => s.forming > 0 && s.block > s.lastAuction)).toBe(true);
    for (const s of states) expect(nextAuction(s)).toBeGreaterThan(s.block);
  });

  it("prints only at auctions, inside the band", () => {
    const prints = states.at(-1)!.prints.filter((p) => p.block > states[0]!.block);
    expect(prints.length).toBeGreaterThan(10);
    const last = states.at(-1)!;
    for (const p of prints) {
      expect(p.tick).toBeGreaterThanOrEqual(last.lo);
      expect(p.tick).toBeLessThanOrEqual(last.hi);
    }
  });

  it("has its vault quote the closed-market spread, from the contract's curve", () => {
    const s = states.at(-1)!;
    const p = nvda.vault!;
    const half = Math.floor((s.refTick * p.spreadBps * p.closedMult) / 10_000);
    const bids = s.vault.filter((o) => o.side === "buy");
    const asks = s.vault.filter((o) => o.side === "sell");
    expect(bids).toHaveLength(p.widthTicks);
    expect(asks).toHaveLength(p.widthTicks);
    // the gap either side is the regime's half-spread, give or take the inventory lean
    const top = Math.max(...bids.map((o) => o.tick));
    const bottom = Math.min(...asks.map((o) => o.tick));
    expect(bottom - top).toBe(2 * half);
    expect(Math.abs(s.refTick - half - top)).toBeLessThanOrEqual(p.maxSkewTicks);
  });
});

describe("the simulated vault keeps its books", () => {
  for (const [label, at] of [["at night", "2026-10-03T16:00:00Z"], ["in session", "2026-10-06T15:00:00Z"]] as const) {
    it(`adds up ${label}: its value is where it started, plus spread, plus inventory`, () => {
      const s = run(at, 500).at(-1)!;
      const b = s.vaultBook!;
      const unit = Number(nvda.tickSize) / 1e6;
      const nav = b.quote + b.base * s.refTick * unit;
      expect(b.auctionsTraded).toBeGreaterThan(0);
      expect(nav).toBeCloseTo(SIM_VAULT_NAV + b.spreadPnl + b.inventoryPnl, 4);
      // it only ever buys below the reference and sells above it
      expect(b.spreadPnl).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("the simulation in session (LIVE)", () => {
  const states = run("2026-10-06T15:00:00Z", 400); // Tue 11:00 ET

  it("publishes a reference every block and can clear every block", () => {
    expect(states[0]!.regime.name).toBe("LIVE");
    expect(new Set(states.map((s) => s.refTick)).size).toBeGreaterThan(1);
    const auctions = [...new Set(states.map((s) => s.lastAuction))];
    expect(auctions.some((b, i) => i > 0 && b - auctions[i - 1]! === 1)).toBe(true);
    for (const s of states) expect(nextAuction(s)).toBe(s.block + 1);
  });

  it("has its vault quote the open-market spread", () => {
    const s = states.at(-1)!;
    const p = nvda.vault!;
    const half = Math.floor((s.refTick * p.spreadBps) / 10_000);
    const top = Math.max(...s.vault.filter((o) => o.side === "buy").map((o) => o.tick));
    const bottom = Math.min(...s.vault.filter((o) => o.side === "sell").map((o) => o.tick));
    expect(bottom - top).toBe(2 * half);
  });
});
