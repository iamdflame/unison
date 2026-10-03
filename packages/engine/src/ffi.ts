/**
 * Foundry FFI bridge for differential testing (contracts/test/diff). Usage:
 *   node src/ffi.ts clear <0x abi(lo,hi,refTick,bidAbove,askBelow,uint256[] bids,uint256[] asks)>
 *   node src/ffi.ts book  <0x abi(bool isBid,uint256 baseUnit,uint256[] ops)>
 *   node src/ffi.ts apportion <0x abi(uint256 need,uint256[] quantities)>
 * Prints one 0x-prefixed ABI-encoded result on stdout (Foundry decodes it as bytes).
 */
import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { compute } from "./clearing.ts";
import { apportionAll } from "./orders.ts";
import { BookLevel, POT, RET, type Snap } from "./book.ts";

const u = { type: "uint256" } as const;
const ua = { type: "uint256[]" } as const;

function clear(input: Hex): Hex {
  const [lo, hi, refTick, bidAbove, askBelow, bids, asks] = decodeAbiParameters([u, u, u, u, u, ua, ua], input);
  const r = compute({ lo, hi, refTick, bidAbove, askBelow, bids, asks });
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

const [cmd, arg] = process.argv.slice(2);
const handlers: Record<string, (h: Hex) => Hex> = { clear, apportion, book };
const h = cmd === undefined ? undefined : handlers[cmd];
if (h === undefined || arg === undefined || !arg.startsWith("0x")) {
  process.stderr.write("usage: ffi.ts <clear|apportion|book> <0xabi>\n");
  process.exit(2);
}
process.stdout.write(h(arg as Hex));
