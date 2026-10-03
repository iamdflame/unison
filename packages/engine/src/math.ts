/** Rounding direction for integer division (all engine values are non-negative). */
export type Rounding = "floor" | "ceil";

/** a·b/d with explicit rounding — the bigint twin of OpenZeppelin `Math.mulDiv`. */
export function mulDiv(a: bigint, b: bigint, d: bigint, rounding: Rounding = "floor"): bigint {
  if (d === 0n) throw new RangeError("mulDiv: division by zero");
  if (a < 0n || b < 0n || d < 0n) throw new RangeError("mulDiv: negative operand");
  const p = a * b;
  const q = p / d;
  return rounding === "ceil" && q * d !== p ? q + 1n : q;
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export const pow10 = (e: bigint | number): bigint => 10n ** BigInt(e);
