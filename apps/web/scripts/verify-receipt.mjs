#!/usr/bin/env node
/**
 * Re-checks one Unison auction from the chain alone: no tape, no website.
 *
 *   node scripts/verify-receipt.mjs <clear transaction hash> [--rpc https://rpc.monad.xyz] [--prev 0x<prevReceiptHash>]
 *
 * It checks:
 *   1. the receipt hash: keccak256(prev, market, upTo, tick, volume, refPrice, refTimeMs, status, block time) recomputes
 *      to what BatchCleared logged (prev is read from the exchange one block earlier, or passed with --prev);
 *   2. on a causal market (SPEC §7.4), against Chainlink's own history:
 *      - the round the auction names was observed exactly at the receipt's refTimeMs (Chainlink's startedAt, the time
 *        inside the report its oracles signed), strictly before that report landed on chain;
 *      - the newest order in the auction was sealed (its block's time) more than the market's skew before that;
 *      - the round before it was observed at or before that seal plus the skew: no earlier observation qualified.
 * Exit code 0 only if every check passes.
 */
import { createPublicClient, decodeEventLog, encodeAbiParameters, http, keccak256, parseAbi } from "viem";
import { unisonExchangeAbi } from "@unison/sdk";

const args = process.argv.slice(2);
const tx = args.find((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!tx) {
  console.error("usage: verify-receipt.mjs <clear tx hash> [--rpc URL] [--prev 0x…]");
  process.exit(2);
}
const rpc = opt("--rpc") ?? process.env.RPC_URL ?? "https://rpc.monad.xyz";
const c = createPublicClient({ transport: http(rpc) });
const feedAbi = parseAbi([
  "function getRoundData(uint80) view returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80)",
]);
const adapterAbi = parseAbi([
  "function feeds(uint256) view returns (address base, address quote, uint8, uint8, uint8, uint32, uint32, uint32, uint32, uint16, bool)",
]);

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

const receipt = await c.getTransactionReceipt({ hash: tx });
let print;
let bound;
for (const log of receipt.logs) {
  try {
    const ev = decodeEventLog({ abi: unisonExchangeAbi, data: log.data, topics: log.topics });
    if (ev.eventName === "BatchCleared") print = { ...ev.args, exchange: log.address };
    if (ev.eventName === "CausalReference") bound = ev.args;
  } catch {
    /* another contract's event */
  }
}
if (!print) {
  console.error(`no BatchCleared in ${tx}: not the transaction that finished an auction`);
  process.exit(2);
}
const block = await c.getBlock({ blockNumber: receipt.blockNumber });
const exchange = print.exchange;
const marketId = print.marketId;
console.log(`auction: market ${marketId}, batches up to block ${print.upToBlock}, cleared in block ${receipt.blockNumber}`);
console.log(`  price ${print.price}, volume ${print.volume}, reference ${print.refPrice} at ${print.refTimeMs} ms, status ${print.status}`);

// 1. the receipt hash
const prev =
  opt("--prev") ??
  (await c
    .readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber - 1n })
    .then((m) => m.receiptHash)
    .catch(() => undefined));
if (!prev) {
  console.log("SKIP  receipt hash: no state one block earlier on this RPC; pass --prev (the tape's prevReceiptHash)");
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
if (!bound) {
  console.log("note  no CausalReference in this transaction: an older-rule market, or a job opened in an earlier one");
} else {
  const m = await c.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber });
  const mode = await c.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "causalOf", args: [marketId], blockNumber: receipt.blockNumber });
  const skew = BigInt(mode.skewSec);
  const [base] = await c.readContract({ address: m.refAdapter, abi: adapterAbi, functionName: "feeds", args: [marketId], blockNumber: receipt.blockNumber });
  const [, answer, startedAt, updatedAt] = await c.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round] });
  const sealBlock = await c.getBlock({ blockNumber: print.upToBlock });
  console.log(`  Chainlink feed ${base}, round ${bound.round}: answer ${answer}, observed ${startedAt}, landed ${updatedAt}`);
  check(startedAt * 1000n === print.refTimeMs, `the receipt's reference time is Chainlink's observation time (${startedAt})`);
  check(startedAt < updatedAt, "observed strictly before the report landed on chain (a signed observation, not a block time)");
  check(sealBlock.timestamp === bound.sealedAt, `the newest order was sealed in block ${print.upToBlock}, at ${sealBlock.timestamp}`);
  check(startedAt > sealBlock.timestamp + skew, `observed ${startedAt - sealBlock.timestamp} s after the seal (more than the ${skew} s skew)`);
  if ((bound.round & 0xffffffffffffffffn) > 1n) {
    const [, , before] = await c.readContract({ address: base, abi: feedAbi, functionName: "getRoundData", args: [bound.round - 1n] });
    check(before <= sealBlock.timestamp + skew, `the round before it was observed at ${before}, not after the seal: no earlier observation qualified`);
  }
}
console.log(failures === 0 ? "\nevery check passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
