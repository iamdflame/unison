/**
 * Foundry FFI bridge for differential testing (contracts/test/diff). Usage:
 *   node src/ffi.ts clear <0x abi(lo,hi,refTick,bidAbove,askBelow,uint256[] bids,uint256[] asks)>
 *   node src/ffi.ts book  <0x abi(bool isBid,uint256 baseUnit,uint256[] ops)>
 *   node src/ffi.ts apportion <0x abi(uint256 need,uint256[] quantities)>
 *   node src/ffi.ts regime  <0x abi(uint256[] words)>   (layouts at each handler)
 *   node src/ffi.ts curve   <0x abi(uint256[] words)>
 *   node src/ffi.ts auction <0x abi(uint256[] words)>
 *   node src/ffi.ts sqrt    <0x abi(uint256[] values)>
 * Prints one 0x-prefixed ABI-encoded result on stdout (Foundry decodes it as bytes).
 */
import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { compute } from "./clearing.ts";
import { sqrt } from "./math.ts";
import { apportionAll } from "./orders.ts";
import { BookLevel, POT, RET, type Snap } from "./book.ts";
import {
  deriveRegime,
  discoveryTooEarly,
  nextDiscoveryBatch,
  regimeAfterClear,
  regimeBand,
  REGIME_NAMES,
  type RegimeConfig,
} from "./regime.ts";
import {
  clipCurve,
  CurveRevert,
  emptyCurve,
  emptySlot,
  startAuction,
  vaultCurve,
  type BookLiquidity,
  type Curve,
  type CurveSourceState,
  type VaultParams,
} from "./curve.ts";

const u = { type: "uint256" } as const;
const ua = { type: "uint256[]" } as const;

function clear(input: Hex): Hex {
  const [lo, hi, refTick, bidAbove, askBelow, bids, asks, maxVolume] = decodeAbiParameters(
    [u, u, u, u, u, ua, ua, u],
    input,
  );
  const r = compute({ lo, hi, refTick, bidAbove, askBelow, bids, asks, maxVolume });
  return encodeAbiParameters(
    [{ type: "bool" }, u, u, u, u, u, u, u, u],
    [
      r.traded,
      r.tick,
      r.volume,
      r.bidMarginal,
      r.bidRatio,
      r.bidMarginalFill,
      r.askMarginal,
      r.askRatio,
      r.askMarginalFill,
    ],
  );
}

function apportion(input: Hex): Hex {
  const [need, qs] = decodeAbiParameters([u, ua], input);
  return encodeAbiParameters([ua], [apportionAll(need, qs)]);
}

/**
 * Replays an op list on one level. ops = flat triples [kind, a, b]:
 *   0 add(qty=a) | 1 fill(f=a, price=b) | 2 leave(order=a) | 3 drawFor(order=a) | 4 forceClose | 5 drawRet(order=a)
 * Output: flat uint256[] = per order [remainder, quote, closed, credited, returned], then the level words
 * [remaining, epoch, scale, closed, survival, pot, acc].
 */
function book(input: Hex): Hex {
  const [isBid, baseUnit, ops] = decodeAbiParameters([{ type: "bool" }, u, ua], input);
  const lvl = new BookLevel(isBid);
  const orders: { qty: bigint; snap: Snap; credited: bigint; returned: bigint }[] = [];
  for (let i = 0; i + 2 < ops.length; i += 3) {
    const kind = ops[i]!;
    const a = ops[i + 1]!;
    const b = ops[i + 2]!;
    if (kind === 0n) {
      orders.push({ qty: a, snap: lvl.add(a), credited: 0n, returned: 0n });
    } else if (kind === 1n) {
      lvl.fill(a, b, baseUnit);
    } else if (kind === 2n) {
      const o = orders[Number(a)]!;
      o.returned += lvl.leave(o.snap.epoch, lvl.value(o.snap, o.qty, baseUnit).remainder);
    } else if (kind === 3n) {
      const o = orders[Number(a)]!;
      const v = lvl.value(o.snap, o.qty, baseUnit);
      const target = isBid ? o.qty - v.remainder : v.quote;
      if (target > o.credited) o.credited += lvl.draw(o.snap.epoch, target - o.credited, POT);
    } else if (kind === 4n) {
      lvl.forceClose();
    } else if (kind === 5n) {
      const o = orders[Number(a)]!;
      o.returned += lvl.draw(o.snap.epoch, lvl.value(o.snap, o.qty, baseUnit).remainder, RET);
    } else {
      throw new Error(`unknown op ${kind}`);
    }
  }
  const out: bigint[] = [];
  for (const o of orders) {
    const v = lvl.value(o.snap, o.qty, baseUnit);
    out.push(v.remainder, v.quote, v.closed ? 1n : 0n, o.credited, o.returned);
  }
  const w = lvl.words;
  out.push(w.remaining, w.epoch, w.scale, w.closed ? 1n : 0n, w.survival, w.pot, w.acc);
  return encodeAbiParameters([ua], [out]);
}

/** Decodes a flat uint256[] argument and returns a checked word reader. */
function words(input: Hex): (i: number) => bigint {
  const [w] = decodeAbiParameters([ua], input);
  return (i: number) => {
    const v = w[i];
    if (v === undefined) throw new Error(`missing input word ${i}`);
    return v;
  };
}

const flat = (out: readonly bigint[]): Hex => encodeAbiParameters([ua], [out]);

/** ExchangeBase.Regime from 9 consecutive words. */
const regimeAt = (w: (i: number) => bigint, o: number): RegimeConfig => ({
  extBandBps: w(o),
  reopenBandBps: w(o + 1),
  discFloorBps: w(o + 2),
  discCapBps: w(o + 3),
  discHorizonSec: w(o + 4),
  discCadence: w(o + 5),
  halted: w(o + 6) !== 0n,
  closedSince: w(o + 7),
  lastDiscoveryBatch: w(o + 8),
});

/** LiquidityVault.Params from 9 consecutive words. */
const vaultParamsAt = (w: (i: number) => bigint, o: number): VaultParams => ({
  spreadBps: w(o),
  depthBps: w(o + 1),
  widthTicks: w(o + 2),
  maxSkewTicks: w(o + 3),
  maxAuctionBps: w(o + 4),
  swingBps: w(o + 5),
  extMult: w(o + 6),
  closedMult: w(o + 7),
  paused: w(o + 8) !== 0n,
});

const curveWords = (c: Curve): bigint[] => [c.bidTop, c.bidTicks, c.bidPerTick, c.askBottom, c.askTicks, c.askPerTick];

/** in: values; out: ⌊√v⌋ of each (OZ Math.sqrt). */
function isqrt(input: Hex): Hex {
  const [vs] = decodeAbiParameters([ua], input);
  return flat(vs.map(sqrt));
}

/**
 * in:  [refPrice, tickSize, minTick, maxTick, maxBandTicks, bandBps, lastStatus, status, now, regime(9 words),
 *       upTo, lastCleared, refTimeMs]
 * out: [refTick, lo, hi, bandBps, tooEarly, regime (index in REGIME_NAMES), nextDiscoveryBatch,
 *       closedSince', lastDiscoveryBatch', lastStatus']
 */
function regime(input: Hex): Hex {
  const w = words(input);
  const g = regimeAt(w, 9);
  const status = w(7);
  const b = regimeBand({
    market: { tickSize: w(1), minTick: w(2), maxTick: w(3), maxBandTicks: w(4), bandBps: w(5), lastStatus: w(6) },
    regime: g,
    refPrice: w(0),
    status,
    now: w(8),
  });
  const name = deriveRegime({ status, lastStatus: w(6), halted: g.halted });
  const t = regimeAfterClear({ regime: g, status, refTimeMs: w(20), upTo: w(18) });
  return flat([
    b.refTick,
    b.lo,
    b.hi,
    b.bandBps,
    discoveryTooEarly({ regime: g, status, upTo: w(18) }) ? 1n : 0n,
    BigInt(REGIME_NAMES.indexOf(name)),
    nextDiscoveryBatch({ regime: g, lastCleared: w(19) }),
    t.closedSince,
    t.lastDiscoveryBatch,
    BigInt(t.lastStatus),
  ]);
}

/**
 * in:  [vault params(9 words), baseBalance, quoteBalance, baseUnit, refPrice, status, refTick, lo, hi, tickSize]
 * out: [reverted (0 no, 1 curve(), 2 clipping), curve(6 words), slot(bidLo, bidHi, bidQ, askLo, askHi, askQ)]
 */
function curve(input: Hex): Hex {
  const w = words(input);
  let reverted = 0n;
  let c = emptyCurve();
  let s = emptySlot();
  try {
    c = vaultCurve({
      params: vaultParamsAt(w, 0),
      baseBalance: w(9),
      quoteBalance: w(10),
      baseUnit: w(11),
      refPrice: w(12),
      status: w(13),
      refTick: w(14),
    });
  } catch (e) {
    if (!(e instanceof CurveRevert)) throw e;
    reverted = 1n;
  }
  if (reverted === 0n) {
    try {
      s = clipCurve(c, { lo: w(15), hi: w(16), tickSize: w(17), baseUnit: w(11), baseBalance: w(9), quoteBalance: w(10) });
    } catch (e) {
      if (!(e instanceof CurveRevert)) throw e;
      reverted = 2n;
    }
  }
  return flat([reverted, ...curveWords(c), s.bidLo, s.bidHi, s.bidQ, s.askLo, s.askHi, s.askQ]);
}

/**
 * One auction end to end (startAuction).
 * in:  [refPrice, tickSize, minTick, maxTick, maxBandTicks, bandBps, baseUnit, status, lastStatus, now,
 *       regime(9 words), nSources, nOrders,
 *       nSources × [kind (0 vault | 1 fixed curve), vault params(9) | curve(6) + 3 zero words, base, quote],
 *       nOrders × [side, tick, qty]]
 * out: [ran, lo, hi, refTick, bandBps, traded, tick, volume, price,
 *       nSources × [curve(6), slot(6), boughtBase, paidQuote, soldBase, receivedQuote]]
 */
function auction(input: Hex): Hex {
  const w = words(input);
  const baseUnit = w(6);
  const nSources = Number(w(19));
  const nOrders = Number(w(20));
  const sources: CurveSourceState[] = [];
  const curves: Curve[] = [];
  let o = 21;
  for (let i = 0; i < nSources; i++, o += 12) {
    const baseBalance = w(o + 10);
    const quoteBalance = w(o + 11);
    if (w(o) === 0n) {
      const params = vaultParamsAt(w, o + 1);
      const idx = i;
      curves.push(emptyCurve()); // stays empty if the vault's curve() reverts
      sources.push({
        baseBalance,
        quoteBalance,
        curve: (q) =>
          (curves[idx] = vaultCurve({ params, baseBalance, quoteBalance, baseUnit, ...q })),
      });
    } else {
      const c: Curve = {
        bidTop: w(o + 1),
        bidTicks: w(o + 2),
        bidPerTick: w(o + 3),
        askBottom: w(o + 4),
        askTicks: w(o + 5),
        askPerTick: w(o + 6),
      };
      curves.push(c);
      sources.push({ curve: c, baseBalance, quoteBalance });
    }
  }
  const book: BookLiquidity[] = [];
  for (let i = 0; i < nOrders; i++, o += 3) book.push({ side: w(o), tick: w(o + 1), qty: w(o + 2) });
  const r = startAuction({
    market: { tickSize: w(1), minTick: w(2), maxTick: w(3), maxBandTicks: w(4), bandBps: w(5), lastStatus: w(8), baseUnit },
    regime: regimeAt(w, 10),
    refPrice: w(0),
    status: w(7),
    now: w(9),
    book,
    sources,
  });
  const b = r.band;
  const out: bigint[] = [
    r.ran ? 1n : 0n,
    b?.lo ?? 0n,
    b?.hi ?? 0n,
    b?.refTick ?? 0n,
    b?.bandBps ?? 0n,
    r.result.traded ? 1n : 0n,
    r.result.tick,
    r.result.volume,
    r.price,
  ];
  for (let i = 0; i < nSources; i++) {
    const s = r.slots[i]!;
    const f = r.curveFills[i]!;
    out.push(...curveWords(curves[i]!), s.bidLo, s.bidHi, s.bidQ, s.askLo, s.askHi, s.askQ);
    out.push(f.boughtBase, f.paidQuote, f.soldBase, f.receivedQuote);
  }
  return flat(out);
}

const [cmd, arg] = process.argv.slice(2);
const handlers: Record<string, (h: Hex) => Hex> = { clear, apportion, book, regime, curve, auction, sqrt: isqrt };
const h = cmd === undefined ? undefined : handlers[cmd];
if (h === undefined || arg === undefined || !arg.startsWith("0x")) {
  process.stderr.write("usage: ffi.ts <clear|apportion|book|regime|curve|auction|sqrt> <0xabi>\n");
  process.exit(2);
}
process.stdout.write(h(arg as Hex));
