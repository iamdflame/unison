/**
 * Seeded randomness that is bit-identical on every JavaScript engine. `Math.exp`, `Math.log` and `Math.cos` are
 * implementation-approximated by the language spec (V8, SpiderMonkey and JavaScriptCore may differ in the last
 * bit), so the simulation never calls them: it uses integer ops, IEEE-754 + − × ÷ (exactly rounded everywhere)
 * and the series below. A server-rendered hero and the browser that hydrates it therefore see the same market.
 */

/** mulberry32: a tiny 32-bit PRNG in [0, 1). Integer ops only. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const LN2 = 0.6931471805599453;

/** eˣ from + − × ÷ only: x = k·ln2 + r with |r| ≤ ln2/2, a 20-term Taylor series for eʳ, then exact doublings. */
export function detExp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 709) return Number.POSITIVE_INFINITY;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 20; n++) {
    term = (term * r) / n;
    sum += term;
  }
  if (k > 0) for (let i = 0; i < k; i++) sum *= 2;
  else for (let i = 0; i < -k; i++) sum /= 2;
  return sum;
}

/** ln x from + − × ÷ only: x = m·2ᵉ with m ∈ [1, 2), ln m = 2·atanh((m − 1)/(m + 1)) by its series. */
export function detLn(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  let m = x;
  let e = 0;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  const y = (m - 1) / (m + 1); // [0, 1/3)
  const y2 = y * y;
  let term = y;
  let sum = y;
  for (let n = 3; n <= 41; n += 2) {
    term *= y2;
    sum += term / n;
  }
  return 2 * sum + e * LN2;
}

/** A seeded random source with the distributions the simulation needs. */
export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
  /** standard normal (Irwin–Hall: 12 uniforms − 6; additions only, tails cut at ±6σ) */
  normal(): number;
  /** exponential with the given mean */
  exponential(mean: number): number;
  /** Poisson with the given mean (Knuth) */
  poisson(mean: number): number;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const knuth = new Map<number, number>();
  return {
    next,
    normal() {
      let s = -6;
      for (let i = 0; i < 12; i++) s += next();
      return s;
    },
    exponential(mean: number) {
      return -mean * detLn(1 - next());
    },
    poisson(mean: number) {
      if (!(mean > 0)) return 0;
      let limit = knuth.get(mean);
      if (limit === undefined) {
        limit = detExp(-mean);
        knuth.set(mean, limit);
      }
      let k = 0;
      let p = next();
      while (p > limit) {
        k++;
        p *= next();
      }
      return k;
    },
  };
}
