import { type Address, decodeEventLog, encodeAbiParameters, type Hex, keccak256, parseAbi, type PublicClient } from "viem";
import { unisonExchangeAbi } from "./abis/index.ts";

/**
 * Re-checks one Unison auction from the chain alone: no tape, no website. scripts/verify-receipt.mjs prints it; the
 * MetaMask Agent Wallet plugin's `unison receipt` returns it.
 *
 *   1. the receipt hash: keccak256(prev, market, upTo, tick, volume, refPrice, refTimeMs, status, block time) recomputes
 *      to what BatchCleared logged (prev is read from the exchange one block earlier, or passed in);
 *   2. on a causal market (SPEC §7.4), against Chainlink's own history:
 *      - the round the auction names was observed exactly at the receipt's refTimeMs (Chainlink's startedAt, the time
 *        inside the report its oracles signed), strictly before that report landed on chain;
 *      - the newest order in the auction was sealed (its block's time) more than the market's skew before that;
 *      - the round before it was observed at or before that seal plus the skew: no earlier observation qualified.
 */

/** One line of the verification, in order: a check that passed or failed, one that couldn't run, a note, a fact. */
export type VerifyStep =
  | { kind: "check"; ok: boolean; what: string }
  | { kind: "skip"; what: string }
  | { kind: "note"; what: string }
  | { kind: "info"; what: string };

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
  /** The Chainlink round the auction priced at, when the clear bound one (a causal market). */
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
  "function feeds(uint256) view returns (address base, address quote, uint8, uint8, uint8, uint32, uint32, uint32, uint32, uint16, bool)",
]);

export async function verifyReceipt(client: PublicClient, tx: Hex, opts: { prev?: Hex } = {}): Promise<ReceiptVerification> {
  const receipt = await client.getTransactionReceipt({ hash: tx });
  let print: { marketId: bigint; upToBlock: bigint; tick: bigint; price: bigint; volume: bigint; refPrice: bigint; refTimeMs: bigint; status: number; receiptHash: Hex; exchange: Address } | undefined;
  let bound: { round: bigint; sealedAt: bigint } | undefined;
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
  const prev =
    opts.prev ??
    (await client
      .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber - 1n })
      .then((m) => (m as { receiptHash: Hex }).receiptHash)
      .catch(() => undefined));
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

  // 2. the causal clock
  let causal: ReceiptVerification["causal"] = null;
  if (!bound) {
    steps.push({ kind: "note", what: "no CausalReference in this transaction: an older-rule market, or a job opened in an earlier one" });
  } else {
    const m = (await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber })) as { refAdapter: Address };
    const mode = (await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "causalOf", args: [marketId], blockNumber: receipt.blockNumber })) as { skewSec: number | bigint };
    const skew = BigInt(mode.skewSec);
    const [base] = await client.readContract({ address: m.refAdapter, abi: adapterAbi, functionName: "feeds", args: [marketId], blockNumber: receipt.blockNumber });
    const [, answer, startedAt, updatedAt] = await client.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round] });
    const sealBlock = await client.getBlock({ blockNumber: print.upToBlock });
    causal = { feed: base, round: bound.round, answer, observedAt: startedAt, landedAt: updatedAt, sealedAt: sealBlock.timestamp, skewSec: skew };
    steps.push({ kind: "info", what: `  Chainlink feed ${base}, round ${bound.round}: answer ${answer}, observed ${startedAt}, landed ${updatedAt}` });
    check(startedAt * 1000n === print.refTimeMs, `the receipt's reference time is Chainlink's observation time (${startedAt})`);
    check(startedAt < updatedAt, "observed strictly before the report landed on chain (a signed observation, not a block time)");
    check(sealBlock.timestamp === bound.sealedAt, `the newest order was sealed in block ${print.upToBlock}, at ${sealBlock.timestamp}`);
    check(startedAt > sealBlock.timestamp + skew, `observed ${startedAt - sealBlock.timestamp} s after the seal (more than the ${skew} s skew)`);
    if ((bound.round & 0xffffffffffffffffn) > 1n) {
      const [, , before] = await client.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round - 1n] });
      check(before <= sealBlock.timestamp + skew, `the round before it was observed at ${before}, not after the seal: no earlier observation qualified`);
    }
  }

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
    causal,
    steps,
    checks: ran.length,
    failures,
    ok: ran.length > 0 && failures === 0,
  };
}
