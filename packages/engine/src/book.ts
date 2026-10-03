/**
 * One price level with Unison's exact, conservative lazy accounting — bit-exact port of the per-level
 * logic in `contracts/src/core/BookStore.sol` (SPEC §3). Used for fill previews (SDK), the keeper, the
 * mock server and differential testing against the contracts.
 */
import { min, mulDiv, pow10, type Rounding } from "./math.ts";

export const S_SCALE = 10n ** 38n;
export const S_MIN = 10n ** 29n;
export const K = 10n ** 9n;
export const MAX_WALK = 4n;

export const POT = 0;
export const RET = 1;
export type PotKind = typeof POT | typeof RET;

/** Raw level words, exactly as stored on-chain (a closed level's `remaining` is its return pot). */
export interface LevelWords {
  remaining: bigint;
  epoch: bigint;
  scale: bigint;
  closed: boolean;
  survival: bigint;
  pot: bigint;
  acc: bigint;
}

export interface Snap {
  epoch: bigint;
  scale: bigint;
  survival: bigint;
  acc: bigint;
}

export interface Valuation {
  /** unfilled quantity, rounded up (0 iff fully filled) */
  remainder: bigint;
  /** quote exchanged since the snapshot (bids rounded up, asks rounded down) */
  quote: bigint;
  /** the order's epoch is closed: the order is final */
  closed: boolean;
}

export class BookError extends Error {}

const emptyWords = (): LevelWords => ({
  remaining: 0n,
  epoch: 0n,
  scale: 0n,
  closed: false,
  survival: 0n,
  pot: 0n,
  acc: 0n,
});

export class BookLevel {
  readonly isBid: boolean;
  words: LevelWords = emptyWords();
  /** A at the end of scales closed by a rescale, keyed `${epoch}:${scale}` */
  readonly finals = new Map<string, bigint>();
  /** closed epochs archived when the tick was reused */
  readonly archive = new Map<bigint, LevelWords>();

  constructor(isBid: boolean) {
    this.isBid = isBid;
  }

  /** Real resting quantity (0 when closed). */
  get remaining(): bigint {
    return this.words.closed ? 0n : this.words.remaining;
  }

  add(q: bigint): Snap {
    const w = this.words;
    if (w.closed) {
      this.archive.set(w.epoch, { ...w });
      this.words = { ...emptyWords(), epoch: w.epoch + 1n, survival: S_SCALE };
    } else if (w.survival === 0n) {
      w.survival = S_SCALE; // first use of this tick
    }
    const cur = this.words;
    const snap: Snap = { epoch: cur.epoch, scale: cur.scale, survival: cur.survival, acc: cur.acc };
    cur.remaining += q;
    return snap;
  }

  leave(epoch: bigint, r: bigint): bigint {
    const w = this.words;
    if (w.closed || w.epoch !== epoch) return 0n;
    const removed = min(r, w.remaining);
    w.remaining -= removed;
    return removed;
  }

  /** Fills exactly `f` at `price` (quote units per whole base token). Returns true if the level closed. */
  fill(f: bigint, price: bigint, baseUnit: bigint): boolean {
    if (f === 0n) return false;
    const w = this.words;
    if (w.closed) throw new BookError("LevelClosed");
    if (f > w.remaining) throw new BookError("FillTooLarge");
    const survival = w.survival === 0n ? S_SCALE : w.survival;
    w.pot += this.isBid ? f : mulDiv(f, price, baseUnit);
    if (f === w.remaining) {
      w.acc += survival * price;
      w.survival = 0n;
      w.remaining = 0n;
      w.closed = true;
      return true;
    }
    const rem = w.remaining;
    const rem2 = rem - f;
    w.acc += mulDiv(survival * price, f, rem, this.isBid ? "ceil" : "floor");
    let ns = mulDiv(survival, rem2, rem, "ceil");
    if (ns < S_MIN) {
      this.finals.set(`${w.epoch}:${w.scale}`, w.acc);
      w.acc = 0n;
      let j = 0n;
      do {
        j += 1n;
        ns = shrink(survival, rem2, rem, j);
      } while (ns < S_MIN);
      w.scale += j;
    }
    w.survival = ns;
    w.remaining = rem2;
    return false;
  }

  /** IOC: closes the level after its auction; asks keep the remainder as the return pot. */
  forceClose(): bigint {
    const w = this.words;
    if (w.closed || w.remaining === 0n) return 0n;
    const r = w.remaining;
    w.closed = true;
    w.remaining = this.isBid ? 0n : r;
    return r;
  }

  draw(epoch: bigint, want: bigint, kind: PotKind): bigint {
    if (want === 0n) return 0n;
    const target = this.words.epoch === epoch ? this.words : this.archive.get(epoch);
    if (target === undefined) return 0n; // on-chain: zero words
    if (kind === POT) {
      const got = min(want, target.pot);
      target.pot -= got;
      return got;
    }
    if (!target.closed) return 0n;
    const got = min(want, target.remaining);
    target.remaining -= got;
    return got;
  }

  value(s: Snap, qty: bigint, baseUnit: bigint): Valuation {
    const rec = this.words.epoch === s.epoch ? this.words : this.archive.get(s.epoch);
    if (rec === undefined || (rec !== this.words && !rec.closed)) throw new BookError("MissingRecord");
    const endS = rec.survival;
    const lastScale = rec.scale;
    let remainder = 0n;
    if (endS !== 0n) {
      const d = lastScale - s.scale;
      remainder = d <= MAX_WALK ? mulDiv(qty, endS, s.survival * pow10(9n * d), "ceil") : qty === 0n ? 0n : 1n;
    }
    const rnd: Rounding = this.isBid ? "ceil" : "floor";
    let x = 0n;
    let quote = 0n;
    for (let j = 0n; ; j += 1n) {
      const sc = s.scale + j;
      const aEnd = sc === lastScale ? rec.acc : (this.finals.get(`${s.epoch}:${sc}`) ?? 0n);
      const dA = j === 0n ? aEnd - s.acc : aEnd;
      if (dA !== 0n) x += mulDiv(qty, dA, s.survival * pow10(9n * j), rnd);
      if (sc === lastScale) break;
      if (j === MAX_WALK) {
        if (this.isBid) quote = 1n;
        break;
      }
    }
    quote += mulDiv(x, 1n, baseUnit, rnd);
    return { remainder, quote, closed: rec.closed };
  }
}

function shrink(s: bigint, rem2: bigint, rem: bigint, j: bigint): bigint {
  const b = j > MAX_WALK ? MAX_WALK : j;
  return mulDiv(s * pow10(9n * (j - b)), rem2 * pow10(9n * b), rem, "ceil");
}
