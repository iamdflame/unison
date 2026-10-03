import { describe, expect, it } from "vitest";
import { apportionAll, band, BookLevel, compute, POT, type ClearingInput } from "../src/index.ts";

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

function brute(x: ClearingInput) {
  let best: { e: bigint; imb: bigint; dist: bigint; t: bigint } | undefined;
  const n = x.bids.length;
  for (let i = 0; i < n; i++) {
    const t = x.lo + BigInt(i);
    let d = x.bidAbove;
    for (let k = i; k < n; k++) d += x.bids[k]!;
    let s = x.askBelow;
    for (let k = 0; k <= i; k++) s += x.asks[k]!;
    const e = d < s ? d : s;
    if (e === 0n) continue;
    const imb = d > s ? d - s : s - d;
    const dist = t > x.refTick ? t - x.refTick : x.refTick - t;
    const better =
      best === undefined ||
      e > best.e ||
      (e === best.e && (imb < best.imb || (imb === best.imb && dist < best.dist)));
    if (better) best = { e, imb, dist, t };
  }
  return best;
}

describe("clearing", () => {
  it("matches brute force and conserves volume on both sides", () => {
    const r = rng(42n);
    for (let run = 0; run < 2_000; run++) {
      const n = 1 + Number(r(12n));
      const lo = 100n + r(50n);
      const x: ClearingInput = {
        lo,
        hi: lo + BigInt(n - 1),
        refTick: lo + r(BigInt(n)),
        bidAbove: r(3n) === 0n ? r(1000n) : 0n,
        askBelow: r(3n) === 0n ? r(1000n) : 0n,
        bids: Array.from({ length: n }, () => (r(2n) === 0n ? r(500n) : 0n)),
        asks: Array.from({ length: n }, () => (r(2n) === 0n ? r(500n) : 0n)),
      };
      const res = compute(x);
      const b = brute(x);
      expect(res.traded).toBe(b !== undefined);
      if (b === undefined) continue;
      expect(res.tick).toBe(b.t);
      expect(res.volume).toBe(b.e);
      // allocation: levels before the marginal one are full, marginal gets the rest → exactly V per side
      const bidFull =
        res.bidMarginal === 0n
          ? 0n
          : x.bidAbove + x.bids.slice(n - Number(res.bidMarginal) + 1).reduce((a, c) => a + c, 0n);
      expect(bidFull + res.bidMarginalFill).toBe(res.volume);
      const askFull =
        res.askMarginal === 0n
          ? 0n
          : x.askBelow + x.asks.slice(0, Number(res.askMarginal) - 1).reduce((a, c) => a + c, 0n);
      expect(askFull + res.askMarginalFill).toBe(res.volume);
    }
  });

  it("computes the reference-centred band like the contract", () => {
    const b = band({
      refPrice: 180_000000n,
      tickSize: 10_000n,
      minTick: 1n,
      maxTick: (1n << 21n) - 1n,
      bandBps: 100n,
      maxBandTicks: 2001n,
    });
    expect(b).toEqual({ refTick: 18_000n, lo: 17_820n, hi: 18_180n });
  });
});

describe("apportionment", () => {
  it("sums exactly to need, never exceeds a source, stays within one unit of pro-rata", () => {
    const r = rng(7n);
    for (let run = 0; run < 2_000; run++) {
      const qs = Array.from({ length: 1 + Number(r(9n)) }, () => r(10n ** 20n));
      const total = qs.reduce((a, c) => a + c, 0n);
      const need = total === 0n ? 0n : r(total + 1n);
      const shares = apportionAll(need, qs);
      expect(shares.reduce((a, c) => a + c, 0n)).toBe(need);
      shares.forEach((s, i) => {
        expect(s <= qs[i]!).toBe(true);
        if (total > 0n) {
          const exact = (need * qs[i]!) / total;
          expect(s >= exact - 1n && s <= exact + 1n).toBe(true);
        }
      });
    }
  });
});

describe("book level", () => {
  const B = 10n ** 18n;
  const P = 180_000000n;

  it("bid: partial then full fill", () => {
    const l = new BookLevel(true);
    const s = l.add(10n * B);
    l.fill(3n * B, P, B);
    expect(l.value(s, 10n * B, B)).toEqual({ remainder: 7n * B, quote: 540_000000n, closed: false });
    expect(l.draw(s.epoch, 3n * B, POT)).toBe(3n * B);
    expect(l.fill(7n * B, 181_000000n, B)).toBe(true);
    expect(l.value(s, 10n * B, B)).toEqual({ remainder: 0n, quote: 1807_000000n, closed: true });
  });

  it("conserves base and covers quote under random op sequences", () => {
    for (const isBid of [true, false]) {
      const r = rng(isBid ? 11n : 13n);
      for (let run = 0; run < 300; run++) {
        const l = new BookLevel(isBid);
        const ords: { qty: bigint; snap: ReturnType<BookLevel["add"]>; open: boolean; credited: bigint; paid: bigint }[] =
          [];
        let added = 0n;
        let filled = 0n;
        let removed = 0n;
        let owedX = 0n;
        let potQ = 0n;
        const settle = (o: (typeof ords)[number]) => {
          const v = l.value(o.snap, o.qty, B);
          const target = isBid ? o.qty - v.remainder : v.quote;
          if (target > o.credited) o.credited += l.draw(o.snap.epoch, target - o.credited, POT);
          return v;
        };
        for (let i = 0; i < 40; i++) {
          const op = r(10n);
          if (op < 3n || ords.length === 0) {
            const q = 1n + r(50n * B);
            ords.push({ qty: q, snap: l.add(q), open: true, credited: 0n, paid: 0n });
            added += q;
          } else if (op < 7n) {
            const rem = l.remaining;
            if (rem === 0n) continue;
            const f = r(4n) === 0n ? rem : 1n + r(rem);
            const p = 100_000000n + r(200_000000n);
            l.fill(f, p, B);
            filled += f;
            owedX += f * p;
            potQ += (f * p) / B;
          } else {
            const o = ords[Number(r(BigInt(ords.length)))]!;
            if (!o.open) continue;
            const v = settle(o);
            o.paid = v.quote;
            removed += l.leave(o.snap.epoch, v.remainder);
            o.open = false;
          }
        }
        let drawn = 0n;
        let paid = 0n;
        for (const o of ords) {
          const v = settle(o);
          if (o.open) {
            o.paid = v.quote;
            removed += l.leave(o.snap.epoch, v.remainder);
            o.open = false;
          }
          drawn += o.credited;
          paid += o.paid;
        }
        expect(l.remaining).toBe(0n);
        expect(added).toBe(filled + removed);
        if (isBid) {
          expect(drawn <= filled).toBe(true);
          expect(paid * B >= owedX).toBe(true);
        } else {
          expect(drawn <= potQ).toBe(true);
        }
      }
    }
  });
});
