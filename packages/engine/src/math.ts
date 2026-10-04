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

export const UINT256_MAX = (1n << 256n) - 1n;

/**
 * ⌊√a⌋ — the bigint twin of OpenZeppelin `Math.sqrt` (same initial estimate, same six Newton steps, same
 * final correction), defined on uint256.
 */
export function sqrt(a: bigint): bigint {
  if (a < 0n || a > UINT256_MAX) throw new RangeError("sqrt: operand outside uint256");
  if (a <= 1n) return a;
  let aa = a;
  let xn = 1n;
  if (aa >= 1n << 128n) {
    aa >>= 128n;
    xn <<= 64n;
  }
  if (aa >= 1n << 64n) {
    aa >>= 64n;
    xn <<= 32n;
  }
  if (aa >= 1n << 32n) {
    aa >>= 32n;
    xn <<= 16n;
  }
  if (aa >= 1n << 16n) {
    aa >>= 16n;
    xn <<= 8n;
  }
  if (aa >= 1n << 8n) {
    aa >>= 8n;
    xn <<= 4n;
  }
  if (aa >= 1n << 4n) {
    aa >>= 4n;
    xn <<= 2n;
  }
  if (aa >= 1n << 2n) xn <<= 1n;
  xn = (3n * xn) >> 1n;
  for (let i = 0; i < 6; i++) xn = (xn + a / xn) >> 1n;
  return xn > a / xn ? xn - 1n : xn;
}
