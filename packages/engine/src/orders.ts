/** Locks, fees and exact apportionment — bit-exact port of `contracts/src/core/OrderMath.sol`. */
import { mulDiv } from "./math.ts";

export const BPS = 10_000n;
export const LOCK_SLACK = 4n;

export const notionalCeil = (qty: bigint, price: bigint, baseUnit: bigint): bigint =>
  mulDiv(qty, price, baseUnit, "ceil");

export const fee = (amount: bigint, bps: bigint): bigint => mulDiv(amount, bps, BPS, "ceil");

/** Quote locked by a buy: notional at the limit (ceil) + max fee on it (ceil) + slack. */
export function buyLock(qty: bigint, limitPrice: bigint, maxFeeBps: bigint, baseUnit: bigint): bigint {
  const n = notionalCeil(qty, limitPrice, baseUnit);
  return n + fee(n, maxFeeBps) + LOCK_SLACK;
}

/**
 * Exact cumulative apportionment of `need` over a class totalling `classQ`: the share of a source with
 * quantity `q` visited after sources totalling `before`. Shares sum to exactly `need`.
 */
export function apportion(need: bigint, before: bigint, q: bigint, classQ: bigint): bigint {
  if (need === classQ) return q;
  return mulDiv(need, before + q, classQ) - mulDiv(need, before, classQ);
}

/** Splits `need` over `quantities` (visited in order) exactly as the on-chain APPLY phase does. */
export function apportionAll(need: bigint, quantities: readonly bigint[]): bigint[] {
  const classQ = quantities.reduce((a, b) => a + b, 0n);
  if (need > classQ) throw new RangeError("apportionAll: need exceeds class quantity");
  let before = 0n;
  return quantities.map((q) => {
    const share = apportion(need, before, q, classQ);
    before += q;
    return share;
  });
}
