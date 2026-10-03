/**
 * Prices are quote units per ONE whole base token (e.g. AUSD has 6 decimals: $180.00 = 180_000_000n).
 * A tick is an integer; price = tick * tickSize.
 */
export const priceOfTick = (tick: bigint, tickSize: bigint): bigint => tick * tickSize;

/** Nearest tick to `price` (`mode` = "down" for bids you want filled at or below, "up" for asks). */
export function tickOfPrice(price: bigint, tickSize: bigint, mode: "nearest" | "down" | "up" = "nearest"): bigint {
  if (mode === "down") return price / tickSize;
  if (mode === "up") return (price + tickSize - 1n) / tickSize;
  return (price + tickSize / 2n) / tickSize;
}

/** Parses a decimal string ("180.25") into integer units with `decimals` (no floating point). */
export function parseUnitsExact(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`invalid decimal: ${value}`);
  const [i, f = ""] = v.split(".");
  if (f.length > decimals) throw new Error(`too many decimals in ${value} (max ${decimals})`);
  return BigInt(i!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}

/** Formats integer units with `decimals`, trimming trailing zeros (keeps at least `minFraction`). */
export function formatUnitsExact(value: bigint, decimals: number, minFraction = 0): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Quote value of `qty` base units at `price` (floor). */
export const notional = (qty: bigint, price: bigint, baseUnit: bigint): bigint => (qty * price) / baseUnit;

/** Basis points between two prices: (a - b) / b, signed. */
export const bpsDiff = (a: bigint, b: bigint): number => (b === 0n ? 0 : Number(((a - b) * 1_000_000n) / b) / 100);
