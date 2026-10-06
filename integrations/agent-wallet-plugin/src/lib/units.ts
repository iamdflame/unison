import { formatUnits, parseUnits } from "viem";

/**
 * Amounts and prices. A price is quote-token units per one base unit (`tick * tickSize`, as the exchange stores it);
 * a tick is that price on the market's grid.
 */

/** A positive decimal amount ("2", "0.5") in a token's smallest units; refuses anything finer than the token. */
export function toUnits(amount: string, decimals: number): bigint {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`"${amount}" is not an amount`);
  const fraction = s.split(".")[1] ?? "";
  if (fraction.length > decimals) throw new Error(`"${amount}" has more than ${decimals} decimals`);
  const v = parseUnits(s, decimals);
  if (v === 0n) throw new Error("the amount must be more than zero");
  return v;
}

/** Smallest units as a decimal string, with at most `maxFraction` decimals (trailing zeros dropped). */
export function fromUnits(v: bigint, decimals: number, maxFraction = decimals): string {
  const s = formatUnits(v, decimals);
  const [i, f = ""] = s.split(".");
  const kept = f.slice(0, maxFraction).replace(/0+$/, "");
  return kept ? `${i}.${kept}` : (i ?? "0");
}

export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** The highest tick at or below a price (a buy's limit never rounds up past what was asked). */
export const tickAtOrBelow = (price: bigint, tickSize: bigint) => price / tickSize;
/** The lowest tick at or above a price (a sell's limit never rounds down past what was asked). */
export const tickAtOrAbove = (price: bigint, tickSize: bigint) => ceilDiv(price, tickSize);

/** What a buy locks on the venue (OrderMath.buyLock): its notional at the limit, rounded up, the most fee it can pay, and slack. */
export function buyLock(qty: bigint, limitPrice: bigint, maxFeeBps: bigint, baseUnit: bigint): bigint {
  const n = ceilDiv(qty * limitPrice, baseUnit);
  return n + ceilDiv(n * maxFeeBps, 10_000n) + 4n;
}

/** a − b in basis points of b, to two decimals. */
export const bpsFrom = (a: bigint, b: bigint) => (b === 0n ? 0 : Number(((a - b) * 1_000_000n) / b) / 100);
