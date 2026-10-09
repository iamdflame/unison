import { type Address, decodeEventLog, encodeAbiParameters, type Hex, keccak256, parseAbi, parseAbiItem, type PublicClient } from "viem";
import { unisonExchangeAbi } from "./abis/index.ts";
import { observation, sessionOpen } from "./causal.ts";
import { Status } from "./types.ts";

/**
 * Re-checks one Unison auction from the chain alone: no tape, no website. scripts/verify-receipt.mjs prints it, the
 * MetaMask Agent Wallet plugin's `unison receipt` returns it, and the receipt page runs it in the reader's browser.
 *
 *   1. the receipt hash: keccak256(prev, market, upTo, tick, volume, refPrice, refTimeMs, status, block time) recomputes
 *      to what BatchCleared logged (prev is read from the exchange one block earlier, or passed in);
 *   2. on a causal market (SPEC §7.4), the rule that bound the price, against Chainlink's own history. The contract
 *      binds every auction by one of two paths, and the receipt is checked against the one it took:
 *      - the causal rule (an observation after the orders): the round the auction names was observed exactly at the
 *        receipt's refTimeMs (Chainlink's startedAt, the time inside the report its oracles signed), strictly before
 *        that report landed on chain; the newest order in the auction was sealed (its block's time) more than the
 *        market's skew before that; the round before it was observed at or before the oldest waiting order's seal plus
 *        the skew, so no earlier observation qualified; and the next waiting order, if any, was sealed too late to
 *        belong to it, so none was left out;
 *      - a DISCOVERY call auction (no observation after the orders yet, and the market closed: its session over, or
 *        its feed silent past the maximum age): the round is the newest that had landed, observed no later than the
 *        oldest order's seal plus the skew, the market was closed when the auction cleared, and the band is the one
 *        the regime gives, widening with √time since the close;
 *   3. a halted auction trades nothing.
 */

/** One line of the verification, in order: a check that passed or failed, one that couldn't run, a note, a fact. */
export type VerifyStep =
  | { kind: "check"; ok: boolean; what: string }
  | { kind: "skip"; what: string }
  | { kind: "note"; what: string }
  | { kind: "info"; what: string };

/**
 * How the auction's price was bound. "causal": Chainlink's first observation after its orders. "discovery": a call
 * auction while the market was closed, at the last observation, inside a band. "halted": trading was stopped, no
 * price was used, and every waiting order went back. "clear-time": the older rule, a reference read at the clear.
 */
export type ReceiptRule = "causal" | "discovery" | "halted" | "clear-time";

export interface ReceiptVerification {
  tx: Hex;
  exchange: Address;
  marketId: bigint;
  upToBlock: bigint;
  clearedInBlock: bigint;
  tick: bigint;
  price: bigint;
  volume: bigint;
  refPrice: bigint;
  refTimeMs: bigint;
  status: number;
  receiptHash: Hex;
  rule: ReceiptRule;
  /** The Chainlink round the auction was bound to (the causal and DISCOVERY rules). `sealedAt` is the newest order's. */
  causal: { feed: Address; round: bigint; answer: bigint; observedAt: bigint; landedAt: bigint; sealedAt: bigint; skewSec: bigint } | null;
  steps: VerifyStep[];
  /** Checks that ran, and how many failed. `ok` is every check passing with at least one run. */
  checks: number;
  failures: number;
  ok: boolean;
}

/** The transaction is not the one that finished an auction. */
export class NotAClearError extends Error {
  readonly tx: Hex;
  constructor(tx: Hex) {
    super(`no BatchCleared in ${tx}: not the transaction that finished an auction`);
    this.name = "NotAClearError";
    this.tx = tx;
  }
}

const feedAbi = parseAbi([
  "function getRoundData(uint80) view returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80)",
]);
const adapterAbi = parseAbi([
  "function feeds(uint256) view returns (address base, address quote, uint8, uint8, uint8, uint32 maxAgeSec, uint32, uint32 openSec, uint32 closeSec, uint16, bool)",
]);
const causalReferenceEvent = parseAbiItem(
  "event CausalReference(uint256 indexed marketId, uint256 indexed upToBlock, uint80 round, uint256 sealedAt, uint256 observedAt)",
);

/** A chunked job binds its price a few blocks before it prints: look back this many 100-block windows (the public
 *  endpoint's log range) for the CausalReference it emitted. */
const LOOKBACK_WINDOWS = 3n;
/** pendingTimes reads at most this many waiting batches. */
const WAITING_MAX = 64n;

// viem reads uint32 and narrower as numbers, wider as bigints; the band maths takes either
type Int = number | bigint;
interface MarketAt {
  refAdapter: Address;
  bandBps: Int;
  minTick: Int;
  maxTick: Int;
  maxBandTicks: Int;
  tickSize: Int;
  receiptHash: Hex;
}
interface RegimeAt {
  discFloorBps: Int;
  discCapBps: Int;
  discHorizonSec: Int;
  closedSince: Int;
}

/** OpenZeppelin's Math.sqrt: the floor of the square root. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * The band of a DISCOVERY auction exactly as `ExchangeClearing._band` computes it with `_regimeBandBps` for a closed
 * market: centred on the reference tick, half-width bps = cap × √(time closed / horizon), at least the floor.
 */
export function discoveryBand(
  m: Pick<MarketAt, "bandBps" | "minTick" | "maxTick" | "maxBandTicks" | "tickSize">,
  g: RegimeAt,
  refPrice: bigint,
  nowSec: bigint,
): { refTick: bigint; lo: bigint; hi: bigint; bps: bigint; closedFor: bigint } {
  const tickSize = BigInt(m.tickSize);
  const minTick = BigInt(m.minTick);
  const maxTick = BigInt(m.maxTick);
  let refTick = (refPrice + tickSize / 2n) / tickSize;
  if (refTick < minTick) refTick = minTick;
  if (refTick > maxTick) refTick = maxTick;
  const closedSince = BigInt(g.closedSince);
  const since = closedSince === 0n ? nowSec : closedSince;
  let closedFor = nowSec > since ? nowSec - since : 0n;
  const h = BigInt(g.discHorizonSec);
  let bps: bigint;
  if (h === 0n) {
    bps = BigInt(g.discCapBps);
  } else {
    if (closedFor > h) closedFor = h;
    bps = (BigInt(g.discCapBps) * isqrt((closedFor * 10n ** 18n) / h)) / 10n ** 9n;
  }
  if (bps < BigInt(g.discFloorBps)) bps = BigInt(g.discFloorBps);
  if (bps === 0n) bps = BigInt(m.bandBps);
  let hw = (refTick * bps) / 10_000n;
  if (hw === 0n) hw = 1n;
  const maxHw = (BigInt(m.maxBandTicks) - 1n) / 2n;
  if (hw > maxHw) hw = maxHw;
  const lo = refTick > minTick + hw ? refTick - hw : minTick;
  const hi = refTick + hw < maxTick ? refTick + hw : maxTick;
  return { refTick, lo, hi, bps, closedFor };
}

export async function verifyReceipt(client: PublicClient, tx: Hex, opts: { prev?: Hex } = {}): Promise<ReceiptVerification> {
  const receipt = await client.getTransactionReceipt({ hash: tx });
  let print:
    | { marketId: bigint; upToBlock: bigint; tick: bigint; price: bigint; volume: bigint; refPrice: bigint; refTimeMs: bigint; status: number; bandLo: bigint; bandHi: bigint; receiptHash: Hex; exchange: Address }
    | undefined;
  let bound: { round: bigint; sealedAt: bigint; observedAt: bigint } | undefined;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: unisonExchangeAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "BatchCleared") print = { ...(ev.args as unknown as Omit<NonNullable<typeof print>, "exchange">), exchange: log.address };
      if (ev.eventName === "CausalReference") bound = ev.args as unknown as typeof bound;
    } catch {
      /* another contract's event */
    }
  }
  if (!print) throw new NotAClearError(tx);

  const steps: VerifyStep[] = [];
  const check = (ok: boolean, what: string) => steps.push({ kind: "check", ok, what });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const { exchange, marketId } = print;
  steps.push({ kind: "info", what: `auction: market ${marketId}, batches up to block ${print.upToBlock}, cleared in block ${receipt.blockNumber}` });
  steps.push({ kind: "info", what: `  price ${print.price}, volume ${print.volume}, reference ${print.refPrice} at ${print.refTimeMs} ms, status ${print.status}` });

  // 1. the receipt hash
  const marketBefore = (await client
    .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber - 1n })
    .catch(() => undefined)) as MarketAt | undefined;
  const prev = opts.prev ?? marketBefore?.receiptHash;
  if (!prev) {
    steps.push({ kind: "skip", what: "receipt hash: no state one block earlier on this RPC; pass --prev (the tape's prevReceiptHash)" });
  } else {
    const recomputed = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }],
        [prev, marketId, print.upToBlock, print.tick, print.volume, print.refPrice, print.refTimeMs, print.status, block.timestamp],
      ),
    );
    check(recomputed === print.receiptHash, `receipt hash recomputes: ${print.receiptHash}`);
  }

  // 2. the rule that bound the price
  // before the causal upgrade (6 Oct 2026) the exchange had no causalOf: every market priced at the clear
  const mode = (await client
    .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "causalOf", args: [marketId], blockNumber: receipt.blockNumber })
    .catch(() => ({ on: false, skewSec: 0 }))) as { on: boolean; skewSec: number | bigint };
  let boundBlock = receipt.blockNumber;
  if (!bound && mode.on) {
    // a chunked job emits CausalReference in the transaction that opened it, a few blocks before the print
    for (let w = 0n; w < LOOKBACK_WINDOWS && !bound; w++) {
      const toBlock = receipt.blockNumber - w * 100n;
      const logs = await client
        .getLogs({ address: exchange, event: causalReferenceEvent, args: { marketId, upToBlock: print.upToBlock }, fromBlock: toBlock - 99n, toBlock })
        .catch(() => []);
      const hit = logs.at(-1);
      if (hit) {
        bound = { round: hit.args.round!, sealedAt: hit.args.sealedAt!, observedAt: hit.args.observedAt! };
        boundBlock = hit.blockNumber!;
        steps.push({ kind: "note", what: `a chunked job: its price was bound in block ${boundBlock}, ${receipt.blockNumber - boundBlock} blocks before it cleared` });
      }
    }
  }

  let rule: ReceiptRule = "clear-time";
  let causal: ReceiptVerification["causal"] = null;
  if (!mode.on) {
    steps.push({ kind: "note", what: "an older-rule market: its reference is read at the clear, so there is no observation to check against the seal" });
  } else if (!bound) {
    if (print.status === Status.HALTED) {
      rule = "halted";
      steps.push({ kind: "note", what: "no oracle was read: trading was stopped, and every order that waited for this auction was returned" });
    } else {
      steps.push({ kind: "skip", what: `no CausalReference for this auction within ${LOOKBACK_WINDOWS * 100n} blocks of its clear` });
    }
  } else {
    const skew = BigInt(mode.skewSec);
    const m = (await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber })) as MarketAt;
    const [base, , , , , maxAgeSec, , openSec, closeSec] = await client.readContract({
      address: m.refAdapter,
      abi: adapterAbi,
      functionName: "feeds",
      args: [marketId],
      blockNumber: receipt.blockNumber,
    });
    const [, answer, startedAt, updatedAt] = await client.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round] });
    // the batches waiting when the job opened, oldest first: the contract's own view of who was in line
    const waiting = await client
      .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "pendingTimes", args: [marketId, WAITING_MAX], blockNumber: boundBlock - 1n })
      .then((r) => {
        const [batches, times] = r as readonly [readonly bigint[], readonly bigint[]];
        return batches.map((batch, i) => ({ batch, time: times[i]! }));
      })
      .catch(() => undefined);
    const oldest = waiting?.[0];
    rule = bound.observedAt > bound.sealedAt + skew ? "causal" : "discovery";
    causal = { feed: base, round: bound.round, answer, observedAt: startedAt, landedAt: updatedAt, sealedAt: bound.sealedAt, skewSec: skew };
    steps.push({ kind: "info", what: `  Chainlink feed ${base}, round ${bound.round}: answer ${answer}, observed ${startedAt}, landed ${updatedAt}` });
    check(startedAt * 1000n === print.refTimeMs, `the receipt's reference time is Chainlink's observation time (${startedAt})`);
    check(startedAt < updatedAt, "observed strictly before the report landed on chain (a signed observation, not a block time)");
    const hasPrev = (bound.round & 0xffffffffffffffffn) > 1n; // round 1 of a proxy phase has no predecessor in its phase

    if (rule === "causal") {
      const sealBlock = await client.getBlock({ blockNumber: print.upToBlock });
      check(sealBlock.timestamp === bound.sealedAt, `the newest order in the auction was sealed in block ${print.upToBlock}, at ${sealBlock.timestamp}`);
      check(startedAt > sealBlock.timestamp + skew, `observed ${startedAt - sealBlock.timestamp} s after the seal (more than the ${skew} s skew)`);
      if (hasPrev) {
        const [, , before] = await client.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round - 1n] });
        if (oldest) {
          check(
            before <= oldest.time + skew,
            `the round before it was observed at ${before}, no later than the oldest waiting order's seal (block ${oldest.batch}, at ${oldest.time}) plus the skew: no earlier observation qualified`,
          );
        } else {
          steps.push({ kind: "skip", what: "the oldest waiting order: this RPC keeps no state from when the job opened; checked against the newest instead" });
          check(before <= sealBlock.timestamp + skew, `the round before it was observed at ${before}, not after the seal: no earlier observation qualified`);
        }
      }
      if (!waiting) {
        steps.push({ kind: "skip", what: "none left out: this RPC keeps no state from when the job opened" });
      } else {
        const next = waiting.find((b) => b.batch > print.upToBlock);
        if (next) {
          check(
            next.time + skew >= startedAt,
            `the next waiting order, sealed in block ${next.batch} at ${next.time}, was not more than the skew before the observation: it waits for the next one, so none was left out`,
          );
        } else if (BigInt(waiting.length) >= WAITING_MAX) {
          steps.push({ kind: "skip", what: `none left out: more than ${WAITING_MAX} batches waited` });
        } else {
          steps.push({ kind: "note", what: "no other order was waiting: none was left out" });
        }
      }
    } else {
      check(print.status === Status.CLOSED || print.status === Status.HALTED, `the adapter vouched the market closed (status ${print.status === Status.HALTED ? "HALTED" : print.status === Status.CLOSED ? "CLOSED" : print.status})`);
      const newest = waiting?.filter((b) => b.batch <= print.upToBlock).at(-1);
      if (!waiting || !oldest || !newest) {
        steps.push({ kind: "skip", what: "the orders' seals: this RPC keeps no state from when the job opened" });
      } else {
        const sealBlock = await client.getBlock({ blockNumber: newest.batch });
        check(sealBlock.timestamp === bound.sealedAt && newest.time === bound.sealedAt, `the newest order in the auction was sealed in block ${newest.batch}, at ${newest.time}`);
        check(
          startedAt <= oldest.time + skew,
          `Chainlink's newest observation, at ${startedAt}, was no later than the oldest order's seal (${oldest.time}) plus the skew: no observation after the orders existed yet`,
        );
      }
      const next = await observation(client, base, bound.round + 1n);
      check(
        !next || next.arrivedAt >= block.timestamp,
        next ? `the next round landed at ${next.arrivedAt}, not before the clear: this was the newest observation` : "no newer round has landed: this was the newest observation",
      );
      const silentFor = block.timestamp - updatedAt;
      const sessionClosed = !sessionOpen(openSec, closeSec, block.timestamp);
      check(
        sessionClosed || silentFor > BigInt(maxAgeSec),
        sessionClosed
          ? "the market's session was closed when the auction cleared"
          : `the feed had been silent for ${silentFor} s when the auction cleared, past its ${maxAgeSec} s maximum age`,
      );
      if (print.status === Status.CLOSED) {
        const regime = (await client
          .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "regimeOf", args: [marketId], blockNumber: boundBlock - 1n })
          .catch(() => undefined)) as RegimeAt | undefined;
        if (!regime || !marketBefore || boundBlock !== receipt.blockNumber) {
          steps.push({ kind: "skip", what: "the band: this RPC keeps no state from before the auction, or the job ran over several blocks" });
        } else {
          const b = discoveryBand(marketBefore, regime, print.refPrice, block.timestamp);
          check(
            b.lo === print.bandLo && b.hi === print.bandHi,
            `the band is ticks ${b.lo}–${b.hi}: ${b.bps} bp each side of the last observation, after ${b.closedFor} s closed (it widens with √time)`,
          );
          if (print.volume > 0n) check(print.tick >= print.bandLo && print.tick <= print.bandHi, `the auction's price, tick ${print.tick}, is inside the band`);
        }
      }
    }
  }

  // 3. a halted auction trades nothing
  if (print.status === Status.HALTED) check(print.volume === 0n, "a halted auction trades nothing");

  const ran = steps.filter((s): s is Extract<VerifyStep, { kind: "check" }> => s.kind === "check");
  const failures = ran.filter((s) => !s.ok).length;
  return {
    tx,
    exchange,
    marketId,
    upToBlock: print.upToBlock,
    clearedInBlock: receipt.blockNumber,
    tick: print.tick,
    price: print.price,
    volume: print.volume,
    refPrice: print.refPrice,
    refTimeMs: print.refTimeMs,
    status: print.status,
    receiptHash: print.receiptHash,
    rule,
    causal,
    steps,
    checks: ran.length,
    failures,
    ok: ran.length > 0 && failures === 0,
  };
}
