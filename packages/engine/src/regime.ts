/**
 * Trading regimes (SPEC §6) — bit-exact port of the regime logic in `contracts/src/core/ExchangeClearing.sol`:
 *   `_regimeBandBps`  band half-width per regime; DISCOVERY widens with √(time closed) (OZ `Math.sqrt` rounding)
 *   `_band`           the reference-centred band of an auction (what `UnisonExchange.previewBand` returns)
 *   `_openJob`        the halt override and the DISCOVERY call-auction cadence (`TooEarly`)
 *   `_finalize`       how a completed clear moves the regime state (closedSince, lastDiscoveryBatch, lastStatus)
 * Integer fields accept numbers or bigints, so viem reads of `regimeOf` / `market` can be passed in as they are.
 */
import { band } from "./clearing.ts";
import { sqrt } from "./math.ts";

/** `IReferenceAdapter.Status`: session status of the reference market. */
export const RefStatus = { OPEN: 0, EXTENDED: 1, CLOSED: 2, HALTED: 3 } as const;
export type RefStatusCode = (typeof RefStatus)[keyof typeof RefStatus];

/** The regime an auction runs under. */
export type RegimeName = "LIVE" | "EXTENDED" | "DISCOVERY" | "REOPENING" | "HALTED";

/** Regime names by code (the order used by the differential FFI bridge). */
export const REGIME_NAMES: readonly RegimeName[] = ["LIVE", "EXTENDED", "DISCOVERY", "REOPENING", "HALTED"];

type Int = bigint | number;

/** `ExchangeBase.Regime`: configuration and state of a market's regimes. */
export interface RegimeConfig {
  extBandBps: Int;
  reopenBandBps: Int;
  discFloorBps: Int;
  discCapBps: Int;
  discHorizonSec: Int;
  discCadence: Int;
  /** guardian / CRE halt override */
  halted: boolean;
  /** unix seconds the current CLOSED period started (0 = not closed) */
  closedSince: Int;
  /** newest batch of the last DISCOVERY auction */
  lastDiscoveryBatch: Int;
}

/** The `ExchangeBase.Market` fields the band-width logic reads. */
export interface RegimeMarket {
  bandBps: Int;
  /** status of the market's last completed clear */
  lastStatus: Int;
}

/** The `ExchangeBase.Market` fields `_band` reads. */
export interface BandMarket extends RegimeMarket {
  tickSize: Int;
  minTick: Int;
  maxTick: Int;
  maxBandTicks: Int;
}

export interface RegimeBand {
  refTick: bigint;
  lo: bigint;
  hi: bigint;
  bandBps: bigint;
}

export class RegimeError extends Error {}

const E18 = 10n ** 18n;
const E9 = 10n ** 9n;

function statusOf(s: Int): RefStatusCode {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new RegimeError(`invalid reference status ${String(s)}`);
  return n as RefStatusCode;
}

const closedOrHalted = (s: Int): boolean => {
  const v = BigInt(s);
  return v === 2n || v === 3n;
};

/**
 * The regime a clear would run under. The halt override comes first (as in `_openJob`), then CLOSED → DISCOVERY,
 * the first OPEN/EXTENDED auction after a CLOSED or HALTED one → REOPENING (the opening cross), else EXTENDED / LIVE.
 */
export function deriveRegime(a: { status: Int; lastStatus: Int; halted?: boolean }): RegimeName {
  const st = a.halted ? RefStatus.HALTED : statusOf(a.status);
  if (st === RefStatus.HALTED) return "HALTED";
  if (st === RefStatus.CLOSED) return "DISCOVERY";
  if (closedOrHalted(a.lastStatus)) return "REOPENING";
  return st === RefStatus.EXTENDED ? "EXTENDED" : "LIVE";
}

/**
 * DISCOVERY half-width at unix time `now`: max(floor, cap·√(min(t, H)/H)) where t is the time since the close
 * (`closedSince`, or 0 before the first CLOSED clear) and H the horizon (H = 0 → cap). A result of 0 falls back to
 * the market's `bandBps` in `regimeBandBps`.
 */
export function discoveryBandBps(regime: RegimeConfig, now: Int): bigint {
  const ts = BigInt(now);
  const closedSince = BigInt(regime.closedSince);
  const since = closedSince === 0n ? ts : closedSince;
  let e = ts > since ? ts - since : 0n;
  const h = BigInt(regime.discHorizonSec);
  let bps: bigint;
  if (h === 0n) {
    bps = BigInt(regime.discCapBps);
  } else {
    if (e > h) e = h;
    bps = (BigInt(regime.discCapBps) * sqrt((e * E18) / h)) / E9;
  }
  const floor = BigInt(regime.discFloorBps);
  return bps < floor ? floor : bps;
}

/**
 * `_regimeBandBps`: band half-width in bps for an auction under reference `status` at unix time `now`. The status is
 * taken as given (no halt override), exactly like `previewBand`.
 */
export function regimeBandBps(a: { market: RegimeMarket; regime: RegimeConfig; status: Int; now: Int }): bigint {
  const st = statusOf(a.status);
  const g = a.regime;
  let bps: bigint;
  if (st === RefStatus.CLOSED) {
    bps = discoveryBandBps(g, a.now);
  } else if (closedOrHalted(a.market.lastStatus)) {
    bps = BigInt(g.reopenBandBps);
  } else {
    bps = st === RefStatus.EXTENDED ? BigInt(g.extBandBps) : BigInt(a.market.bandBps);
  }
  return bps === 0n ? BigInt(a.market.bandBps) : bps;
}

/** `_band`: the reference-centred band of an auction — `UnisonExchange.previewBand(marketId, refPrice, status)`. */
export function regimeBand(a: {
  market: BandMarket;
  regime: RegimeConfig;
  refPrice: Int;
  status: Int;
  now: Int;
}): RegimeBand {
  const tickSize = BigInt(a.market.tickSize);
  const maxBandTicks = BigInt(a.market.maxBandTicks);
  if (tickSize === 0n) throw new RegimeError("tickSize = 0"); // division by zero on-chain
  if (maxBandTicks === 0n) throw new RegimeError("maxBandTicks = 0"); // underflow on-chain
  const bandBps = regimeBandBps(a);
  const b = band({
    refPrice: BigInt(a.refPrice),
    tickSize,
    minTick: BigInt(a.market.minTick),
    maxTick: BigInt(a.market.maxTick),
    bandBps,
    maxBandTicks,
  });
  return { ...b, bandBps };
}

/**
 * `_openJob`'s call-auction cadence: true if a clear covering the batches <= `upTo` would revert `TooEarly`
 * (reference CLOSED after the halt override, cadence > 1, and fewer than `discCadence` blocks since the last
 * DISCOVERY auction).
 */
export function discoveryTooEarly(a: { regime: RegimeConfig; status: Int; upTo: Int }): boolean {
  const st = a.regime.halted ? RefStatus.HALTED : statusOf(a.status);
  if (st !== RefStatus.CLOSED) return false;
  const cadence = BigInt(a.regime.discCadence);
  const last = BigInt(a.regime.lastDiscoveryBatch);
  return cadence > 1n && last !== 0n && BigInt(a.upTo) < last + cadence;
}

/** Earliest batch a DISCOVERY auction may cover: max(lastCleared + 1, lastDiscoveryBatch + discCadence). */
export function nextDiscoveryBatch(a: { regime: RegimeConfig; lastCleared: Int }): bigint {
  const first = BigInt(a.lastCleared) + 1n;
  const cadence = BigInt(a.regime.discCadence);
  const last = BigInt(a.regime.lastDiscoveryBatch);
  if (cadence <= 1n || last === 0n) return first;
  const next = last + cadence;
  return next > first ? next : first;
}

export interface RegimeTransition {
  closedSince: bigint;
  lastDiscoveryBatch: bigint;
  /** the market's `lastStatus` after the clear (the job status, after the halt override) */
  lastStatus: RefStatusCode;
}

/**
 * `_finalize`: regime state after a completed clear of the batches <= `upTo` under reference `status` published
 * at `refTimeMs` (the halt override applies first, as in `_openJob`).
 */
export function regimeAfterClear(a: {
  regime: Pick<RegimeConfig, "closedSince" | "lastDiscoveryBatch" | "halted">;
  status: Int;
  refTimeMs: Int;
  upTo: Int;
}): RegimeTransition {
  const st = a.regime.halted ? RefStatus.HALTED : statusOf(a.status);
  let closedSince = BigInt(a.regime.closedSince);
  let lastDiscoveryBatch = BigInt(a.regime.lastDiscoveryBatch);
  if (st === RefStatus.CLOSED) {
    if (closedSince === 0n) closedSince = BigInt(a.refTimeMs) / 1000n;
    lastDiscoveryBatch = BigInt(a.upTo);
  } else if (st !== RefStatus.HALTED) {
    closedSince = 0n;
  }
  return { closedSince, lastDiscoveryBatch, lastStatus: st };
}

/**
 * The regime configuration `UnisonExchange.createMarket` installs before an operator calibrates it
 * (`setRegime`): extended 2×, reopening and discovery cap 5× the live band (capped at 50%), 235,800 s horizon,
 * 10-block cadence.
 */
export function defaultRegime(bandBps: Int): RegimeConfig {
  const b = BigInt(bandBps);
  const cap = (x: bigint) => (x > 5_000n ? 5_000n : x);
  return {
    extBandBps: cap(b * 2n),
    reopenBandBps: cap(b * 5n),
    discFloorBps: b,
    discCapBps: cap(b * 5n),
    discHorizonSec: 235_800n,
    discCadence: 10n,
    halted: false,
    closedSince: 0n,
    lastDiscoveryBatch: 0n,
  };
}
