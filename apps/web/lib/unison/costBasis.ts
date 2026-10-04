import type { MyFill } from "../demo/engine.ts";

export interface Basis {
  /** the position the fills (and the start) account for */
  qty: number;
  /** average cost a share, fees included */
  avg: number;
  /** profit or loss taken on sales, fees included */
  realized: number;
}

/**
 * Average cost and realised P&L per market, from an account's fills taken oldest first. A buy adds to the position
 * at its price plus the fee; a sale realises (price − average cost) on what it sold, less the fee, and leaves the
 * average where it was. `start` is what the account held before its first fill and the price it is costed at (the
 * paper account's opening references). A live account starts from nothing, so a position larger than its fills
 * explain (shares deposited or sent to it) has no known cost: the caller compares `qty` with what is held.
 */
export function costBasis(
  fills: readonly MyFill[],
  start: Readonly<Record<string, { qty: number; price: number }>>,
  priceOf: (fill: MyFill) => number,
  feeBps: (ticker: string) => number,
): Record<string, Basis> {
  const book: Record<string, Basis> = {};
  for (const [ticker, s] of Object.entries(start)) book[ticker] = { qty: s.qty, avg: s.price, realized: 0 };
  const ordered = [...fills].sort((a, b) => a.block - b.block || a.ts - b.ts || a.orderId - b.orderId);
  for (const f of ordered) {
    const b = (book[f.ticker] ??= { qty: 0, avg: 0, realized: 0 });
    const px = priceOf(f);
    const fee = (f.qty * px * feeBps(f.ticker)) / 10_000;
    if (f.side === "buy") {
      const cost = b.qty * b.avg + f.qty * px + fee;
      b.qty += f.qty;
      b.avg = b.qty > 0 ? cost / b.qty : 0;
    } else {
      const sold = Math.min(f.qty, b.qty);
      b.realized += sold * (px - b.avg) - fee;
      b.qty -= f.qty;
      if (b.qty <= 1e-9) {
        b.qty = Math.max(0, b.qty);
        if (b.qty === 0) b.avg = 0;
      }
    }
  }
  return book;
}
