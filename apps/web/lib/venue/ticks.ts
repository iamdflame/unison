/**
 * Ticks exactly as the exchange computes them (ExchangeClearing._band), so the reference and the band a page shows are
 * the ones the next auction uses, to the tick: the reference rounds half up to a tick, and the band's half-width is
 * ⌊refTick × bandBps / 10,000⌋, at least one tick.
 */

/** The tick a reference price rounds to: (price + tickSize / 2) / tickSize, in integers. */
export function refTickOf(price: bigint, tickSize: bigint): number {
  return tickSize > 0n ? Number((price + tickSize / 2n) / tickSize) : 0;
}

/** The band's half-width in ticks around `refTick` for a band of `bandBps` each side. */
export function bandHalfTicks(refTick: number, bandBps: number): number {
  return Math.max(1, Math.floor((refTick * bandBps) / 10_000));
}
