/**
 * Curve liquidity — bit-exact port of `LiquidityVault.curve` (contracts/src/liquidity/LiquidityVault.sol) and of how
 * the exchange merges curve sources into an auction (contracts/src/core/ExchangeClearing.sol):
 *   `vaultCurve`    the vault's parametric curve around the reference (spread × regime multiplier, inventory skew,
 *                   depth as a share of NAV, per-auction cap)
 *   `clipCurve`     `_loadCurves` for one source: clipped to the band, capped by the source's ledger inventory
 *   `loadCurves`    every source in order; a source whose `curve()` reverts adds nothing, and outside an open
 *                   session (OPEN, EXTENDED) no source is asked at all (exchange v3)
 *   `mergeCurves`   the clipped curves added to the clearing input
 *   `settleCurves`  `_settleCurves`: each source's fills at the auction price (better ticks in full, the marginal
 *                   tick by exact cumulative apportionment ahead of the books)
 *   `startAuction`  `_startAuction` end to end: halt override, regime band, daily volume cap, book + curves → clearing
 * Integer fields accept numbers or bigints (viem reads can be passed in as they are).
 */
import {
  askLevelTick,
  bidLevelTick,
  compute,
  type ClearingInput,
  type ClearingResult,
} from "./clearing.ts";
import { mulDiv, UINT256_MAX } from "./math.ts";
import { apportion } from "./orders.ts";
import {
  deriveRegime,
  regimeBand,
  RefStatus,
  type BandMarket,
  type RefStatusCode,
  type RegimeBand,
  type RegimeConfig,
  type RegimeName,
} from "./regime.ts";

type Int = bigint | number;

/** `LiquidityVault.Params`. */
export interface VaultParams {
  /** half-spread at OPEN */
  spreadBps: Int;
  /** NAV fraction quoted per tick per side */
  depthBps: Int;
  /** ticks per side */
  widthTicks: Int;
  /** skew at 100% / 0% base weight */
  maxSkewTicks: Int;
  /** NAV fraction a side may trade in one auction */
  maxAuctionBps: Int;
  /** fee on flows executed while the reference market is closed / halted (no effect on the curve) */
  swingBps: Int;
  /** spread multiplier in EXTENDED */
  extMult: Int;
  /** spread multiplier in CLOSED (DISCOVERY) */
  closedMult: Int;
  paused: boolean;
}

/** `ICurveSource.Curve`: `perTick` base units at each of `ticks` consecutive ticks (0 = no liquidity on a side). */
export interface Curve {
  bidTop: bigint;
  bidTicks: bigint;
  bidPerTick: bigint;
  askBottom: bigint;
  askTicks: bigint;
  askPerTick: bigint;
}

/** `ExchangeClearing.CurveSlot` without the source: a curve clipped to the band and capped (q = 0: no liquidity). */
export interface CurveSlot {
  bidLo: bigint;
  bidHi: bigint;
  bidQ: bigint;
  askLo: bigint;
  askHi: bigint;
  askQ: bigint;
}

/** A source's fills in one auction (the `CurveFilled` event). */
export interface CurveFill {
  boughtBase: bigint;
  paidQuote: bigint;
  soldBase: bigint;
  receivedQuote: bigint;
}

/** The arguments the exchange passes to `ICurveSource.curve` (besides the market id). */
export interface CurveQuery {
  refPrice: bigint;
  /** the auction's reference status (after the halt override; never HALTED, which runs no auction) */
  status: number;
  refTick: bigint;
  lo: bigint;
  hi: bigint;
}

/** A curve source at the start of an auction: its `curve()` answer and its ledger balances on the venue. */
export interface CurveSourceState {
  /** the curve, or how the source computes it; a function that throws behaves like a reverting source */
  curve: Curve | ((q: CurveQuery) => Curve);
  baseBalance: Int;
  quoteBalance: Int;
}

/** Thrown where the Solidity code reverts (overflow, division by zero). */
export class CurveRevert extends Error {}

export const emptyCurve = (): Curve => ({
  bidTop: 0n,
  bidTicks: 0n,
  bidPerTick: 0n,
  askBottom: 0n,
  askTicks: 0n,
  askPerTick: 0n,
});

export const emptySlot = (): CurveSlot => ({ bidLo: 0n, bidHi: 0n, bidQ: 0n, askLo: 0n, askHi: 0n, askQ: 0n });

const noFill = (): CurveFill => ({ boughtBase: 0n, paidQuote: 0n, soldBase: 0n, receivedQuote: 0n });

const BPS = 10_000n;
const UINT128_MAX = (1n << 128n) - 1n;
const INT256_MIN = -(1n << 255n);
const INT256_MAX = (1n << 255n) - 1n;

function u256(v: bigint): bigint {
  if (v < 0n || v > UINT256_MAX) throw new CurveRevert("uint256 overflow");
  return v;
}

function i256(v: bigint): bigint {
  if (v < INT256_MIN || v > INT256_MAX) throw new CurveRevert("int256 overflow");
  return v;
}

/** `int256(x)` of a uint256 is a bit reinterpretation in Solidity (unchecked). */
const asInt256 = (x: bigint): bigint => BigInt.asIntN(256, x);

/** OZ `Math.mulDiv` (floor): reverts on a zero denominator or a result above uint256. */
function mulDivChecked(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new CurveRevert("division by zero");
  return u256(mulDiv(a, b, d));
}

// ------------------------------------------------------------------ LiquidityVault.curve

export interface VaultCurveInput {
  params: VaultParams;
  /** the vault's ledger balances on the venue (`LiquidityVault.balances()`) */
  baseBalance: Int;
  quoteBalance: Int;
  /** `10 ** baseDecimals` */
  baseUnit: Int;
  /** reference price: quote units per whole base token */
  refPrice: Int;
  /** reference status (IReferenceAdapter.Status) */
  status: Int;
  refTick: Int;
  /** the market asked for and the vault's own market: a mismatch yields an empty curve (default: equal) */
  marketId?: Int;
  vaultMarketId?: Int;
}

/** `LiquidityVault.curve`: the vault's curve for one auction. Throws `CurveRevert` where the contract reverts. */
export function vaultCurve(x: VaultCurveInput): Curve {
  const p = x.params;
  const c = emptyCurve();
  const refPrice = BigInt(x.refPrice);
  const status = BigInt(x.status);
  const mId = x.marketId === undefined ? 0n : BigInt(x.marketId);
  const vId = x.vaultMarketId === undefined ? mId : BigInt(x.vaultMarketId);
  if (mId !== vId || p.paused || refPrice === 0n || status === BigInt(RefStatus.HALTED)) return c;

  const b = BigInt(x.baseBalance);
  const q = BigInt(x.quoteBalance);
  const baseUnit = BigInt(x.baseUnit);
  const baseVal = mulDivChecked(b, refPrice, baseUnit);
  const navQ = u256(q + baseVal);
  if (navQ === 0n) return c;

  const mult =
    status === BigInt(RefStatus.OPEN)
      ? 1n
      : status === BigInt(RefStatus.EXTENDED)
        ? BigInt(p.extMult)
        : BigInt(p.closedMult);
  const refTick = BigInt(x.refTick);
  let half = u256(u256(refTick * BigInt(p.spreadBps)) * mult) / BPS;
  if (half === 0n) half = 1n;
  // skew > 0 when overweight base: both quotes move down (int256 division truncates toward zero, like bigint's)
  const weight = u256(baseVal * BPS) / navQ;
  const skew = ((weight - 5_000n) * BigInt(p.maxSkewTicks)) / 5_000n;

  const bidTop = i256(i256(asInt256(refTick) - asInt256(half)) - skew);
  const askBot = i256(i256(asInt256(refTick) + asInt256(half)) - skew);
  let perTickQuote = u256(navQ * BigInt(p.depthBps)) / BPS;
  const sideCap = u256(navQ * BigInt(p.maxAuctionBps)) / BPS;
  const width = BigInt(p.widthTicks);
  if (u256(perTickQuote * width) > sideCap) perTickQuote = sideCap / width;
  const perTick = mulDivChecked(perTickQuote, baseUnit, refPrice);
  if (perTick === 0n || perTick > UINT128_MAX) return c;

  if (bidTop >= 1n) {
    c.bidTop = BigInt.asUintN(32, bidTop);
    c.bidTicks = width;
    c.bidPerTick = perTick;
  }
  if (askBot >= 1n) {
    c.askBottom = BigInt.asUintN(32, askBot);
    c.askTicks = width;
    c.askPerTick = perTick;
  }
  return c;
}

/** A LiquidityVault as a curve source: its curve follows each auction's reference, status and band. */
export function vaultSource(v: {
  params: VaultParams;
  baseBalance: Int;
  quoteBalance: Int;
  baseUnit: Int;
}): CurveSourceState {
  return {
    baseBalance: v.baseBalance,
    quoteBalance: v.quoteBalance,
    curve: (q) =>
      vaultCurve({
        params: v.params,
        baseBalance: v.baseBalance,
        quoteBalance: v.quoteBalance,
        baseUnit: v.baseUnit,
        refPrice: q.refPrice,
        status: q.status,
        refTick: q.refTick,
      }),
  };
}

// ------------------------------------------------------------------ _loadCurves

export interface ClipParams {
  /** auction band (inclusive) */
  lo: Int;
  hi: Int;
  tickSize: Int;
  baseUnit: Int;
  /** the source's ledger balances on the venue */
  baseBalance: Int;
  quoteBalance: Int;
}

/**
 * `_loadCurves` for one source: the curve clipped to [lo, hi] and capped by the source's ledger inventory — bids so
 * that the worst-case cost ceil(ticks · q · price(top) / baseUnit) fits the quote balance, asks so that ticks · q
 * fits the base balance.
 */
export function clipCurve(cv: Curve, a: ClipParams): CurveSlot {
  const s = emptySlot();
  const lo = BigInt(a.lo);
  const hi = BigInt(a.hi);
  if (cv.bidTop !== 0n && cv.bidTicks !== 0n && cv.bidPerTick !== 0n) {
    const top = cv.bidTop > hi ? hi : cv.bidTop;
    let bot = cv.bidTop + 1n > cv.bidTicks ? cv.bidTop + 1n - cv.bidTicks : 1n;
    if (bot < lo) bot = lo;
    if (bot <= top) {
      const ticks = top - bot + 1n;
      const bal = BigInt(a.quoteBalance);
      const cost = u256(u256(top * BigInt(a.tickSize)) * ticks);
      const cap = bal === 0n ? 0n : mulDivChecked(bal - 1n, BigInt(a.baseUnit), cost);
      const q = cv.bidPerTick < cap ? cv.bidPerTick : cap;
      if (q !== 0n) {
        s.bidLo = bot;
        s.bidHi = top;
        s.bidQ = q;
      }
    }
  }
  if (cv.askBottom !== 0n && cv.askTicks !== 0n && cv.askPerTick !== 0n) {
    const bot = cv.askBottom < lo ? lo : cv.askBottom;
    let top = cv.askBottom + cv.askTicks - 1n;
    if (top > hi) top = hi;
    if (bot <= top) {
      const ticks = top - bot + 1n;
      const cap = BigInt(a.baseBalance) / ticks;
      const q = cv.askPerTick < cap ? cv.askPerTick : cap;
      if (q !== 0n) {
        s.askLo = bot;
        s.askHi = top;
        s.askQ = q;
      }
    }
  }
  return s;
}

/** `_loadCurves`: every source in order. A source whose curve reverts contributes nothing (try/catch on-chain). */
export function loadCurves(
  sources: readonly CurveSourceState[],
  a: CurveQuery & { tickSize: Int; baseUnit: Int },
): CurveSlot[] {
  const query: CurveQuery = { refPrice: a.refPrice, status: a.status, refTick: a.refTick, lo: a.lo, hi: a.hi };
  // while a market is closed its auctions are among traders alone: no source quotes (ExchangeClearing._loadCurves, v3)
  const open = BigInt(a.status) === BigInt(RefStatus.OPEN) || BigInt(a.status) === BigInt(RefStatus.EXTENDED);
  if (!open) return sources.map(() => emptySlot());
  return sources.map((src) => {
    let cv: Curve;
    try {
      cv = typeof src.curve === "function" ? src.curve(query) : src.curve;
    } catch {
      return emptySlot();
    }
    return clipCurve(cv, {
      lo: a.lo,
      hi: a.hi,
      tickSize: a.tickSize,
      baseUnit: a.baseUnit,
      baseBalance: src.baseBalance,
      quoteBalance: src.quoteBalance,
    });
  });
}

/** Adds clipped curves to the per-tick liquidity of a clearing input (returns a new input). */
export function mergeCurves(x: ClearingInput, slots: readonly CurveSlot[]): ClearingInput {
  const bids = x.bids.slice();
  const asks = x.asks.slice();
  for (const s of slots) {
    if (s.bidQ !== 0n) for (let t = s.bidLo; t <= s.bidHi; t++) bids[Number(t - x.lo)]! += s.bidQ;
    if (s.askQ !== 0n) for (let t = s.askLo; t <= s.askHi; t++) asks[Number(t - x.lo)]! += s.askQ;
  }
  return { ...x, bids, asks };
}

/** Per-tick quantities of a clipped curve over [lo, hi] (for drawing vault liquidity). */
export function slotLevels(s: CurveSlot, lo: Int, hi: Int): { bids: bigint[]; asks: bigint[] } {
  const l = BigInt(lo);
  const n = Number(BigInt(hi) - l + 1n);
  const bids = new Array<bigint>(n).fill(0n);
  const asks = new Array<bigint>(n).fill(0n);
  if (s.bidQ !== 0n) for (let t = s.bidLo; t <= s.bidHi; t++) bids[Number(t - l)] = s.bidQ;
  if (s.askQ !== 0n) for (let t = s.askLo; t <= s.askHi; t++) asks[Number(t - l)] = s.askQ;
  return { bids, asks };
}

// ------------------------------------------------------------------ _settleCurves

export interface CurveSettlement {
  /** per source, in source order */
  fills: CurveFill[];
  /** source quantity apportioned at the marginal tick ahead of the books (APPLY continues from it) */
  bidBefore0: bigint;
  askBefore0: bigint;
}

/**
 * `_settleCurves`: each source's fills for the result `r` of the merged input `x`, at price = tick · tickSize
 * (sources pay rounded up and receive rounded down; no fee).
 */
export function settleCurves(
  x: ClearingInput,
  r: ClearingResult,
  slots: readonly CurveSlot[],
  a: { tickSize: Int; baseUnit: Int },
): CurveSettlement {
  const out: CurveSettlement = { fills: [], bidBefore0: 0n, askBefore0: 0n };
  if (!r.traded) {
    out.fills = slots.map(noFill);
    return out;
  }
  const n = x.bids.length;
  const price = r.tick * BigInt(a.tickSize);
  const baseUnit = BigInt(a.baseUnit);
  const tmB = r.bidMarginal === 0n ? 0n : bidLevelTick(x.hi, r.bidMarginal);
  const tmA = r.askMarginal === 0n ? 0n : askLevelTick(x.lo, r.askMarginal);
  const bidClassQ = r.bidMarginal === 0n ? x.bidAbove : x.bids[n - Number(r.bidMarginal)]!;
  const askClassQ = r.askMarginal === 0n ? x.askBelow : x.asks[Number(r.askMarginal) - 1]!;
  for (const c of slots) {
    let fb = 0n;
    let fa = 0n;
    if (c.bidQ !== 0n && tmB !== 0n) {
      const from = c.bidLo > tmB ? c.bidLo : tmB + 1n;
      if (from <= c.bidHi) fb = (c.bidHi - from + 1n) * c.bidQ;
      if (tmB >= c.bidLo && tmB <= c.bidHi) {
        fb += apportion(r.bidMarginalFill, out.bidBefore0, c.bidQ, bidClassQ);
        out.bidBefore0 += c.bidQ;
      }
    }
    if (c.askQ !== 0n && tmA !== 0n) {
      const to = c.askHi < tmA ? c.askHi : tmA - 1n;
      if (c.askLo <= to) fa = (to - c.askLo + 1n) * c.askQ;
      if (tmA >= c.askLo && tmA <= c.askHi) {
        fa += apportion(r.askMarginalFill, out.askBefore0, c.askQ, askClassQ);
        out.askBefore0 += c.askQ;
      }
    }
    out.fills.push({
      boughtBase: fb,
      paidQuote: fb === 0n ? 0n : mulDiv(fb, price, baseUnit, "ceil"),
      soldBase: fa,
      receivedQuote: fa === 0n ? 0n : mulDiv(fa, price, baseUnit),
    });
  }
  return out;
}

// ------------------------------------------------------------------ _startAuction

/** Resting liquidity at one limit tick (any granularity: orders or aggregated levels). */
export interface BookLiquidity {
  /** 0 = BID, 1 = ASK */
  side: Int;
  tick: Int;
  qty: Int;
}

/**
 * `_buildInput`: resting liquidity → clearing input over [lo, hi]. Bids above the band join `bidAbove`, asks below it
 * `askBelow`; bids below and asks above the band cannot trade at any band price and are left out.
 */
export function buildClearingInput(
  book: readonly BookLiquidity[],
  b: { lo: Int; hi: Int; refTick: Int },
): ClearingInput {
  const lo = BigInt(b.lo);
  const hi = BigInt(b.hi);
  const n = Number(hi - lo + 1n);
  const bids = new Array<bigint>(n).fill(0n);
  const asks = new Array<bigint>(n).fill(0n);
  let bidAbove = 0n;
  let askBelow = 0n;
  for (const l of book) {
    const t = BigInt(l.tick);
    const q = BigInt(l.qty);
    if (BigInt(l.side) === 0n) {
      if (t > hi) bidAbove += q;
      else if (t >= lo) bids[Number(t - lo)]! += q;
    } else if (t < lo) askBelow += q;
    else if (t <= hi) asks[Number(t - lo)]! += q;
  }
  return { lo, hi, refTick: BigInt(b.refTick), bidAbove, askBelow, bids, asks };
}

export interface AuctionInput {
  /** the market's band parameters, `lastStatus` and `baseUnit` */
  market: BandMarket & { baseUnit: Int };
  regime: RegimeConfig;
  refPrice: Int;
  /** reference status; `regime.halted` overrides it to HALTED */
  status: Int;
  /** block timestamp (unix seconds) — the DISCOVERY band widens with it */
  now: Int;
  /** resting liquidity of every book (main and IOC) */
  book: readonly BookLiquidity[];
  /** curve sources in `sourcesOf` order */
  sources?: readonly CurveSourceState[];
  /** what the market may still trade today (`capsOf(..).remainingToday`); undefined = uncapped */
  capRemaining?: Int;
}

export interface AuctionOutcome {
  /** the job's status (after the halt override) */
  status: RefStatusCode;
  regime: RegimeName;
  /** null when HALTED (no band is computed) */
  band: RegimeBand | null;
  /** false when HALTED or the daily cap is exhausted */
  ran: boolean;
  /** the clearing input with the curves merged (null when the auction did not run) */
  input: ClearingInput | null;
  result: ClearingResult;
  /** tick · tickSize, 0 without a trade */
  price: bigint;
  slots: CurveSlot[];
  curveFills: CurveFill[];
  bidBefore0: bigint;
  askBefore0: bigint;
}

const NO_TRADE: ClearingResult = {
  traded: false,
  tick: 0n,
  volume: 0n,
  bidMarginal: 0n,
  bidRatio: 0n,
  bidMarginalFill: 0n,
  askMarginal: 0n,
  askRatio: 0n,
  askMarginalFill: 0n,
};

/**
 * `_startAuction`: one batch auction as the exchange runs it — no auction while HALTED, the regime band, the TSV
 * daily volume cap (an exhausted cap means no auction; otherwise it caps the volume, not the price), the books and
 * the curve sources merged, `Clearing.compute`, then the sources' settlement.
 */
export function startAuction(a: AuctionInput): AuctionOutcome {
  const halted = a.regime.halted || BigInt(a.status) === BigInt(RefStatus.HALTED);
  const status = (halted ? RefStatus.HALTED : Number(a.status)) as RefStatusCode;
  const regime = deriveRegime({ status, lastStatus: a.market.lastStatus });
  const sources = a.sources ?? [];
  const out: AuctionOutcome = {
    status,
    regime,
    band: null,
    ran: false,
    input: null,
    result: { ...NO_TRADE },
    price: 0n,
    slots: sources.map(emptySlot),
    curveFills: sources.map(noFill),
    bidBefore0: 0n,
    askBefore0: 0n,
  };
  if (halted) return out;
  const b = regimeBand({ market: a.market, regime: a.regime, refPrice: a.refPrice, status, now: a.now });
  out.band = b;
  const cap = a.capRemaining === undefined ? undefined : BigInt(a.capRemaining);
  if (cap === 0n) return out;
  out.ran = true;
  const x = buildClearingInput(a.book, b);
  if (cap !== undefined) x.maxVolume = cap;
  const tickSize = BigInt(a.market.tickSize);
  const baseUnit = BigInt(a.market.baseUnit);
  out.slots = loadCurves(sources, {
    refPrice: BigInt(a.refPrice),
    status,
    refTick: b.refTick,
    lo: b.lo,
    hi: b.hi,
    tickSize,
    baseUnit,
  });
  out.input = mergeCurves(x, out.slots);
  out.result = compute(out.input);
  if (!out.result.traded) return out;
  out.price = out.result.tick * tickSize;
  const s = settleCurves(out.input, out.result, out.slots, { tickSize, baseUnit });
  out.curveFills = s.fills;
  out.bidBefore0 = s.bidBefore0;
  out.askBefore0 = s.askBefore0;
  return out;
}
