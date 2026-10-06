#!/usr/bin/env node
/**
 * Re-checks one Unison auction from the chain alone: no tape, no website.
 *
 *   node apps/web/scripts/verify-receipt.mjs <clear transaction hash> [--rpc https://rpc.monad.xyz] [--prev 0x<prevReceiptHash>]
 *
 * It checks:
 *   1. the receipt hash: keccak256(prev, market, upTo, tick, volume, refPrice, refTimeMs, status, block time) recomputes
 *      to what BatchCleared logged (prev is read from the exchange one block earlier, or passed with --prev);
 *   2. on a causal market (SPEC §7.4), against Chainlink's own history:
 *      - the round the auction names was observed exactly at the receipt's refTimeMs (Chainlink's startedAt, the time
 *        inside the report its oracles signed), strictly before that report landed on chain;
 *      - the newest order in the auction was sealed (its block's time) more than the market's skew before that;
 *      - the round before it was observed at or before that seal plus the skew: no earlier observation qualified.
 * Exit code 0 only if every check passes. The checks are the SDK's verifyReceipt, read from its source, so this runs
 * from a clone after `pnpm install` with nothing built.
 */
import { createPublicClient, http } from "viem";
import { NotAClearError, verifyReceipt } from "../../../packages/sdk/src/verify.ts";

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

let v;
try {
  v = await verifyReceipt(c, tx, { prev: opt("--prev") });
} catch (e) {
  if (!(e instanceof NotAClearError)) throw e;
  console.error(e.message);
  process.exit(2);
}
for (const s of v.steps) {
  if (s.kind === "check") console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.what}`);
  else if (s.kind === "skip") console.log(`SKIP  ${s.what}`);
  else if (s.kind === "note") console.log(`note  ${s.what}`);
  else console.log(s.what);
}
console.log(v.failures === 0 ? "\nevery check passed" : `\n${v.failures} check(s) failed`);
process.exit(v.failures === 0 ? 0 : 1);
