#!/usr/bin/env node
/**
 * Writes the record of the mainnet beta's linked receipts, read from the chain alone, so their pages need no tape.
 *
 *   node apps/web/scripts/archive-receipts.mjs [--rpc https://rpc.monad.xyz] [<market>/<upTo> ...]
 *
 * The tape served each receipt page its auction's print. With the beta concluded the tape is off, so this rebuilds the
 * same print for every receipt the repository, the README or a public post links to: the BatchCleared event the clear
 * emitted, the block it landed in, the market's state one block earlier (the previous receipt hash and status), and
 * the SDK's verifyReceipt for the rule, the Chainlink round and the checks. It refuses to write a receipt whose checks
 * do not all pass. The reader's browser still runs those checks again, against the chain, on the page.
 *
 * Output: apps/web/lib/content/receipts.generated.ts (committed: the site reads it at build time).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http } from "viem";
import { unisonExchangeAbi } from "../../../packages/sdk/src/abis/index.ts";
import { bpsDiff } from "../../../packages/sdk/src/prices.ts";
import { verifyReceipt } from "../../../packages/sdk/src/verify.ts";

// every /receipt/mainnet/<market>/<upTo> the repository links to (grep -r "receipt/mainnet/"), 20 November 2026
const LINKED = [
  "1/111055816", // the first causal print: README, docs/evidence/mainnet.md, the submission
  "1/111160954",
  "1/111161153",
  "1/111182123",
  "1/111200305",
  "1/111200949",
  "1/111201695",
  "1/111202438",
  "1/111216533",
  "1/111237596",
];

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const rpc = opt("--rpc") ?? process.env.RPC_URL ?? "https://rpc.monad.xyz";
const wanted = [...new Set([...LINKED, ...args.filter((a) => /^\d+\/\d+$/.test(a))])];
const deployment = JSON.parse(readFileSync(new URL("../../../deployments/monad-mainnet.json", import.meta.url), "utf8"));
const exchange = deployment.exchange;
const client = createPublicClient({ transport: http(rpc, { retryCount: 4, retryDelay: 600 }) });

const OPEN = 0, EXTENDED = 1, CLOSED = 2, HALTED = 3;
/** The regime of a print, as the tape names it (services/tape/src/derive.ts regimeOf). */
function regimeOf(status, bandLo, bandHi, prevStatus) {
  if ((bandLo === 0 && bandHi === 0) || status === HALTED) return "HALTED";
  if (status === CLOSED) return "DISCOVERY";
  const wasClosed = prevStatus === CLOSED || prevStatus === HALTED;
  if (wasClosed && (status === OPEN || status === EXTENDED)) return "REOPENING";
  if (status === EXTENDED) return "EXTENDED";
  return "LIVE";
}

/** The transaction that finished the auction of (market, upTo): BatchCleared indexes both. */
async function clearTx(marketId, upTo) {
  const head = await client.getBlockNumber();
  // a causal auction clears at Chainlink's next observation: seconds to minutes after its seal, 100 blocks a query
  for (let from = upTo; from <= head && from < upTo + 12_000n; from += 100n) {
    const to = from + 99n < head ? from + 99n : head;
    const logs = await client.getContractEvents({ address: exchange, abi: unisonExchangeAbi, eventName: "BatchCleared", args: { marketId, upToBlock: upTo }, fromBlock: from, toBlock: to });
    if (logs[0]) return logs[0].transactionHash;
  }
  throw new Error(`no auction on market ${marketId} ran up to block ${upTo}`);
}

const out = [];
for (const ref of wanted) {
  const [m, u] = ref.split("/");
  const marketId = BigInt(m);
  const upTo = BigInt(u);
  const tx = await clearTx(marketId, upTo);
  const v = await verifyReceipt(client, tx);
  if (!v.ok) throw new Error(`${ref}: ${v.failures} of ${v.checks} checks failed; not archiving it`);
  const receipt = await client.getTransactionReceipt({ hash: tx });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  let cleared;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: unisonExchangeAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "BatchCleared" && ev.args.marketId === marketId && ev.args.upToBlock === upTo) cleared = { args: ev.args, logIndex: log.logIndex };
    } catch {
      /* another contract's event */
    }
  }
  if (!cleared) throw new Error(`${ref}: BatchCleared not in ${tx}`);
  const before = await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [marketId], blockNumber: receipt.blockNumber - 1n });
  const bandLo = Number(cleared.args.bandLo);
  const bandHi = Number(cleared.args.bandHi);
  const recomputes = v.steps.find((s) => s.kind === "check" && s.what.startsWith("receipt hash recomputes"));
  out.push({
    marketId: Number(marketId),
    upTo: Number(upTo),
    block: Number(receipt.blockNumber),
    tx: tx.toLowerCase(),
    logIndex: cleared.logIndex,
    ts: Number(block.timestamp) * 1000,
    tick: Number(v.tick),
    price: v.price.toString(),
    volume: v.volume.toString(),
    refPrice: v.refPrice.toString(),
    refTimeMs: Number(v.refTimeMs),
    status: v.status,
    regime: regimeOf(v.status, bandLo, bandHi, Number(before.lastStatus)),
    bandLo,
    bandHi,
    receiptHash: v.receiptHash.toLowerCase(),
    prevReceiptHash: before.receiptHash.toLowerCase(),
    chainOk: !!recomputes?.ok,
    deviationBps: v.volume === 0n || v.refPrice === 0n ? null : bpsDiff(v.price, v.refPrice),
    sealedAt: v.causal ? Number(v.causal.sealedAt) : null,
    round: v.causal ? v.causal.round.toString() : null,
    rule: v.rule,
    causal: v.rule === "causal",
    feed: v.causal ? v.causal.feed : null,
    checks: { passed: v.checks - v.failures, of: v.checks },
  });
  console.log(`${ref}  ${v.rule.padEnd(10)} ${v.checks - v.failures}/${v.checks} checks  ${tx}`);
}
out.sort((a, b) => a.marketId - b.marketId || a.upTo - b.upTo);

const day = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL("../lib/content/receipts.generated.ts", import.meta.url),
  `/* Generated by scripts/archive-receipts.mjs from Monad mainnet (chain ${deployment.chainId}). Do not edit. */
import type { Print } from "@unison/sdk/tape";

/** A receipt as the tape served it, rebuilt from the chain, with the Chainlink feed that priced it and the checks that passed. */
export interface ArchivedReceipt extends Print {
  feed: string | null;
  checks: { passed: number; of: number };
}

/** The day these were read from the chain and checked. */
export const ARCHIVED_ON = "${day}";

export const ARCHIVED_RECEIPTS: readonly ArchivedReceipt[] = ${JSON.stringify(out, null, 2)};
`,
);
console.log(`\n${out.length} receipts written, every check passed`);
