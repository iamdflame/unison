/**
 * A deterministic, seeded Unison market on the real engine. Each `step()` is one block:
 *   1. traders arrive (Poisson per side) and price their limits off the LAST published reference
 *   2. the batch closes; the reference published after it moves (GBM with Poisson news jumps)
 *   3. one uniform-price auction, exactly as the exchange runs it (`startAuction`): the band around the new
 *      reference, the resting book, the LiquidityVault curve clipped and capped by its inventory
 *   4. fills are applied in the exchange's priority order (outside the band, better ticks in full, the marginal
 *      tick by exact cumulative apportionment after the vault), the vault settles at the auction price
 *   5. filled, IOC and expired orders leave the book
 * Same seed → same batches, on every engine (see rng.ts).
 */
import {
  apportion,
  askLevelTick,
  bidLevelTick,
  defaultRegime,
  emptyCurve,
  RefStatus,
  slotLevels,
  startAuction,
  vaultCurve,
  type ClearingInput,
  type ClearingResult,
  type Curve,
  type CurveFill,
  type CurveQuery,
  type CurveSlot,
  type CurveSourceState,
  type VaultParams,
} from "@unison/engine";
import { createRng, detExp } from "./rng.ts";

type Int = bigint | number;

export interface SimVaultConfig {
  /** overrides of the LiquidityVault parameters (default: the aNVDA mainnet calibration) */
  params?: Partial<VaultParams>;
  /** starting NAV in whole quote tokens (default 1,000,000) */
  nav?: number;
  /** starting share of the NAV held in base, 0..1 (default 0.5) */
  baseShare?: number;
}

export interface SimConfig {
  seed: number;
  /** e.g. "aNVDA/AUSD" */
  symbol: string;
  /** starting reference: quote units per whole base token (180_000_000n = $180.00 with a 6-decimal quote) */
  refPrice: Int;
  /** quote units per tick */
  tickSize: Int;
  /** 10 ** baseDecimals */
  baseUnit: Int;
  /** live band half-width in bps */
  bandBps: number;
  /** the market's LiquidityVault (default: $1M, half in base); false = no vault */
  vault?: SimVaultConfig | false;
  /** decimals of the quote token (default 6) */
  quoteDecimals?: number;
  maxBandTicks?: number;
  minTick?: number;
  maxTick?: number;
  /** block time in ms (default 400) */
  blockMs?: number;
  /** first block number (default 1) */
  startBlock?: number;
  /** unix ms of the block before the first step (default 1_760_000_000_000) */
  startTime?: number;
  /** annualized volatility of the reference (default 0.45) */
  sigma?: number;
  /** news jumps per day (default 24) and their size, a fraction of the price (default 0.004) */
  jumpsPerDay?: number;
  jumpSd?: number;
  /** mean order arrivals per block per side (default 2) */
  arrivalsPerBlock?: number;
  /** mean order notional in whole quote tokens (default 5,000) */
  meanOrderQuote?: number;
  /** mean (aggression toward crossing) and dispersion of limits around the last reference, bps (3 and 12) */
  aggressionBps?: number;
  limitSdBps?: number;
  /** share of IOC orders (default 0.25); GTC orders rest for an exponential number of blocks (mean 20) */
  iocShare?: number;
  restBlocks?: number;
  /** quantity granularity in decimals of the base token (default 3: 0.001) */
  lotDecimals?: number;
}

/** Liquidity at one limit tick. */
export interface SimLevel {
  tick: bigint;
  qty: bigint;
}

/** A trader order in one auction. */
export interface SimOrderFill {
  id: number;
  /** 0 = BID, 1 = ASK */
  side: 0 | 1;
  /** limit tick */
  tick: bigint;
  /** open quantity going into this auction */
  qty: bigint;
  /** filled in this auction */
  filled: bigint;
  ioc: boolean;
  /** block the order was placed in */
  placed: number;
}

export interface SimVaultBatch {
  /** the vault's curve for this auction and the part of it the exchange used (clipped, capped) */
  curve: Curve;
  slot: CurveSlot;
  fill: CurveFill;
  /** ledger balances after the auction */
  base: bigint;
  quote: bigint;
}

export interface Batch {
  block: number;
  /** unix ms */
  ts: number;
  /** reference published after the batch closed */
  ref: bigint;
  refTick: bigint;
  bandLo: bigint;
  bandHi: bigint;
  /** resting liquidity by limit tick (trader orders + the vault's clipped curve), best first */
  bids: SimLevel[];
  asks: SimLevel[];
  result: ClearingResult;
  /** uniform price: tick · tickSize (0 without a trade) */
  price: bigint;
  volume: bigint;
  /** every trader order in the book at the auction, with its fill */
  orders: SimOrderFill[];
  vault: SimVaultBatch | null;
  /** the clearing input (book + vault curve over the band) — `curves()` draws it */
  input: ClearingInput;
}

interface RestingOrder {
  id: number;
  side: 0 | 1;
  tick: bigint;
  qty: bigint;
  ioc: boolean;
  placed: number;
  expires: number;
}

export interface SimState {
  readonly symbol: string;
  block: number;
  ts: number;
  /** last published reference */
  ref: bigint;
  /** the reference path in floating point (quote units) */
  refFloat: number;
  /** resting trader orders after the last batch */
  book: RestingOrder[];
  vault: { params: VaultParams; base: bigint; quote: bigint } | null;
  /** base traded so far */
  volume: bigint;
  batches: number;
  nextOrderId: number;
}

export interface Sim {
  step(): Batch;
  readonly state: SimState;
}

/** The aNVDA/AUSD vault calibration of deploy/monad-mainnet.json. */
export const DEFAULT_VAULT_PARAMS: VaultParams = {
  spreadBps: 10,
  depthBps: 40,
  widthTicks: 10,
  maxSkewTicks: 15,
  maxAuctionBps: 1_000,
  swingBps: 30,
  extMult: 2,
  closedMult: 4,
  paused: false,
};

const YEAR_MS = 365 * 86_400_000;
const DAY_MS = 86_400_000;

const pow10 = (d: number): bigint => 10n ** BigInt(d);

export function createSim(cfg: SimConfig): Sim {
  const rng = createRng(cfg.seed);
  const tickSize = BigInt(cfg.tickSize);
  const baseUnit = BigInt(cfg.baseUnit);
  if (tickSize <= 0n || baseUnit <= 0n) throw new RangeError("tickSize and baseUnit must be positive");
  const quoteUnit = pow10(cfg.quoteDecimals ?? 6);
  const blockMs = cfg.blockMs ?? 400;
  const minTick = BigInt(cfg.minTick ?? 1);
  const maxTick = BigInt(cfg.maxTick ?? (1 << 21) - 1);
  const market = {
    tickSize,
    minTick,
    maxTick,
    maxBandTicks: cfg.maxBandTicks ?? 4001,
    bandBps: cfg.bandBps,
    lastStatus: RefStatus.OPEN,
    baseUnit,
  };
  const regime = defaultRegime(cfg.bandBps);
  const sigmaBlock = (cfg.sigma ?? 0.45) * Math.sqrt(blockMs / YEAR_MS);
  const drift = -0.5 * sigmaBlock * sigmaBlock;
  const jumpP = ((cfg.jumpsPerDay ?? 24) * blockMs) / DAY_MS;
  const jumpSd = cfg.jumpSd ?? 0.004;
  const lambda = cfg.arrivalsPerBlock ?? 2;
  const meanQuote = cfg.meanOrderQuote ?? 5_000;
  const aggression = cfg.aggressionBps ?? 3;
  const limitSd = cfg.limitSdBps ?? 12;
  const iocShare = cfg.iocShare ?? 0.25;
  const restBlocks = cfg.restBlocks ?? 20;
  const lotDecimals = cfg.lotDecimals ?? 3;
  const lot = baseUnit / pow10(lotDecimals) > 0n ? baseUnit / pow10(lotDecimals) : 1n;
  const lotsPerToken = Number(baseUnit / lot);
  const quoteUnitF = Number(quoteUnit);
  const tickSizeF = Number(tickSize);

  const ref0 = BigInt(cfg.refPrice);
  if (ref0 <= 0n) throw new RangeError("refPrice must be positive");
  let vault: SimState["vault"] = null;
  if (cfg.vault !== false) {
    const v = cfg.vault ?? {};
    const nav = BigInt(Math.round(v.nav ?? 1_000_000)) * quoteUnit;
    const share = BigInt(Math.round(Math.min(1, Math.max(0, v.baseShare ?? 0.5)) * 1_000_000));
    const quote = (nav * (1_000_000n - share)) / 1_000_000n;
    vault = { params: { ...DEFAULT_VAULT_PARAMS, ...v.params }, base: ((nav - quote) * baseUnit) / ref0, quote };
  }

  const state: SimState = {
    symbol: cfg.symbol,
    block: (cfg.startBlock ?? 1) - 1,
    ts: cfg.startTime ?? 1_760_000_000_000,
    ref: ref0,
    refFloat: Number(ref0),
    book: [],
    vault,
    volume: 0n,
    batches: 0,
    nextOrderId: 1,
  };

  const clampTick = (t: bigint) => (t < minTick ? minTick : t > maxTick ? maxTick : t);

  /** A trader prices off the last published reference: buyers round their limit down, sellers up. */
  function arrive(side: 0 | 1, refF: number) {
    const off = (aggression + limitSd * rng.normal()) / 10_000;
    const limit = side === 0 ? refF * (1 + off) : refF * (1 - off);
    const t = side === 0 ? Math.floor(limit / tickSizeF) : Math.ceil(limit / tickSizeF);
    const tick = clampTick(BigInt(Math.max(1, t)));
    const price = Number(tick) * tickSizeF;
    const lots = Math.max(1, Math.round(((rng.exponential(meanQuote) * quoteUnitF) / price) * lotsPerToken));
    const ioc = rng.next() < iocShare;
    const life = ioc ? 0 : 1 + Math.floor(rng.exponential(restBlocks));
    state.book.push({
      id: state.nextOrderId++,
      side,
      tick,
      qty: BigInt(lots) * lot,
      ioc,
      placed: state.block,
      expires: state.block + life,
    });
  }

  function step(): Batch {
    state.block += 1;
    state.ts += blockMs;

    // 1. arrivals during the block, priced off the last published reference
    const refPrev = state.refFloat;
    for (const side of [0, 1] as const) {
      const k = rng.poisson(lambda);
      for (let i = 0; i < k; i++) arrive(side, refPrev);
    }

    // 2. the reference published after the batch closed
    const jump = rng.next() < jumpP ? jumpSd * rng.normal() : 0;
    state.refFloat *= detExp(drift + sigmaBlock * rng.normal() + jump);
    const ref = BigInt(Math.max(1, Math.round(state.refFloat)));
    state.ref = ref;

    // 3. the auction, exactly as the exchange runs it
    const v = state.vault;
    let raw = emptyCurve(); // the vault's curve() answer (stays empty if it would revert)
    const sources: CurveSourceState[] = v
      ? [
          {
            baseBalance: v.base,
            quoteBalance: v.quote,
            curve: (q: CurveQuery) =>
              (raw = vaultCurve({ params: v.params, baseBalance: v.base, quoteBalance: v.quote, baseUnit, ...q })),
          },
        ]
      : [];
    const out = startAuction({
      market,
      regime,
      refPrice: ref,
      status: RefStatus.OPEN,
      now: Math.floor(state.ts / 1000),
      book: state.book,
      sources,
    });
    const input = out.input!;
    const band = out.band!;

    // 4. fills in the exchange's priority order
    const filled = applyFills(out.result, input, state.book, out.bidBefore0, out.askBefore0);
    const orders: SimOrderFill[] = state.book.map((o, i) => ({
      id: o.id,
      side: o.side,
      tick: o.tick,
      qty: o.qty,
      filled: filled[i]!,
      ioc: o.ioc,
      placed: o.placed,
    }));
    let vaultBatch: SimVaultBatch | null = null;
    if (v) {
      const f = out.curveFills[0]!;
      v.base += f.boughtBase - f.soldBase;
      v.quote += f.receivedQuote - f.paidQuote;
      vaultBatch = {
        curve: raw,
        slot: out.slots[0]!,
        fill: f,
        base: v.base,
        quote: v.quote,
      };
    }
    const levels = bookLevels(state.book, v ? out.slots[0]! : null, band.lo, band.hi);

    // 5. the book after the auction
    const next: RestingOrder[] = [];
    state.book.forEach((o, i) => {
      const rest = o.qty - filled[i]!;
      if (rest > 0n && !o.ioc && o.expires > state.block) next.push({ ...o, qty: rest });
    });
    state.book = next;
    state.volume += out.result.volume;
    state.batches += 1;

    return {
      block: state.block,
      ts: state.ts,
      ref,
      refTick: band.refTick,
      bandLo: band.lo,
      bandHi: band.hi,
      bids: levels.bids,
      asks: levels.asks,
      result: out.result,
      price: out.price,
      volume: out.result.volume,
      orders,
      vault: vaultBatch,
      input,
    };
  }

  return { step, state };
}

/**
 * The exchange's APPLY phase for individual orders: per side, the class outside the band first, then in-band ticks
 * better than the marginal tick in full, then the marginal class by exact cumulative apportionment — continuing
 * after the curve sources at the marginal tick (`bidBefore0` / `askBefore0`), so the fills sum exactly to the
 * auction volume.
 */
export function applyFills(
  r: ClearingResult,
  x: ClearingInput,
  book: readonly { side: number; tick: bigint; qty: bigint }[],
  bidBefore0 = 0n,
  askBefore0 = 0n,
): bigint[] {
  const out = new Array<bigint>(book.length).fill(0n);
  if (!r.traded) return out;
  const n = x.bids.length;
  for (const side of [0, 1] as const) {
    const isBid = side === 0;
    const marg = isBid ? r.bidMarginal : r.askMarginal;
    const need = isBid ? r.bidMarginalFill : r.askMarginalFill;
    const classQ = isBid
      ? marg === 0n
        ? x.bidAbove
        : x.bids[n - Number(marg)]!
      : marg === 0n
        ? x.askBelow
        : x.asks[Number(marg) - 1]!;
    const tm = marg === 0n ? -1n : isBid ? bidLevelTick(x.hi, marg) : askLevelTick(x.lo, marg);
    let before = marg === 0n ? 0n : isBid ? bidBefore0 : askBefore0;
    // visiting order inside the marginal class: tick, then arrival
    const idx = book
      .map((_, i) => i)
      .filter((i) => book[i]!.side === side)
      .sort((a, b) => {
        const ta = book[a]!.tick;
        const tb = book[b]!.tick;
        return ta === tb ? a - b : ta < tb ? -1 : 1;
      });
    for (const i of idx) {
      const o = book[i]!;
      const outside = isBid ? o.tick > x.hi : o.tick < x.lo;
      const unreachable = isBid ? o.tick < x.lo : o.tick > x.hi;
      if (unreachable) continue;
      let f = 0n;
      if (outside) {
        if (marg === 0n) {
          f = apportion(need, before, o.qty, classQ);
          before += o.qty;
        } else f = o.qty;
      } else if (marg !== 0n) {
        const better = isBid ? o.tick > tm : o.tick < tm;
        if (better) f = o.qty;
        else if (o.tick === tm) {
          f = apportion(need, before, o.qty, classQ);
          before += o.qty;
        }
      }
      out[i] = f;
    }
  }
  return out;
}

/** Book levels by limit tick (orders + the vault's clipped curve), bids high→low, asks low→high. */
function bookLevels(
  book: readonly RestingOrder[],
  slot: CurveSlot | null,
  lo: bigint,
  hi: bigint,
): { bids: SimLevel[]; asks: SimLevel[] } {
  const bids = new Map<bigint, bigint>();
  const asks = new Map<bigint, bigint>();
  for (const o of book) {
    const m = o.side === 0 ? bids : asks;
    m.set(o.tick, (m.get(o.tick) ?? 0n) + o.qty);
  }
  if (slot) {
    const lv = slotLevels(slot, lo, hi);
    lv.bids.forEach((q, i) => {
      if (q !== 0n) bids.set(lo + BigInt(i), (bids.get(lo + BigInt(i)) ?? 0n) + q);
    });
    lv.asks.forEach((q, i) => {
      if (q !== 0n) asks.set(lo + BigInt(i), (asks.get(lo + BigInt(i)) ?? 0n) + q);
    });
  }
  const sorted = (m: Map<bigint, bigint>, desc: boolean) =>
    [...m.entries()]
      .map(([tick, qty]) => ({ tick, qty }))
      .sort((a, b) => (a.tick === b.tick ? 0 : (a.tick < b.tick) !== desc ? -1 : 1));
  return { bids: sorted(bids, true), asks: sorted(asks, false) };
}

/** Cumulative curves of a batch over its band, for a cross chart: demand D(t) falls, supply S(t) rises. */
export function curves(batch: Pick<Batch, "input">): { ticks: bigint[]; demand: bigint[]; supply: bigint[] } {
  const x = batch.input;
  const n = x.bids.length;
  const ticks = new Array<bigint>(n);
  const demand = new Array<bigint>(n);
  const supply = new Array<bigint>(n);
  let d = x.bidAbove;
  for (let i = n - 1; i >= 0; i--) {
    d += x.bids[i]!;
    demand[i] = d;
  }
  let s = x.askBelow;
  for (let i = 0; i < n; i++) {
    s += x.asks[i]!;
    supply[i] = s;
    ticks[i] = x.lo + BigInt(i);
  }
  return { ticks, demand, supply };
}
